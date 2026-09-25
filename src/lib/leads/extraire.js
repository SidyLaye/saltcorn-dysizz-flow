/* Extraction déterministe d'un mail de lead.
   Entrée : { expediteur, destinataire, objet, texte, html, date }.
   Sortie : { portail, nature, contact, bien, recherche, message, site, preuves, manquants }.
   Aucune IA ici : si un champ manque, il est signalé dans « manquants » et
   c'est l'appelant qui décide (IA plafonnée, relecture humaine…). */
"use strict";
const { texteMail, liens: lesLiens, cle, sansCitation } = require("./texte");
const V = require("./valeurs");
const { lireFiche, bloc } = require("./fiche");
const { detecter, dom } = require("./portails");

const RELAIS = /(@|\.)(messagerie\.leboncoin\.fr|email\.green-acres\.com|reply\.properstar\.com|leboncoin\.fr|green-acres\.com|seloger\.com|bienici\.com|lefigaro\.fr|french-property\.com|properstar\.com|giraffe360\.com|ac3-groupe\.com|rightmove\.co\.uk|paruvendu(pro)?\.fr|ma-propriete\.fr|bellespierres\.com|jestim(o|online)\.(com|fr)|ekonsilio\.(fr|com)|octea\.com|vadesecure\.com)$/i;
const GENERIQUES = /^(no-?reply|noreply|support|contact|info|enquiries|pacontact|pro|service|notification|newsletter)@/i;

const vide = () => ({ contact: {}, bien: {}, recherche: {}, message: "", preuves: {} });

const poser = (r, chemin, v, preuve) => {
  if (v === undefined || v === null || v === "" || (typeof v === "number" && !isFinite(v))) return;
  const [a, b] = chemin.split(".");
  const cible = b ? r[a] : r;
  const k = b || a;
  if (cible[k] !== undefined && cible[k] !== null && cible[k] !== "") return;
  cible[k] = v; r.preuves[chemin] = preuve;
};

const depuisFiche = (r, couples, L) => {
  for (const c of couples) {
    const v = c.valeur, p = "fiche:" + c.champ;
    switch (c.champ) {
      case "email": poser(r, "contact.email", V.email(v), p); break;
      case "telephone": poser(r, "contact.telephone", V.telephone(v) ? v : "", p); break;
      case "nom": poser(r, "contact.nom", V.nomPropre(v), p); break;
      case "prenom": poser(r, "contact.prenom", V.nomPropre(v), p); break;
      case "nom_complet": if (!V.email(v) || v.split(/\s+-\s+/).length > 1) poser(r, "contact.nom_complet", V.nomPropre(v.split(/\s+-\s+(?=\S+@|\+?\d)/)[0]), p); break;
      case "civilite": poser(r, "contact.civilite", v, p); break;
      case "pays": poser(r, "contact.pays", v, p); break;
      case "langue": poser(r, "contact.langue", v, p); break;
      case "message": if (!r.message) { r.message = bloc(c.lignes, c.ligne + 1, v); r.preuves.message = p; } break;
      case "reference": { const m = v.match(/[\w][\w./-]*/); if (m && /\d/.test(m[0])) poser(r, "bien.reference", m[0], p); break; }
      case "id_crm": poser(r, "bien.id_crm", (v.match(/\d{5,}/) || [])[0], p); break;
      case "prix": poser(r, "bien.prix", V.prix(/€|eur/i.test(v) ? v : v + " €"), p); break;
      case "ville": poser(r, "bien.ville", v, p); break;
      case "code_postal": poser(r, "bien.code_postal", (v.match(/\b\d{5}\b/) || [])[0], p); break;
      case "adresse": poser(r, "bien.adresse", v, p); break;
      case "type": poser(r, "bien.type", V.typeBien(v), p); break;
      case "surface": poser(r, "bien.surface", V.surface(v + (/m/.test(v) ? "" : " m²")), p); break;
      case "pieces": poser(r, "bien.pieces", V.nombre(v), p); break;
      case "chambres": poser(r, "bien.chambres", V.nombre(v), p); break;
      case "delai": poser(r, "delai", v, p); break;
      case "r_type": poser(r, "recherche.type", V.typeBien(v) || (/n\.?c/i.test(v) ? "" : v), p); break;
      case "r_localisation": if (!/n\.?c\.?$/i.test(v)) poser(r, "recherche.localisation", v, p); break;
      case "r_budget": poser(r, "recherche.budget_max", V.prix(v + " €"), p); break;
      case "r_surface": poser(r, "recherche.surface_min", V.nombre(v), p); break;
      case "r_terrain": poser(r, "recherche.terrain_min", V.nombre(v), p); break;
      case "r_pieces": poser(r, "recherche.pieces_min", V.nombre(v), p); break;
      case "r_chambres": poser(r, "recherche.chambres_min", V.nombre(v), p); break;
      default:
    }
  }
};

/* Identifie le site d'agence d'origine (leads « AC3 ») : liens du mail puis nom cité. */
const identifierSite = (liens, texte, objet, sites = []) => {
  const compte = new Map();
  for (const u of liens) {
    const h = (u.match(/^https?:\/\/([^/?#]+)/i) || [])[1];
    if (!h) continue;
    const s = sites.find((x) => h.toLowerCase().replace(/^www\./, "").endsWith(x.domaine));
    if (s) compte.set(s, (compte.get(s) || 0) + 1);
  }
  if (compte.size) return { ...[...compte.entries()].sort((a, b) => b[1] - a[1])[0][0], preuve: "lien" };
  const t = cle(objet + " " + texte.slice(0, 600));
  const s = sites.find((x) => (x.noms || []).some((n) => t.includes(cle(n))));
  return s ? { ...s, preuve: "nom" } : null;
};

/* Mail transféré par l'agence (« TR: », « Fwd: ») : on retrouve l'expéditeur d'origine et le texte transféré. */
const deballer = (texte, objet, domAgence) => {
  const L = texte.split("\n");
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^(?:de|from)\s*:?\s+(.*@.*)$/i) || (/^(de|from)$/i.test(L[i]) && /@/.test(L[i + 1] || "") ? [null, L[i + 1]] : null);
    if (!m) continue;
    const d = dom(m[1]);
    if (!d || domAgence.some((x) => d === x || d.endsWith("." + x))) continue;
    let j = i + 1;
    while (j < L.length && j < i + 8 && /^(envoyé|sent|date|à|to|cc|objet|subject|a)\s*:?/i.test(L[j])) j++;
    const o = (L.slice(i, j).find((l) => /^(objet|subject)\s*:/i.test(l)) || "").replace(/^(objet|subject)\s*:\s*/i, "") || objet.replace(/^((tr|fwd?|fw|re)\s*:\s*)+/i, "");
    return { expediteur: m[1], objet: o, texte: L.slice(j).join("\n"), html: "" };
  }
  return null;
};

const extraire = (mail, conf = {}) => {
  const texte = texteMail({ texte: mail.texte ?? mail.corps_texte, html: mail.html ?? mail.corps_html });
  const liens = lesLiens({ texte: mail.texte ?? mail.corps_texte, html: mail.html ?? mail.corps_html });
  const objet = String(mail.objet || "");
  const d = dom(mail.expediteur);
  const domAgence = (conf.domaines_agence || []).map((x) => x.toLowerCase());
  const r = vide();
  const p = detecter(mail);
  r.portail = p ? p.id : null;
  r.portail_nom = p ? p.nom : null;

  const auto = /^(automatic reply|réponse automatique|automatische antwort|automatisch antwoord|auto(matic)?[- ]?reply|out of office|absence|abwesenheit|risposta automatica|respuesta automática|email not in use|your email to|undeliverable|non remis|delivery status|mail delivery)/i.test(objet.replace(/^(re|tr|fwd?)\s*:\s*/i, ""));
  const campagne = (conf.objets_campagnes || []).find((c) => cle(objet).includes(cle(c)));
  if (auto) r.nature = "auto_reponse";
  else if (p) r.nature = p.nature(objet, texte, d);
  else if (domAgence.some((x) => d === x || d.endsWith("." + x))) {
    r.nature = "interne";
    if (/^\s*(tr|fwd?|fw|transf)\s*:/i.test(objet) && !mail.__deballe) {
      const inner = deballer(texte, objet, domAgence);
      if (inner) { const r2 = extraire({ ...inner, destinataire: mail.destinataire, __deballe: true }, conf); r2.transfere_par = mail.expediteur; r2.preuves.transfert = "deballe"; return r2; }
    }
  }
  else r.nature = campagne ? "reponse_campagne" : "direct";

  const corps = ["direct", "reponse_campagne"].includes(r.nature) ? sansCitation(texte) : texte;
  const { couples, lignes: L } = lireFiche(corps);
  if (!["non_lead", "interne", "auto_reponse"].includes(r.nature)) depuisFiche(r, couples, L);
  if (p && p.regles && r.nature !== "non_lead") {
    try { p.regles({ L, o: objet, r, texte: corps, liens, conf, mail }); } catch (e) { r.erreur_regle = e.message; }
    for (const k of ["contact", "bien"]) for (const [c, v] of Object.entries(r[k])) if (v !== null && v !== undefined && v !== "" && !r.preuves[k + "." + c]) r.preuves[k + "." + c] = "portail:" + p.id;
    if (r.message && !r.preuves.message) r.preuves.message = "portail:" + p.id;
  }

  /* Mail direct d'un particulier : la référence est souvent dans l'objet (« Réf. 12018360189 », « Monesties #32682 »). */
  if (r.nature === "reponse_campagne") { poser(r, "contact.email", V.email(mail.expediteur), "expediteur"); if (!r.message) { r.message = corps.split("\n").slice(0, 40).join("\n"); r.preuves.message = "corps"; } }
  if (r.nature === "direct") {
    const ref = objet.match(/(?:r[ée]f(?:[ée]rence)?\.?\s*(?:n°)?\s*:?\s*|#)\s*([\w-]*\d[\w-]*)/i);
    if (ref) poser(r, "bien.reference", ref[1], "objet");
    else { const n = objet.match(/(?<![\d.,])(\d{4,12})(?![\d.,]|\s*(€|m2|m²|euros?))/); if (n && !/^(19|20)\d\d$/.test(n[1])) poser(r, "bien.reference", n[1], "objet:nombre"); }
    for (const [k, v] of Object.entries(V.faitsTitre(objet))) poser(r, "bien." + k, v, "objet");
    poser(r, "contact.email", V.email(mail.expediteur), "expediteur");
    const n = String(mail.expediteur || "").match(/^\s*"?([^"<@]+?)"?\s*</);
    if (n) poser(r, "contact.nom_complet", V.nomPropre(n[1]), "expediteur");
    if (!r.message) { r.message = corps.split("\n").slice(0, 40).join("\n"); r.preuves.message = "corps"; }
    const zone = objet + "\n" + corps.slice(0, 1200);
    const bienMot = /(maison|villa|appartement|propriét|house|property|home|huis|woning|annonce|listing|réf|ref\b|reference)/i.test(zone);
    const intention = /(visite|visiter|viewing|intéress|interested|renseignement|information|achat|acheter|buy|purchase|disponible|available|prix|price|offre|offer|à vendre|a vendre|for sale|te koop|recherche|looking for)/i.test(zone);
    if (!r.bien.reference && !(bienMot && intention)) r.nature = "inconnu";
  }

  /* Référence manquante : motifs usuels dans l'objet puis le texte ; identifiant CRM dans les liens. */
  if (["lead", "relance", "direct"].includes(r.nature)) {
    if (!r.bien.reference) {
      const re = /(?:\br[ée]f(?:[ée]rence)?\b|\bref\b)\.?\s*(?:de l.annonce|n°|no\.?)?\s*:?\s*\[?\s*([A-Z]{0,4}-?\d[\w-]{2,})/i;
      const m = objet.match(re) || corps.match(re) || corps.match(/\[(\d{3,})\]\s*-/);
      if (m) poser(r, "bien.reference", m[1], "motif:reference");
    }
    if (!r.bien.id_crm) for (const motif of conf.id_crm_liens || []) {
      const re = new RegExp(motif, "i");
      const m = liens.map((u) => u.match(re)).find(Boolean);
      if (m) { poser(r, "bien.id_crm", m[1], "lien"); break; }
    }
  }
  /* Adresse relais du portail (Leboncoin, Green-Acres…) : utile pour répondre si pas d'e-mail direct. */
  if (!r.contact.email_relais && RELAIS.test(d) && !GENERIQUES.test(V.email(mail.expediteur))) r.contact.email_relais = V.email(mail.expediteur);

  /* Nettoyage + validations. */
  const c = r.contact;
  if (c.email && (RELAIS.test(c.email) || domAgence.some((x) => c.email.endsWith("@" + x)) || GENERIQUES.test(c.email))) {
    if (RELAIS.test(c.email)) c.email_relais = c.email;
    delete c.email; delete r.preuves["contact.email"];
  }
  if (!c.email && r.nature !== "non_lead" && r.nature !== "interne") {
    const tous = (corps.match(new RegExp(V.EMAIL_RE.source, "gi")) || []).map((x) => x.toLowerCase())
      .filter((x) => !RELAIS.test(x) && !GENERIQUES.test(x) && !domAgence.some((a) => x.endsWith("@" + a)));
    if (tous.length) poser(r, "contact.email", tous[0], "texte");
  }
  if (c.telephone) { const t = V.telephone(c.telephone); if (t) c.telephone = t; else { delete c.telephone; delete r.preuves["contact.telephone"]; } }
  if (!c.telephone) { const m = liens.concat(corps.match(/tel:\+?[\d ]{8,}/gi) || []).find((u) => /^tel:/i.test(u)); if (m) poser(r, "contact.telephone", V.telephone(m), "lien tel"); }
  if (c.nom_complet && !c.nom && !c.prenom) {
    const parts = V.decouperNom(c.nom_complet, "auto");
    if (parts.nom) { c.nom = parts.nom; r.preuves["contact.nom"] = "decoupe"; }
    if (parts.prenom) { c.prenom = parts.prenom; r.preuves["contact.prenom"] = "decoupe"; }
  }
  if (c.nom && !c.nom_complet) c.nom_complet = [c.prenom, c.nom].filter(Boolean).join(" ");
  const b = r.bien;
  for (const k of ["prix", "surface", "pieces", "chambres"]) if (b[k] === null || b[k] === undefined || b[k] === "" || Number.isNaN(b[k])) delete b[k];
  if (b.ville) b.ville = b.ville.replace(/\s+/g, " ").replace(/[,.]+$/, "").trim();
  if (b.reference) b.reference = String(b.reference).trim();
  if (r.message) r.message = r.message.replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);

  if (p && p.id === "site_agence") {
    const s = identifierSite(liens, texte, objet, conf.sites || []);
    if (s) { r.site = s.domaine; r.site_origine = s.origine || s.domaine; r.preuves.site = s.preuve; }
  }

  r.manquants = [];
  if (["lead", "relance", "recherche", "estimation", "direct", "reponse_campagne"].includes(r.nature)) {
    if (!c.email && !c.telephone) r.manquants.push("coordonnees");
    if (!c.email && !c.email_relais) r.manquants.push("email");
    if (!c.nom && !c.prenom) r.manquants.push("nom");
    if (["lead", "relance"].includes(r.nature) && !b.reference && !b.id_crm && !b.reference_portail) r.manquants.push("reference");
  }
  r.destinataire = mail.destinataire || "";
  return r;
};

module.exports = { extraire, identifierSite, RELAIS };
