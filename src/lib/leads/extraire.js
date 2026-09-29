/* Extraction déterministe d'un mail de lead.
   Entrée : { expediteur, destinataire, objet, texte, html, date }.
   Sortie : { portail, nature, contact, bien, recherche, message, site, preuves, manquants }.
   Aucune IA ici : si un champ manque, il est signalé dans « manquants » et
   c'est l'appelant qui décide (IA plafonnée, relecture humaine…). */
"use strict";
const { texteMail, liens: lesLiens, cle, sansCitation } = require("./texte");
const V = require("./valeurs");
const { lireFiche, bloc } = require("./fiche");
const { detecter, detecterParTexte, dom } = require("./portails");

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
      case "r_type_bis":
      case "r_type": { const t1 = String(v).split(/\s*[\/,;]\s*/)[0]; poser(r, "recherche.type", V.typeBien(t1) || (/n\.?c/i.test(t1) ? "" : t1), p); break; }
      case "r_localisation": if (!/n\.?c\.?$/i.test(v)) { let x = v; try { if (/%[0-9a-f]{2}/i.test(x)) x = decodeURIComponent(x); } catch (e) { /* laissé tel quel */ } poser(r, "recherche.localisation", x, p); } break;
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
  let repli = null;
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^(?:de|from)\s*:?\s+(.*@.*)$/i) || (/^(de|from)\s*:?$/i.test(L[i]) && /@/.test(L[i + 1] || "") ? [null, L[i + 1]] : null);
    if (!m) continue;
    const d = dom(m[1]);
    if (!d) continue;
    if (domAgence.some((x) => d === x || d.endsWith("." + x))) { if (repli === null) repli = i; continue; }
    return couper(L, i, m[1], objet);
  }
  /* seul un expéditeur de l'agence est cité (mail de portail repassé par une autre boîte) */
  if (repli !== null) { const m = L[repli].match(/^(?:de|from)\s*:?\s+(.*@.*)$/i); return couper(L, repli, m ? m[1] : L[repli + 1], objet, true); }
  return null;
};
const couper = (L, i, exp, objet, agence = false) => {
  {
    let j = i + 1;
    /* en-tête du mail transféré : « Envoyé : … », ou libellé seul puis valeur à la ligne (tableaux HTML) */
    if (/@/.test(L[j] || "") && L[i] !== undefined && !/@/.test(L[i])) j++;
    while (j < L.length && j < i + 12 && /^(envoyé|sent|date|à|to|cc|objet|subject|a)\s*:?/i.test(L[j])) j += /^(envoyé|sent|date|à|to|cc|objet|subject|a)\s*:?\s*$/i.test(L[j]) ? 2 : 1;
    const k = L.slice(i, j).findIndex((l) => /^(objet|subject)\s*:/i.test(l));
    const o = (k >= 0 ? L[i + k].replace(/^(objet|subject)\s*:\s*/i, "") || L[i + k + 1] || "" : "") || objet.replace(/^((tr|fwd?|fw|re)\s*:\s*)+/i, "");
    return { expediteur: exp, objet: o, texte: L.slice(j).join("\n"), html: "", __agence: agence };
  }
};

const extraire = (mail, conf = {}) => {
  const texte = texteMail({ texte: mail.texte ?? mail.corps_texte, html: mail.html ?? mail.corps_html });
  const liens = lesLiens({ texte: mail.texte ?? mail.corps_texte, html: mail.html ?? mail.corps_html });
  const objet = String(mail.objet || "");
  const d = dom(mail.expediteur);
  const domAgence = (conf.domaines_agence || []).map((x) => x.toLowerCase());
  const r = vide();
  const p = detecter(mail, conf.portails || []) || (mail.__deballe ? detecterParTexte(texteMail({ texte: mail.texte })) : null);
  r.portail = p ? p.id : null;
  r.portail_nom = p ? p.nom : null;

  const auto = /^(automatic reply|réponse automatique|automatische antwort|automatisch antwoord|auto(matic)?[- ]?reply|out of office|absence|abwesenheit|risposta automatica|respuesta automática|email not in use|your email to|undeliverable|non remis|delivery status|mail delivery)/i.test(objet.replace(/^(re|tr|fwd?)\s*:\s*/i, ""));
  /* réponse d'absence reconnue au texte (objet « Re : … ») : il faut DEUX signes, l'absence et le renvoi vers
     quelqu'un d'autre ou l'accès coupé, pour ne jamais écarter un prospect qui dit simplement être absent un jour */
  const debut = texte.slice(0, 700);
  const absentTexte = /\b(je (suis|serai) (actuellement |en ce moment )?(absente?|en (congés?|vacances))|de retour (le|à partir du|au bureau)|i (am|will be) (currently )?(out of (the )?office|away|on (holiday|leave))|out of (the )?office)\b/i.test(debut)
    && /(pour toute (demande|urgence|question)|en (mon|cas d.)absence|je n.aurai (pas|qu.un) accès|je ne (consulterai|lirai|pourrai) pas|during my absence|for (any )?urgent|limited access|please contact)/i.test(debut);
  const campagne = (conf.objets_campagnes || []).find((c) => cle(objet).includes(cle(c)));
  if (auto || (!p && absentTexte)) r.nature = "auto_reponse";
  else if (p) r.nature = p.nature(objet, texte, d);
  else if (domAgence.some((x) => d === x || d.endsWith("." + x)) && !(mail.__deballe && mail.__agence)) {
    r.nature = "interne";
    if (/^\s*(tr|fwd?|fw|transf)\s*:/i.test(objet) && !mail.__deballe) {
      const inner = deballer(texte, objet, domAgence);
      if (inner) { const r2 = extraire({ ...inner, destinataire: mail.destinataire, __deballe: true }, conf); r2.transfere_par = mail.expediteur; r2.preuves.transfert = "deballe"; r2.mail_deballe = { expediteur: inner.expediteur, objet: inner.objet, texte: inner.texte, date: mail.date || mail.date_envoi }; return r2; }
    }
  }
  else r.nature = mail.__agence ? "interne" : campagne ? "reponse_campagne" : "direct";

  const corps = ["direct", "reponse_campagne"].includes(r.nature) ? sansCitation(texte) : texte;
  const { couples, lignes: L } = lireFiche(corps, p && p.libelles);
  /* Portail connu, objet non reconnu comme un lead, mais le mail porte les coordonnées d'un prospect ET un bien :
     c'est un lead (le portail a changé son objet). Jamais écarté en silence. */
  if (r.nature === "non_lead" && p) {
    const exp = V.email(mail.expediteur);
    const coord = couples.some((x) => (x.champ === "email" && V.email(x.valeur) && V.email(x.valeur) !== exp) || (x.champ === "telephone" && V.telephone(x.valeur)));
    const bien = couples.some((x) => ["reference", "id_crm", "prix", "ville", "code_postal", "surface"].includes(x.champ) && x.valeur);
    if (coord && bien) { r.nature = "lead"; r.nature_corrigee = "objet inconnu du portail, mais coordonnées du prospect et bien présents"; }
  }
  if (!["non_lead", "interne", "auto_reponse"].includes(r.nature)) depuisFiche(r, couples, L);
  if (p && p.regles && r.nature !== "non_lead") {
    try { p.regles({ L, o: objet, r, texte: corps, liens, conf, mail }); } catch (e) { r.erreur_regle = e.message; }
    for (const k of ["contact", "bien"]) for (const [c, v] of Object.entries(r[k])) if (v !== null && v !== undefined && v !== "" && !r.preuves[k + "." + c]) r.preuves[k + "." + c] = "portail:" + p.id;
    if (r.message && !r.preuves.message) r.preuves.message = "portail:" + p.id;
  }
  /* règle propre au portail, appliquée une fois le mail lu (ex. création de compte : lead seulement avec client ET bien) */
  if (p && p.valider && r.nature !== "non_lead") { try { const n = p.valider({ o: objet, r }); if (n) r.nature = n; } catch (e) { r.erreur_regle = e.message; } }

  /* Mail direct d'un particulier : la référence est souvent dans l'objet (« Réf. 12018360189 », « Monesties #32682 »). */
  if (r.nature === "reponse_campagne") { poser(r, "contact.email", V.email(mail.expediteur), "expediteur"); if (!r.message) { r.message = corps.split("\n").slice(0, 40).join("\n"); r.preuves.message = "corps"; } }
  /* Expéditeur inconnu dont le mail est une fiche de lead (coordonnées + bien) : sans doute un nouveau portail.
     On le traite comme un lead et on le signale pour qu'il soit déclaré. */
  if (r.nature === "direct") {
    const persoExp = /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mac|orange|wanadoo|free|sfr|neuf|laposte|bbox|gmx|web|proton|protonmail)\./i.test(V.email(mail.expediteur) || "");
    const cc = new Set(couples.filter((x) => ["email", "telephone", "nom", "prenom", "nom_complet"].includes(x.champ) && x.valeur).map((x) => x.champ));
    const cb = couples.some((x) => ["reference", "prix", "type", "ville", "code_postal", "surface", "id_crm"].includes(x.champ) && x.valeur);
    const autre = couples.some((x) => (x.champ === "email" && V.email(x.valeur) && V.email(x.valeur) !== V.email(mail.expediteur)) || (x.champ === "telephone" && V.telephone(x.valeur)));
    if (!persoExp && cc.size >= 2 && cb && autre) { r.nature = "lead"; r.portail = "inconnu"; r.portail_inconnu = d; r.portail_nom = d; }
    /* Une plateforme (adresse non personnelle) qui transmet les coordonnées de QUELQU'UN D'AUTRE : ce n'est pas un mail
       direct du prospect. Son nom affiché et son adresse ne sont pas ceux du prospect ; le reste est lu par gabarit ou IA. */
    else if (!persoExp && autre && cc.size >= 1) { r.nature = "inconnu"; r.portail = "inconnu"; r.portail_inconnu = d; r.portail_nom = d; }
  }
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
    /* Envoi en nombre (lien de désinscription, [SPAM], code de connexion…) : pas un particulier. */
    const masse = /(se désinscrire|désinscri|unsubscribe|se désabonner|ne plus recevoir|manage (your )?preferences|view in browser|voir la version en ligne)/i.test(texte) || /^\s*\[spam\]|code de (connexion|vérification)|sign in to|verification code|facture|invoice|commande n°|livraison/i.test(objet) || /^(no-?reply|noreply|newsletter|marketing|news|info|contact|support|notification)s?@/i.test(V.email(mail.expediteur) || "");
    const perso = /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mac|orange|wanadoo|free|sfr|neuf|laposte|bbox|club-internet|numericable|gmx|web|t-online|proton|protonmail|pm|btinternet|sky|virgin|ziggo|kpnmail|telenet|skynet|bluewin|libero|tiscali|freenet|mail|zoho)\./i.test(V.email(mail.expediteur) || "");
    if (masse) r.nature = "inconnu";
    else if (!perso && !r.bien.reference) r.nature = "inconnu";
    else if (!r.bien.reference && !(bienMot && intention)) r.nature = "inconnu";
  }
  /* Réponse d'un particulier à un échange avec un négociateur (« Re: … ») : la référence est dans la citation. */
  if (r.nature === "inconnu" && /^\s*(re|aw|sv)\s*:/i.test(objet) && !r.bien.reference) {
    const re = /(?:\br[ée]f(?:[ée]rence)?\b|\bref\b)\.?\s*(?:de l.annonce|du bien|n°|no\.?)?\s*:?\s*\[?\s*([A-Z]{0,4}-?\d[\w-]{2,})/i;
    const m = objet.match(re) || texte.match(re) || texte.match(/(?:annonce|mandat)\s+(?:n°\s*)?(\d{3,}(?:-\d+)?)/i);
    if (m) { r.nature = "relance"; r.bien.reference = m[1]; r.preuves["bien.reference"] = "citation"; r.reponse_client = true; }
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
  /* Pas de nom dans la fiche : la signature à la fin du message (« Cordialement. / Simon Cloquet-Lafollye »). */
  if (!c.nom && !c.prenom && !c.nom_complet && r.message) {
    const lm = r.message.split("\n").map((x) => x.trim()).filter(Boolean);
    const f = lm.findIndex((x) => /^(bien )?(cordialement|sincèrement|salutations|bien à vous|merci|best regards|kind regards|regards|thanks)\b/i.test(x));
    const cand = f >= 0 ? lm[f + 1] : null;
    if (cand && /^[A-ZÀ-Ÿ][a-zà-ÿA-ZÀ-Ÿ'’.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ][a-zà-ÿA-ZÀ-Ÿ'’.-]+){0,3}$/.test(cand) && cand.length <= 40 && !/agence|immobili|sélection|selection/i.test(cand)) { c.nom_complet = cand; r.preuves["contact.nom_complet"] = "signature"; }
  }
  if (c.nom_complet && !c.nom && !c.prenom) {
    const parts = V.decouperNom(c.nom_complet, "auto");
    if (parts.nom) { c.nom = parts.nom; r.preuves["contact.nom"] = "decoupe"; }
    if (parts.prenom) { c.prenom = parts.prenom; r.preuves["contact.prenom"] = "decoupe"; }
  }
  /* « Nom : Jean Teisseire » sans prénom à part : c'est un nom complet. */
  if (c.nom && !c.prenom && /\S\s+\S/.test(c.nom) && !/^(de|du|des|le|la|van|von|da|di)\s/i.test(c.nom)) {
    const parts = V.decouperNom(c.nom, "auto");
    if (parts.prenom && parts.nom) { c.nom_complet = c.nom; c.nom = parts.nom; c.prenom = parts.prenom; r.preuves["contact.prenom"] = "decoupe"; }
  }
  if (c.nom && !c.nom_complet) c.nom_complet = [c.prenom, c.nom].filter(Boolean).join(" ");
  /* Téléphone donné dans le message (« joignable au 6 63 64 21 87 ») */
  if (!c.telephone && r.message) {
    const m = r.message.match(/(?:\+\d{2}\s?\(?0?\)?\s?|\b0|(?<=\s))[1-9](?:[\s.-]?\d{2}){4}\b/);
    if (m) { const t = V.telephone(/^[1-9]/.test(m[0].trim()) ? "0" + m[0].trim() : m[0]); if (t) { c.telephone = t; r.preuves["contact.telephone"] = "message"; } }
  }
  const b = r.bien;
  for (const k of ["prix", "surface", "pieces", "chambres"]) if (b[k] === null || b[k] === undefined || b[k] === "" || Number.isNaN(b[k])) delete b[k];
  if (b.ville) b.ville = b.ville.replace(/\s+/g, " ").replace(/[,.]+$/, "").trim();
  if (b.reference) b.reference = String(b.reference).trim();
  if (r.message) r.message = r.message.replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);

  if (p && p.id === "site_agence") {
    const s = identifierSite(liens, texte, objet, conf.sites || []);
    if (s) { r.site = s.domaine; r.site_origine = s.origine || s.domaine; r.preuves.site = s.preuve; }
  }

  /* Démarchage déguisé en lead (photographe, référencement, rachat de mandat…) : signalé, jamais décidé ici. */
  if (["lead", "relance", "direct"].includes(r.nature)) {
    const m = String(r.message || "").slice(0, 1500);
    if (/\b(message )?test\b.{0,20}\b(message )?test\b|^\s*test\s*$/i.test(m)) r.suspect = "message de test";
    else if (/(nous avons|j.ai) (déjà )?trouvé (un bien|une maison|notre bien|ce que)|n.(e )?(sommes|suis) plus (intéressé|à la recherche)|no longer (interested|looking)|already found/i.test(m)) r.suspect = "le prospect dit ne plus chercher (à noter dans le CRM)";
    else if (/(photographe|vid[ée]o(graphe)?s? (par )?drone|shooting|home staging|référencement (de|naturel|google)|(création|refonte) de (votre |votre nouveau )?site|visibilité en ligne|nos services|notre agence de communication|partenariat commercial|je vous propose (mes|nos) services|prestataire|devis gratuit|leads? qualifiés|je (réalise|crée|refais) (des|vos|votre)|visite virtuelle 3d|rachat de (votre )?agence|cession (de )?cabinet|résiliation (du|de mon) mandat|résilier (le|mon) mandat)/i.test(m)) r.suspect = "démarchage ou demande qui n'est pas un achat";
  }
  /* Le prospect dit avoir aussi un bien à vendre : c'est un vendeur potentiel. */
  const vend = texte.match(/a(?:-t-il)? un bien à vendre\s*[:?]?\s*(oui|non)/i);
  if (vend && r.a_un_bien_a_vendre === undefined) r.a_un_bien_a_vendre = /oui/i.test(vend[1]);
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
