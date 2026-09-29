/* Mails d'un lead, prêts à partir avec « Mail : envoyer une seule fois » (clé = lead + destinataire).
   Un lead « à vérifier » ne part pas, sauf réglage « envoi_a_verifier ». Envois coupés dans les réglages
   (« envoi_mails », défaut) : les mails sont seulement simulés. */
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

const lienFiche = (R, leadId) => {
  if (!R.lien_fiche) return "";
  let base = ""; try { base = String(require("@saltcorn/data/db/state").getState().getConfig("base_url", "") || "").replace(/\/+$/, ""); } catch (e) { /* rien */ }
  const chemin = String(R.lien_fiche).replace("{lead}", encodeURIComponent(leadId));
  return /^https?:/.test(chemin) ? chemin : base + chemin;
};

const messages = async (dossier, resultat) => {
  const d = obj(dossier), res = resultat ? obj(resultat) : {};
  const R = await reglages();
  const leadId = res.id || null;
  const liste = (d.destinataires && d.destinataires.liste) || [];
  const vide = (raison) => ({ liste: [], simuler: !R.envoi_mails, raison });
  if (!leadId) return vide("lead non enregistré");
  if (!liste.length) return vide("aucun destinataire");
  if (d.statut !== "pret" && !(d.statut === "a_verifier" && R.envoi_a_verifier)) return vide(`statut « ${d.statut} » : pas d'envoi`);
  const lien = lienFiche(R, leadId);
  return {
    simuler: !R.envoi_mails,
    raison: `${liste.length} destinataire(s)`,
    liste: liste.filter((x) => x && x.email).map((x) => {
      const a = String(x.email).toLowerCase().trim();
      const { objet, html } = contenu(d, x, lien);
      return { cle: `${require("./schema").prefixe()}lead-${leadId}:${a}`, a, sujet: objet, html, reference: `lead ${leadId}` };
    }),
  };
};

module.exports = { messages, contenu };
