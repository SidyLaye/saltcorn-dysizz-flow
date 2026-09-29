/* Mails d'un lead, prêts à partir avec « Mail : envoyer une seule fois » (clé = lead + destinataire).
   - lead prêt : un mail par destinataire, au format réglé (« format_envoi ») :
     « resume » (fiche du lead, défaut) ou « origine » (le mail reçu tel quel, avec son objet d'origine) ;
   - lead non automatisable (« à vérifier », « à trier ») : si une adresse « non automatisé » est réglée,
     le mail reçu y est transféré tel quel, pour être traité à la main (sinon rien ne part, sauf « envoi_a_verifier ») ;
   - envois coupés dans les réglages (« envoi_mails », défaut) : les mails sont seulement simulés. */
"use strict";
const { reglages } = require("./conf");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const obj = (v) => (v && typeof v === "object" ? v : JSON.parse(v));
/* Contenu du mail (texte simple et lisible ; même informations que l'ancien service) */
const contenu = (d, dest, lien) => {
  const x = d.extraction || {}, c = x.contact || {}, b = d.bien || {}, bm = x.bien || {};
  const nom = [c.prenom, c.nom].filter(Boolean).join(" ") || c.nom_complet || "Prospect";
  const ref = b.reference || bm.reference || bm.id_crm || "";
  const nature = x.nature === "relance" ? "Relance" : "Nouveau lead";
  const objet = `${nature} ${d.portail || x.portail_nom || ""} — ${ref ? "réf. " + ref + " — " : ""}${nom}`.replace(/\s+/g, " ").trim();
  const ligne = (l, v) => (v ? `<tr><td style="color:#667;padding:2px 12px 2px 0">${esc(l)}</td><td><b>${esc(v)}</b></td></tr>` : "");
  const prix = b.prix || bm.prix;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">
<p>${esc(nature)} reçu via <b>${esc(d.portail || x.portail_nom || "un portail")}</b>.</p>
<table style="border-collapse:collapse">${ligne("Prospect", nom)}${ligne("E-mail", c.email || c.email_relais)}${ligne("Téléphone", c.telephone)}
${ligne("Bien", [ref && "réf. " + ref, b.type || bm.type, b.ville || bm.ville, prix && Number(prix).toLocaleString("fr-FR") + " €"].filter(Boolean).join(" · "))}
${ligne("Agence", d.agence && d.agence.nom)}</table>
${x.message ? `<p style="margin-top:12px;padding:10px;background:#f3f4f6;border-radius:6px;white-space:pre-wrap">${esc(String(x.message).slice(0, 3000))}</p>` : ""}
${lien ? `<p><a href="${esc(lien)}">Voir la fiche du lead</a></p>` : ""}
<p style="color:#6b7280;font-size:12px">Vous recevez ce lead : ${esc(dest.raison || (dest.roles || []).join(", ") || "destinataire")}.</p></div>`;
  return { objet, html };
};

/* Le mail reçu, tel quel : objet d'origine, en-tête d'origine, puis le mail lui-même.
   Celui qui le reçoit peut le transférer d'un clic au bon négociateur. */
const dateFrHeure = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : ""; };
const transfert = (mail, envoyeA) => {
  const m = mail || {};
  const objet = String(m.objet || "").trim() || "Sans objet";
  const ligne = (l, v) => `<tr><td style="padding:6px 20px 6px 0;color:#6b7280;width:110px;vertical-align:top">${esc(l)}</td><td style="padding:6px 0;font-weight:600;vertical-align:top">${esc(v || "")}</td></tr>`;
  const corps = m.corps_html ? String(m.corps_html)
    : m.corps_texte ? `<pre style="margin:0;white-space:pre-wrap;font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${esc(m.corps_texte)}</pre>`
    : `<div style="color:#6b7280">Mail d'origine vide</div>`;
  const a = (envoyeA || []).length ? `<div style="padding:18px 24px;border-bottom:1px solid #e5e7eb"><div style="font-size:13px;color:#6b7280;margin-bottom:6px">Envoyé à</div>${envoyeA.map((x) => `<div style="font-weight:600">${esc(x)}</div>`).join("")}</div>` : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;background:#f5f5f7"><div style="max-width:760px;margin:0 auto;background:#fff;border:1px solid #e5e7eb">
<div style="background:#263d63;color:#fff;padding:22px 24px;font-size:20px;font-weight:700">${esc(objet)}</div>
<div style="padding:18px 24px;border-bottom:1px solid #e5e7eb"><div style="font-size:13px;color:#6b7280;margin-bottom:6px">En-tête d'origine</div><table role="presentation" style="border-collapse:collapse;font-size:14px">${ligne("De", m.expediteur)}${ligne("À", m.destinataire)}${ligne("Date", dateFrHeure(m.date_envoi || m.recu_le))}${ligne("Objet", objet)}</table></div>
${a}<div style="padding:18px 24px"><div style="font-size:13px;color:#6b7280;margin-bottom:6px">Mail d'origine</div><div style="border-left:3px solid #263d63;background:#f7f7fa;padding:14px;overflow:auto">${corps}</div></div></div></div>`;
  return { objet, html };
};

const lienFiche = (R, leadId) => {
  if (!R.lien_fiche) return "";
  let base = ""; try { base = String(require("@saltcorn/data/db/state").getState().getConfig("base_url", "") || "").replace(/\/+$/, ""); } catch (e) { /* rien */ }
  const chemin = String(R.lien_fiche).replace("{lead}", encodeURIComponent(leadId));
  return /^https?:/.test(chemin) ? chemin : base + chemin;
};

const adresses = (s) => [...new Set(String(s || "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];

const messages = async (dossier, resultat) => {
  const d = obj(dossier), res = resultat ? obj(resultat) : {};
  const R = await reglages();
  const leadId = res.id || null;
  const liste = (d.destinataires && d.destinataires.liste) || [];
  const vide = (raison) => ({ liste: [], simuler: !R.envoi_mails, raison });
  if (!leadId) return vide("lead non enregistré");
  const cle = (a, quoi = "") => `${require("./schema").prefixe()}lead-${leadId}:${quoi}${a}`;
  const envoiNormal = d.statut === "pret" || (d.statut === "a_verifier" && R.envoi_a_verifier);
  const nonAuto = adresses(R.adresse_non_automatise);
  /* le mail reçu n'est lu que s'il sert (format « origine » ou transfert) */
  const mailRecu = async () => {
    const id = d.mail_id || res.mail_id;
    if (!id) return {};
    const t = require("@saltcorn/data/models/table").findOne({ name: require("./schema").nom("mails") });
    return (t && (await t.getRow({ id: +id }))) || {};
  };
  if (!envoiNormal) {
    /* ni client ni bien (expéditeur inconnu, réponse à une campagne) : ce n'est pas un lead, rien ne part */
    const pasUnLead = ["inconnu", "reponse_campagne"].includes(d.extraction && d.extraction.nature);
    if (["a_verifier", "a_trier"].includes(d.statut) && !pasUnLead && nonAuto.length) {
      const { objet, html } = transfert(await mailRecu());
      return {
        simuler: !R.envoi_mails,
        raison: `non automatisé (${(d.motifs || []).slice(0, 2).join(" ; ") || d.statut}) : transféré tel quel`,
        liste: nonAuto.map((a) => ({ cle: cle(a, "non-automatise:"), a, sujet: objet, html, reference: `lead ${leadId}` })),
      };
    }
    return vide(`statut « ${d.statut} » : pas d'envoi`);
  }
  if (!liste.length) return vide("aucun destinataire");
  const lien = lienFiche(R, leadId);
  const a = liste.filter((x) => x && x.email).map((x) => String(x.email).toLowerCase().trim());
  const origine = R.format_envoi === "origine" ? transfert(await mailRecu(), a) : null;
  return {
    simuler: !R.envoi_mails,
    raison: `${liste.length} destinataire(s)`,
    liste: liste.filter((x) => x && x.email).map((x) => {
      const adr = String(x.email).toLowerCase().trim();
      const { objet, html } = origine || contenu(d, x, lien);
      return { cle: cle(adr), a: adr, sujet: objet, html, reference: `lead ${leadId}` };
    }),
  };
};

module.exports = { messages, contenu, transfert, adresses };
