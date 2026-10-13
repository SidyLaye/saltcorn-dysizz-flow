/* Bot WhatsApp des leads : ce que l'application lui donne (contexte, fiche du bien) et ce qu'elle
   fait de ses événements (écritures CRM, messages aux équipes).
   Pur : aucune table, aucun réseau. La colle avec les tables et le CRM est dans tables/bot.js.
   Règle de fond : le bot ne reçoit du bien que les champs de CHAMPS_PUBLICS, rien d'autre du CRM. */
"use strict";
const { destinataires } = require("./routage");

const CHAMPS_PUBLICS = ["type", "pieces", "chambres", "surface", "ville", "code_postal", "prix"];
const bienPublic = (b) => {
  const o = {};
  for (const k of CHAMPS_PUBLICS) if (b && b[k] != null && b[k] !== "") o[k] = k === "ville" ? nomVille(b[k]) : b[k];
  return Object.keys(o).length ? o : null;
};

const tel9 = (t) => String(t || "").replace(/\D/g, "").slice(-9);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* espace simple : la police du PDF n'a pas l'espace fine de toLocaleString("fr-FR") */
const milliers = (n) => String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const majuscule = (s) => String(s || "").trim().toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
/* « VILLEFRANCHE-DE-ROUERGUE » (saisie du CRM) → « Villefranche-de-Rouergue » ; une ville déjà bien écrite n'est pas touchée */
const nomVille = (v) => { const s = String(v || "").trim(); return !s || s !== s.toUpperCase() ? s : majuscule(s).replace(/(?<=[\s-])(De|Du|Des|Le|La|Les|Sur|Sous|En|Et|Au|Aux|Lès|D(?=['’])|L(?=['’]))(?=[\s'’-])/g, (m) => m.toLowerCase()); };

/* Qui reçoit vraiment, avec le routage en service : négociateur ou son remplaçant, assistant(e), siège, copies. */
const quiRecoit = (negoId, conf = {}, bien, quand = new Date()) => {
  const b = bien || {}, R = conf.routage || {};
  const r = destinataires(negoId, quand, R, { prix: +b.prix || null, type: b.type || null, code_postal: b.code_postal || null, nature: "lead" });
  const nego = r.liste.find((x) => x.roles.includes("negociateur"));
  const personne = (nego && (R.personnes || []).find((p) => String(p.email || "").trim().toLowerCase() === nego.email)) || null;
  return { liste: r.liste, personne };
};

/* Réponse au bot quand une conversation commence. etat = { optout, fiche, ouverture, statut } */
const contexte = ({ dossier, lead, bien, photos = [], conf, reglages: R = {}, etat = {}, quand }) => {
  if (!dossier) return { inconnu: true, optout: !!etat.optout };
  const x = (lead && lead.extraction) || {}, c = x.contact || {}, r = x.recherche || {};
  const { personne } = quiRecoit(dossier.negociateur || (bien && bien.negociateur_id), conf, bien, quand);
  const tel = personne ? String(personne.telephone || "").replace(/\D/g, "").replace(/^0(?=\d{9}$)/, "33") : "";
  return {
    dossier_id: dossier.id || null,
    prenom: majuscule(c.prenom || dossier.prenom),
    entite: R.entite || "",
    source: dossier.portail || "",
    negociateur: personne ? { prenom: "", nom: personne.nom } : null,
    /* photos : seulement celles du dossier d'images choisi par le client (réglage « photos »), 10 au plus (un carrousel WhatsApp) */
    bien_public: { ...bienPublic(bien), ...(photos.length ? { photos_publiques: photos.filter((u) => /^https:\/\//.test(u)).slice(0, 10) } : {}) },
    /* numéro direct de la personne qui reprend : seulement si le client l'a accepté */
    liens_whatsapp: R.liens_directs === true && tel ? { negociateur: "https://wa.me/" + tel } : {},
    langue_ouverture: "fr",
    deja_connu: { budget: r.budget_max || null, zone: r.localisation || null },
    ouverture_envoyee: !!etat.ouverture, fiche_annonce_envoyee: !!etat.fiche, statut: etat.statut || "", optout: !!etat.optout,
  };
};

const DEMANDES = { "OUT-1": "Demande de visite ou de rendez-vous", "OUT-2": "Demande de rappel", "OUT-3": "Projet à plus long terme, à recontacter",
  "OUT-4": "Demande à parler à un conseiller", "OUT-5": "Annulation", "OUT-6": "Désinscription" };
const DELAIS = { HOT: "moins de 3 mois", WARM: "3 à 12 mois", COLD: "plus de 12 mois" };
const AVIS = { prioritaire_vendeur: "Le prospect a un bien à vendre", annulation: "Le prospect annule sa demande", message_apres_transmission: "Nouveau message du prospect après transmission" };

/* Lignes « libellé, valeur » d'une sortie du bot : pour l'action du CRM et pour le message aux équipes. */
const lignes = (d = {}) => {
  const q = d.qualification || {}, etiquettes = [d.lead_prioritaire && "bien à vendre (prioritaire)", d.lead_financement && "financement", d.lead_travaux && "travaux", d.lead_relocation && "relocation"].filter(Boolean);
  const branche = (o) => Object.entries(o || {}).filter(([, v]) => v !== "" && v != null && typeof v !== "object").map(([k, v]) => `${k} : ${v}`).join(" ; ");
  return [
    ["Demande", [DEMANDES[d.code] || d.code, d.motif].filter(Boolean).join(" · ")],
    ["Créneau souhaité", [d.creneau, d.fuseau].filter(Boolean).join(" · ")],
    ["Délai du projet", DELAIS[d.temperature]],
    ["Projet", q.projet], ["Budget", q.budget], ["Zone", q.zone], ["Financement", q.financement], ["Bien à vendre", q.bien_a_vendre],
    ["À signaler", etiquettes.join(", ")],
    ["Financement (détail)", branche(d.f)], ["Travaux (détail)", branche(d.w)], ["Relocation (détail)", branche(d.i)],
    ["Dernier message", d.dernier_message || d.texte || d.reponse],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").map(([l, v]) => [l, String(v)]);
};

/* Ce qu'un lot d'événements déclenche. Les identifiants de couleur et de type d'action sont ceux du CRM
   du client : R.couleurs = { HOT, WARM, COLD }, R.actions = { "OUT-1": id, …, defaut: id }. */
const plan = (evenements, R = {}) => {
  const out = { crm: [], avis: [], optout: false };
  const sortie = (evenements || []).some((e) => e && e.type === "sortie");
  for (const e of evenements || []) {
    const d = (e && e.donnees) || {};
    if (e.type === "optout") out.optout = true;
    else if (e.type === "sortie") {
      const couleur = (R.couleurs || {})[d.temperature];
      if (couleur) out.crm.push({ op: "couleurContact", couleur });
      const action = (R.actions || {})[d.code] || (R.actions || {}).defaut;
      if (action) out.crm.push({ op: "ajouterAction", action_id: action, texte: "WhatsApp. " + lignes(d).map(([l, v]) => `${l} : ${v}`).join("\n") });
      if (d.code !== "OUT-6") out.avis.push({ titre: DEMANDES[d.code] || "Demande", prioritaire: !!d.lead_prioritaire, donnees: d, referents: [d.lead_financement && "f", d.lead_travaux && "w", d.lead_relocation && "i"].filter(Boolean) });
    } else if (AVIS[e.type] && !(sortie && e.type === "prioritaire_vendeur"))
      out.avis.push({ titre: AVIS[e.type], prioritaire: e.type === "prioritaire_vendeur", donnees: d, referents: [] });
  }
  return out;
};

/* Message aux équipes. fil = [{ role: "prospect" | "bot", texte }] ; aurait_recu : adresses réelles, rappelées pendant les essais. */
const mailEquipe = ({ avis, dossier = {}, bien, telephone, fil = [], aurait_recu }) => {
  const b = bien || {}, nom = dossier.nom || "Prospect";
  const objet = `${avis.prioritaire ? "[PRIORITAIRE] " : ""}WhatsApp · ${avis.titre}${b.reference ? " · réf. " + b.reference : ""} · ${nom}`;
  const ligne = (l, v) => (v ? `<tr><td style="color:#667;padding:2px 12px 2px 0;vertical-align:top">${esc(l)}</td><td><b>${esc(v)}</b></td></tr>` : "");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">
<p><b>${esc(avis.titre)}</b>, reçu par l'assistant WhatsApp.</p>
<table style="border-collapse:collapse">${ligne("Prospect", nom)}${ligne("Téléphone", telephone ? "+" + telephone : "")}${ligne("E-mail", dossier.email)}
${ligne("Bien", [b.reference && "réf. " + b.reference, b.type, b.ville, b.prix && milliers(b.prix) + " €"].filter(Boolean).join(" · "))}
${lignes(avis.donnees).map(([l, v]) => ligne(l, v)).join("")}</table>
${fil.length ? `<p style="margin:14px 0 4px;color:#667">L'échange</p><div style="padding:10px;background:#f3f4f6;border-radius:6px">${fil.map((m) => `<p style="margin:0 0 6px;white-space:pre-wrap"><b>${m.role === "prospect" ? "Prospect" : "Assistant"} :</b> ${esc(String(m.texte || "").slice(0, 1500))}</p>`).join("")}</div>` : ""}
${aurait_recu ? `<p style="color:#b45309;font-size:12px">Essai : en service, ce message irait à ${esc(aurait_recu.join(", ") || "personne")}.</p>` : ""}</div>`;
  return { objet: objet.slice(0, 300), html };
};

/* Fiche du bien, en blocs pour ecrirePdf : page blanche, champs publics seulement, aucune marque. */
const blocsFiche = (bien, quand = new Date()) => {
  const b = bienPublic(bien);
  if (!b || !(b.type || b.ville)) return null;
  const lieu = [b.ville, b.code_postal && `(${b.code_postal})`].filter(Boolean).join(" ");
  const titre = [majuscule(b.type) || "Bien", b.pieces && `${b.pieces} pièces`, b.ville && `à ${b.ville}`].filter(Boolean).join(" ");
  const tableau = [["Caractéristique", "Détail"], ["Type", majuscule(b.type)], ["Pièces", b.pieces], ["Chambres", b.chambres], ["Surface", b.surface && `${b.surface} m²`],
    ["Localisation", lieu], ["Prix", b.prix && `${milliers(b.prix)} €`]].filter(([, v]) => v).map(([l, v]) => [l, String(v)]);
  const jour = quand.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
  return [{ titre }, { tableau, taille: 10.5, chiffres_a_droite: false }, { petit: `Informations de l'annonce au ${jour}. Document non contractuel.` }];
};

module.exports = { CHAMPS_PUBLICS, bienPublic, tel9, quiRecoit, contexte, plan, lignes, mailEquipe, blocsFiche, majuscule, nomVille };
