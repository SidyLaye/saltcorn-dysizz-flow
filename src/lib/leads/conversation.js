/* Conversation d'un dossier (prospect × bien).
   - qui écrit : le prospect, un portail, ou l'équipe de l'agence ;
   - les clés qui relient un mail à un dossier existant (relais du portail, e-mail, téléphone, référence) ;
   - les messages contenus dans le mail : le message du jour et l'historique recopié
     (« Messages précédents » de Leboncoin, citations « Le … a écrit : », « De : … Envoyé : ») ;
   - le commentaire CRM, reconstruit à partir de tous les messages du dossier.
   Tout est déterministe : même entrée, même sortie. */
"use strict";
const crypto = require("crypto");
const { texteMail, cle, sansCitation } = require("./texte");
const V = require("./valeurs");
const { dom } = require("./portails");

const MOIS = { janv: 1, jan: 1, janvier: 1, january: 1, fevr: 2, fev: 2, feb: 2, fevrier: 2, february: 2, mars: 3, mar: 3, march: 3, avr: 4, avril: 4, apr: 4, april: 4, mai: 5, may: 5, juin: 6, jun: 6, june: 6, juil: 7, juillet: 7, jul: 7, july: 7, aout: 8, aug: 8, august: 8, sept: 9, sep: 9, septembre: 9, september: 9, oct: 10, octobre: 10, october: 10, nov: 11, novembre: 11, november: 11, dec: 12, decembre: 12, december: 12 };

/* Date lue dans un texte de mail (FR / EN, formats des portails et des messageries). Rend un ISO ou null. */
const lireDate = (s) => {
  const t = cle(s);
  let m = t.match(/\b(\d{1,2}) ([a-z]{3,9}) (\d{4})(?: a)?(?: (\d{1,2}) (\d{2})(?: (\d{2}))?)?/);
  if (m && MOIS[m[2]]) return iso(+m[3], MOIS[m[2]], +m[1], m[4], m[5], m[6]);
  m = String(s).match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\D+(\d{1,2})[:h](\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const a = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    /* format américain (« On Tuesday, 09/01/26 at 18:39 ») : mois d'abord */
    const us = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|at|am|pm)\b/i.test(s) && +m[1] <= 12;
    return us ? iso(a, +m[1], +m[2], m[4], m[5], m[6]) : iso(a, +m[2], +m[1], m[4], m[5], m[6]);
  }
  m = String(s).match(/\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return iso(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
  return null;
};
/* Les dates écrites dans les mails sont à l'heure de Paris : on les ramène en UTC pour pouvoir trier. */
const iso = (a, mo, j, h, mi, s) => {
  if (!(a > 1990 && a < 2100 && mo >= 1 && mo <= 12 && j >= 1 && j <= 31)) return null;
  const utc = Date.UTC(a, mo - 1, j, +h || 0, +mi || 0, +s || 0);
  const paris = new Date(new Date(utc).toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const decalage = paris.getTime() - new Date(new Date(utc).toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(utc - decalage).toISOString();
};

/* Empreinte d'un message : le même texte, qu'il arrive dans le mail ou recopié plus tard dans l'historique,
   coupé autrement ou suivi d'une signature, donne la même empreinte. */
const empreinte = (role, texte) => crypto.createHash("sha1").update(cle(texte).slice(0, 100)).digest("hex").slice(0, 16);
/* Signature : après la formule de politesse, on garde au plus le nom ; sans formule, on retire
   les dernières lignes qui ne sont que téléphone, site, adresse, e-mail ou réseaux. */
const FORMULE = /^(bien )?(cordialement|sincèrement|salutations|amitiés|bonne (journée|soirée|fin de journée|semaine)|très bonne journée|best regards|kind regards|regards|thanks|merci( beaucoup| d'avance| par avance)?[ ,.!]*$|met vriendelijke groet)/i;
const LIGNE_SIGNATURE = /^(\+?[\d .()-]{8,}|(tél|tel|t|m|mob|portable|fixe|whatsapp)\s*[:.]?\s*\+?[\d .()-]{6,}|www\.|https?:|\S+@\S+\.\w+|\[.*\]|\d{5}\s+[A-ZÀ-Ÿ]|\d+,? (rue|avenue|bd|boulevard|allée|chemin|place|route)\b|(sent from|envoyé de(puis)?) (my|mon)|-{2,}|_{2,})/i;
const sansSignature = (t) => {
  const L = String(t || "").split("\n");
  const f = L.findIndex((l, i) => i > 0 && FORMULE.test(l.trim()));
  if (f > 0) return L.slice(0, Math.min(L.length, f + 2)).filter((l, i, a) => !(i === a.length - 1 && LIGNE_SIGNATURE.test(l.trim()))).join("\n");
  let n = L.length;
  while (n > 1 && (LIGNE_SIGNATURE.test(L[n - 1].trim()) || L[n - 1].trim().length < 3)) n--;
  return L.slice(0, n).join("\n");
};
const propre = (t) => String(t || "").split("\n").map((l) => l.replace(/^(>|&gt;)+\s?/, "").trim()).filter((l) => l && !/^\[?(image|logo|photo)/i.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();

/* Qui écrit ? L'équipe (domaines de l'agence, adresses des négociateurs), un portail, ou le prospect. */
const roleExpediteur = (mail, extraction, conf = {}) => {
  const e = (V.email(mail.expediteur) || "").toLowerCase();
  const d = dom(mail.expediteur);
  const domAgence = (conf.domaines_agence || []).map((x) => x.toLowerCase());
  const equipe = new Set(((conf.routage && conf.routage.personnes) || []).map((p) => String(p.email || "").toLowerCase()).filter(Boolean));
  /* un mail de portail repassé par une boîte de l'agence reste un mail de portail */
  if (extraction && extraction.portail && extraction.portail !== "inconnu" && ["lead", "relance", "recherche", "estimation"].includes(extraction.nature)) return "portail";
  if (equipe.has(e) || domAgence.some((x) => d === x || d.endsWith("." + x))) return "equipe";
  if (extraction && extraction.portail && extraction.portail !== "inconnu") return "portail";
  return "prospect";
};

/* Historique Leboncoin : après « Messages précédents », des blocs « Auteur / 16 août. 2026 11:15:33 / texte ». */
const historiquePortail = (L) => {
  const i = L.findIndex((l) => /^messages? précédents?$|^conversation history$/i.test(l));
  if (i < 0) return [];
  const out = [];
  const estDate = (l) => /^\d{1,2} [a-zéû]{3,9}\.? \d{4} \d{1,2}:\d{2}(:\d{2})?$/i.test(l);
  const FIN = /^(référence|reference)\s*:|^lien\s*:|^retrouvez |^découvrez |^merci de votre confiance|^l.équipe |^si vous ne souhaitez plus/i;
  let cur = null;
  for (let k = i + 1; k < L.length; k++) {
    const l = L[k];
    if (FIN.test(l)) break;
    if (L[k + 1] && estDate(L[k + 1]) && !estDate(l)) { if (cur) out.push(cur); cur = { auteur: l, date: lireDate(L[k + 1]), lignes: [] }; k++; continue; }
    if (cur) cur.lignes.push(l);
  }
  if (cur) out.push(cur);
  /* la dernière ligne du dernier bloc est souvent le titre du bien et son prix : on s'arrête avant */
  /* le dernier bloc se termine par le titre du bien et son prix (« Maison 5 pièces 151 m² », « 120000 € ») */
  const TITRE = /^([A-ZÀ-Ÿ][\wÀ-ÿ'’ -]* \d+ pièces?( \d+ m²)?|[A-ZÀ-Ÿ][\wÀ-ÿ'’ -]* \d+ m²|\d[\d  .]*\s*€)$/;
  return out.map((b) => { const l = b.lignes.slice(); while (l.length && TITRE.test(l[l.length - 1])) l.pop(); return { auteur: b.auteur, date: b.date, texte: propre(l.join("\n")) }; }).filter((b) => b.texte && !/^leboncoin$/i.test(b.auteur));
};

/* Citations d'une réponse par messagerie : « Le … a écrit : », « On … wrote: », « De : … Envoyé : … ». */
const citations = (texte) => {
  const L = String(texte).split("\n");
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const l = L[i].replace(/^(>|&gt;)+\s?/, "");
    if (/^(le|on)\s.{4,160}(a écrit|wrote)\s*:?\s*$/i.test(l)) {
      const email = V.email(l) || "";
      const nom = l.replace(/\s*(a écrit|wrote)\s*:?\s*$/i, "").replace(/<[^>]*>/g, "").replace(/\S+@\S+/g, "").replace(/^.*\d{1,2}[:h]\d{2}(:\d{2})?\s*,?\s*/, "").replace(/^(le|on)\s.*?\d{4},?\s*/i, "").trim();
      out.push({ ligne: i, entete: l, date: lireDate(l), auteur: nom || email, email });
      continue;
    }
    if (/^(de|from)\s*:/i.test(l) && L.slice(i + 1, i + 5).some((x) => /^(>|&gt;)?\s*(envoyé|sent|date)\s*:/i.test(x))) {
      const bloc = L.slice(i, i + 6).map((x) => x.replace(/^(>|&gt;)+\s?/, ""));
      const d = bloc.find((x) => /^(envoyé|sent|date)\s*:/i.test(x)) || "";
      const brut = l.replace(/^(de|from)\s*:\s*/i, "").trim();
      out.push({ ligne: i, entete: l, date: lireDate(d), auteur: brut.replace(/<[^>]*>/g, "").replace(/\S+@\S+/g, "").replace(/["']/g, "").trim() || V.email(brut) || brut, email: V.email(brut) || "" });
    }
  }
  return out.map((c, k) => {
    const fin = k + 1 < out.length ? out[k + 1].ligne : L.length;
    const corps = L.slice(c.ligne + 1, fin).map((x) => x.replace(/^(>|&gt;)+\s?/, "")).filter((x) => !/^(envoyé|sent|date|à|to|cc|objet|subject)\s*:/i.test(x));
    return { auteur: c.auteur, email: c.email, date: c.date, texte: propre(sansSignature(sansCitation(corps.join("\n")))) };
  }).filter((c) => c.texte);
};

/* Clés qui relient un mail à un dossier. Pour une réponse de l'équipe, on les lit dans la citation. */
const cles = (extraction, texteComplet, conf = {}) => {
  const c = (extraction && extraction.contact) || {}, b = (extraction && extraction.bien) || {};
  const out = { relais: c.email_relais || null, email: c.email || null, telephone: c.telephone || null, references: [b.reference, b.reference_portail, b.id_crm].filter(Boolean).map(String) };
  if (!out.email || !out.relais || !out.references.length) {
    const domAgence = (conf.domaines_agence || []).map((x) => x.toLowerCase());
    const mails = (String(texteComplet).match(new RegExp(V.EMAIL_RE.source, "gi")) || []).map((x) => x.toLowerCase());
    const relais = mails.find((x) => /@(messagerie\.leboncoin\.fr|email\.green-acres\.com|reply\.properstar\.com)$/.test(x) && !/^agence-/.test(x));
    const perso = mails.find((x) => !domAgence.some((a) => x.endsWith("@" + a) || x.endsWith("." + a)) && !/(leboncoin|green-acres|properstar|seloger|lefigaro|bienici|immo-facile|noreply|no-reply|support@|info@)/.test(x));
    if (!out.relais && relais) out.relais = relais;
    if (!out.email && perso) out.email = perso;
    if (!out.references.length) {
      const r = String(texteComplet).match(/(?:r[ée]f(?:[ée]rence)?(?: de l.annonce)?|annonce)\s*:?\s*(?:n°\s*)?([A-Z]{0,4}-?\d[\w-]{2,})/i);
      if (r) out.references.push(r[1]);
    }
  }
  return out;
};

/* Messages portés par ce mail. `type` : demande, relance, reponse_equipe, reponse_prospect, historique. */
const messages = (mail, extraction, conf = {}) => {
  const texte = texteMail({ texte: mail.texte ?? mail.corps_texte, html: mail.html ?? mail.corps_html });
  const role = roleExpediteur(mail, extraction, conf);
  const date = mail.date || mail.date_envoi || null;
  const nomPortail = (extraction && extraction.portail_nom) || null;
  const out = [];
  const add = (x) => { if (x.texte && x.texte.length > 1) { const dt = x.date ? new Date(x.date) : null; out.push({ ...x, date: dt && !isNaN(dt) ? dt.toISOString() : null, empreinte: empreinte(x.role, x.texte) }); } };
  const c = (extraction && extraction.contact) || {};
  const prospect = c.nom_complet || [c.prenom, c.nom].filter(Boolean).join(" ") || c.email || "Prospect";
  if (role === "equipe") {
    const n = (String(mail.expediteur || "").match(/^\s*"?([^"<@]+?)"?\s*</) || [])[1] || V.email(mail.expediteur) || "Équipe";
    add({ type: "reponse_equipe", role: "equipe", auteur: n.trim(), date, texte: propre(sansSignature(sansCitation(texte))), source: "mail" });
  } else {
    const principal = (extraction && extraction.message) || propre(sansCitation(texte)).split("\n").slice(0, 40).join("\n");
    const type = extraction && ["relance"].includes(extraction.nature) ? (extraction.reponse_client ? "reponse_prospect" : "relance") : "demande";
    add({ type, role: "prospect", auteur: prospect, via: nomPortail, date, texte: propre(sansSignature(principal)), source: "mail" });
  }
  /* historique recopié par le portail, puis citations des messageries */
  const L = texte.split("\n");
  for (const h of historiquePortail(L)) {
    /* l'agence apparaît sous le nom affiché dans « Bonjour X, » ou sous le nom d'un négociateur / d'un site */
    const noms = [extraction && extraction.agence_nommee, ...((conf.routage && conf.routage.personnes) || []).map((p) => p.nom), ...(conf.sites || []).flatMap((x) => x.noms || [])].filter(Boolean).map(cle);
    const a = cle(h.auteur);
    const deLequipe = noms.some((n) => n && n.length > 3 && (a === n || a.includes(n)));
    add({ type: "historique", role: deLequipe ? "equipe" : "prospect", auteur: h.auteur, via: nomPortail, date: h.date, texte: h.texte, source: "citation" });
  }
  const domAgence = (conf.domaines_agence || []).map((x) => x.toLowerCase());
  const personnes = new Set(((conf.routage && conf.routage.personnes) || []).map((p) => String(p.email || "").toLowerCase()).filter(Boolean));
  for (const q of citations(texte)) {
    const e = (q.email || "").toLowerCase(), d = e.split("@")[1] || "";
    const r = domAgence.some((x) => d === x || d.endsWith("." + x)) || personnes.has(e) ? "equipe" : "prospect";
    /* mail cité venant d'une boîte générale de l'agence ou d'un portail : c'est la notification
       d'origine, son contenu (la demande du prospect) est déjà dans le dossier */
    if (/e-mail d.origine|en-tête d.origine|e-mail envoyé à/i.test(q.texte)) continue;
    if (r === "equipe" && !personnes.has(e) && /^(info|contact|accueil|agence|nonautomatise|noreply|no-reply|chat|siege|leads?)[.\w-]*@/i.test(e)) continue;
    add({ type: "historique", role: r, auteur: q.auteur.replace(/\s*<.*$/, "") || (r === "equipe" ? "Équipe" : "Prospect"), date: q.date, texte: q.texte.split("\n").slice(0, 60).join("\n"), source: "citation" });
  }
  return { role, messages: out, texte };
};

/* Fusionne les messages d'un dossier (sans doublon, du plus ancien au plus récent). */
const fusionner = (anciens = [], nouveaux = []) => {
  const vus = new Map();
  for (const m of [...anciens, ...nouveaux]) {
    const k = m.empreinte || empreinte(m.role, m.texte);
    const deja = vus.get(k);
    /* on garde la version « mail » plutôt que la citation, et la date la plus précise */
    if (!deja || (deja.source === "citation" && m.source === "mail")) vus.set(k, { ...m, date: m.date || (deja && deja.date) || null });
  }
  return [...vus.values()].sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
};

const dateFr = (d) => { if (!d) return ""; const x = new Date(d); return isNaN(x) ? "" : x.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); };

/* Commentaire CRM : toute la conversation, lisible, bornée. Reconstruit à chaque fois (jamais ajouté au bout). */
const commentaire = (msgs, { max = 6000, titre = "Conversation" } = {}) => {
  const bloc = (m) => `[${dateFr(m.date) || "date inconnue"}] ${m.auteur || (m.role === "equipe" ? "Équipe" : "Prospect")}${m.role === "equipe" ? " (agence)" : m.via ? " (via " + m.via + ")" : ""} :\n${String(m.texte).trim()}`;
  const tout = msgs.map(bloc);
  const tete = `${titre} — ${msgs.length} message(s)`;
  let corps = tout.join("\n\n");
  if ((tete + "\n\n" + corps).length > max && tout.length > 2) {
    /* on garde la première demande et les plus récents */
    const garde = [tout[0]]; let taille = tete.length + tout[0].length + 60; const fin = [];
    for (let k = tout.length - 1; k > 0; k--) { if (taille + tout[k].length + 2 > max) break; fin.unshift(tout[k]); taille += tout[k].length + 2; }
    const omis = tout.length - 1 - fin.length;
    corps = [garde[0], omis ? `… ${omis} message(s) plus ancien(s) non repris ici …` : null, ...fin].filter(Boolean).join("\n\n");
  }
  return (tete + "\n\n" + corps).slice(0, max);
};

module.exports = { sansSignature, lireDate, roleExpediteur, historiquePortail, citations, cles, messages, fusionner, commentaire, empreinte };
