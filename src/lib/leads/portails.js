/* Registre des portails : comment reconnaître l'expéditeur, la nature du mail
   (lead, relance, estimation, non-lead) et les règles propres à sa mise en page.
   Les règles communes (fiche « Libellé : valeur ») sont dans fiche.js. */
"use strict";
const V = require("./valeurs");
const { bloc } = require("./fiche");
const { cle } = require("./texte");

const dom = (s) => { const t = String(s || ""); const m = t.match(/<[^>]*@([\w.-]+)>/) || t.match(/@([\w.-]+)/); return m ? m[1].toLowerCase() : ""; };
const ligneApres = (L, re, n = 1) => { const i = L.findIndex((l) => re.test(l)); return i >= 0 ? L[i + n] || "" : ""; };
const cherche = (L, re) => { for (const l of L) { const m = l.match(re); if (m) return m; } return null; };

/* Chaque portail : id, nom, test(expediteur, objet), nature(objet, texte), regles(ctx) qui complète r. */
const PORTAILS = [
  {
    id: "leboncoin", nom: "Leboncoin", test: (d, o) => /(^|\.)leboncoin\.fr$/.test(d),
    nature: (o, t, d) => {
      if (/^messagerie\./.test(d) && /nouveau message pour/i.test(o)) return "lead";
      if (/demande de contact .*page pro/i.test(o)) return "recherche";
      return "non_lead";
    },
    regles: ({ L, o, r, texte }) => {
      const m = o.match(/nouveau message pour\s*[«"“](.+?)[»"”]/i);
      if (m) { r.bien.titre = m[1]; Object.assign(r.bien, V.faitsTitre(m[1]), r.bien); }
      /* L'interlocuteur est la ligne après l'e-mail ; le message est entre « ». */
      const i = L.findIndex((l) => /^e-?mail\s*:/i.test(l));
      if (i >= 0 && L[i + 1] && !/[«"]/.test(L[i + 1]) && !r.contact.nom_complet) r.contact.nom_complet = L[i + 1];
      const g = texte.match(/«\s*([\s\S]*?)\s*»/);
      if (g) r.message = g[1].trim();
      const bonjour = L[0] && L[0].match(/^bonjour\s+(.+?),?$/i);
      if (bonjour) r.agence_nommee = bonjour[1];
      const tail = L.findIndex((l) => /^référence\s*:/i.test(l));
      if (tail > 1) { const pr = V.prix(L[tail - 1]); if (pr) r.bien.prix = pr; }
    },
  },
  {
    id: "green_acres", nom: "Green-Acres", test: (d) => /green-acres\.(com|fr)$/.test(d),
    nature: (o) => (/buyer replied|a répondu|replied/i.test(o) ? "relance" : /demande d.information/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, o, r, texte }) => {
      const ref = texte.match(/\((?:reference|référence)\s*([\w-]+)\)|^(?:reference|référence)\s*:\s*([\w-]+)/im);
      if (ref) r.bien.reference = ref[1] || ref[2];
      const t = o.match(/-\s*([^-]+?)\s*-\s*(?:Achat|Location|Buy|Rent)\s*-\s*(.+?)(?:\s+\d+\s*m²|$)/i);
      if (t) { r.bien.type = V.typeBien(t[1]) || r.bien.type; r.bien.ville = r.bien.ville || t[2].trim(); }
      r.bien.surface = r.bien.surface || V.surface(o); r.bien.prix = r.bien.prix || V.prix(o);
      const pl = L.find((l) => /^[\d  .,]+\s*€$/.test(l)); if (pl) r.bien.prix = V.prix(pl);
      const ty = L.findIndex((l) => /^analyse du profil$/i.test(l)); if (ty >= 0 && V.typeBien(L[ty + 1])) r.bien.type = r.bien.type || V.typeBien(L[ty + 1]);
      const env = L.findIndex((l) => l === "✉"); if (env >= 0) r.contact.email_relais = V.email(L[env + 1]);
      const rep = texte.match(/^(.+?) has replied to you/m) || texte.match(/^(.+?) vous a répondu/m);
      if (rep && !r.contact.nom_complet) r.contact.nom_complet = rep[1];
      const tete = L.findIndex((l) => /^(.+?)\s+-\s+\d{1,2}(\/\d{1,2}\/\d{4}|\s+\w+\s+\d{4})\s+à\s+\d/.test(l));
      if (tete >= 0) {
        if (!r.contact.nom_complet) r.contact.nom_complet = L[tete].replace(/\s+-\s+\d.*$/, "");
        const fin = L.slice(tete + 1).findIndex((l) => /^(vos coordonnées|reply to this|répondez à cet|contact offert|you  ?-|vous  ?-)/i.test(l) || /^(you|vous)\s+-\s+\d/i.test(l));
        r.message = L.slice(tete + 1, fin >= 0 ? tete + 1 + fin : tete + 12).join("\n");
      }
      const tel = L.findIndex((l) => l === "☎");
      if (tel >= 0 && !r.contact.telephone) r.contact.telephone = L[tel + 1];
      const lieu = cherche(L, /^([A-Za-zÀ-ÿ' -]+)\s*\((\d{5})\)$/);
      if (lieu) { r.bien.ville = lieu[1].trim(); r.bien.code_postal = lieu[2]; }
      const f = cherche(L, /(\d+)\s*m²\s*[–-]\s*(\d+)\s*(rooms|pièces)/i);
      if (f) { r.bien.surface = +f[1]; r.bien.pieces = +f[2]; }

    },
  },
  {
    id: "giraffe360", nom: "Giraffe (visite virtuelle restreinte)", test: (d) => /giraffe360\.com$/.test(d),
    nature: (o) => (/prospect|accès accordé|access granted|nouveau prospect/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, r }) => {
      const p = cherche(L, /projet\s*:?\s*(.+?)(?:\s+https?:|$)/i) || [null, ligneApres(L, /^nouveau prospect pour le projet$/i).replace(/\s+https?:.*$/, "")];
      const titre = (p && p[1]) || "";
      if (titre) {
        r.bien.titre = titre;
        const ref = titre.match(/\bREF\.?\s*(\d{3,})/i) || titre.match(/\b(\d{4,6})\b(?!\s*,)/);
        if (ref) r.bien.reference = ref[1];
        const lc = titre.match(/([A-ZÀ-Ÿ' -]{3,})\s*\((\d{5})/);
        if (lc) { r.bien.ville = lc[1].trim(); r.bien.code_postal = lc[2]; }
      }
    },
  },
  {
    id: "seloger", nom: "Se Loger", test: (d) => /seloger\.com$/.test(d),
    nature: (o) => (/acquéreur est intéressé|internaute|locataire|contact/i.test(o) ? "lead" : /confier son projet/i.test(o) ? "recherche" : "non_lead"),
    regles: ({ L, r, texte }) => {
      const n = texte.match(/^(.+?) s'intéresse à ce/m);
      if (n) { r.contact.nom_complet = n[1].replace(/e-?mail\s*:?.*$/i, "").trim(); delete r.contact.nom; delete r.contact.prenom; }
      const i = L.findIndex((l) => /^ref\. de/i.test(l));
      if (i >= 0) { const w = L.slice(i, i + 4).map((l) => l.replace(/^.*?:\s*/, "")); const j = w.findIndex((l) => /^[A-Z]{0,4}-?\d[\w-]*$/i.test(l)); if (j >= 0) r.bien.reference = w[j]; }
      const k = L.findIndex((l) => V.prix(l));
      if (k >= 0) {
        r.bien.prix = V.prix(L[k]);
        const v = L.slice(k + 1, k + 5);
        const cp = v.find((x) => /^\d{5}$/.test(x)); if (cp) r.bien.code_postal = cp;
        if (v[0] && /^[A-ZÀ-Ÿ' -]{2,}$/.test(v[0])) r.bien.ville = v[0];
        const ty = v.find((x) => V.typeBien(x)); if (ty) r.bien.type = V.typeBien(ty);
      }
      if (!r.bien.code_postal) { const lc = L.slice(0, k + 12).map(V.lieu).find((x) => x.code_postal); if (lc) Object.assign(r.bien, lc); }
      const bl = L.slice(k).join(" ");
      r.bien.pieces = r.bien.pieces || V.pieces(bl); r.bien.surface = r.bien.surface || V.surface(bl);
      const m = L.findIndex((l) => /^découvrir$/i.test(l));
      if (m >= 0) { const s = L.slice(m + 1).findIndex((l) => !/^(son|projet)$/i.test(l)); if (s >= 0) r.message = bloc(L, m + 1 + s + 1, L[m + 1 + s]).replace(/\nmailto:[\s\S]*$/, ""); }
      const tel = cherche(L, /^tel:(\+?\d+)/i); if (tel) r.contact.telephone = tel[1];
    },
  },
  {
    id: "figaro", nom: "figaro immo", test: (d) => /^immobilier\.lefigaro\.fr$|explorimmo/.test(d),
    nature: (o) => (/vous adresse un contact|contact|s'intéresse|intéressé/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, o, r, texte }) => {
      const prog = texte.match(/identifiant programme\s*:\s*(\S+)/i);
      if (prog) { r.bien.reference = prog[1]; const cp = texte.match(/code postal du programme\s*:\s*(\d{5})/i); if (cp) r.bien.code_postal = cp[1]; const v = texte.match(/ville du programme\s*:\s*(.+)/i); if (v) r.bien.ville = v[1].trim(); const m = texte.match(/souhaitées par l.internaute\s*:\s*([\s\S]+?)(?:\n-\s|$)/i); if (m) r.message = m[1].trim(); return; }
      const a = o.match(/annonce\s+([\w-]+(?:\s+bis)?)/i) || texte.match(/votre annonce\s+([\w-]+)\s+visible/i);
      if (a) r.bien.reference = a[1];
      const i = L.findIndex((l) => /visible sur/i.test(l));
      if (i >= 0) {
        const v = L.slice(i + 1, i + 6).join(" ");
        r.bien.type = V.typeBien(L[i + 1]) || r.bien.type;
        const cp = v.match(/\b(\d{5})\b/); if (cp) r.bien.code_postal = cp[1];
        r.bien.surface = V.surface(v); r.bien.pieces = V.pieces(v); r.bien.prix = V.prix(v);
      }
    },
  },
  {
    id: "proprietes_figaro", nom: "Propriétés le Figaro", test: (d) => /proprietes\.lefigaro\.fr$/.test(d),
    nature: () => "lead",
    regles: ({ L, texte, r }) => {
      const ref = texte.match(/votre référence\s*:\s*([\w-]+)/i); if (ref) r.bien.reference = ref[1];
      const rp = texte.match(/référence propriétés le figaro\s*:\s*(\d+)/i); if (rp) r.bien.reference_portail = rp[1];
      const i = L.findIndex((l) => /^son projet\s*:/i.test(l));
      if (i >= 0) { const j = L.slice(i + 1).findIndex((l) => !/^(achat|vente|location|maison|appartement|a un bien|[A-ZÀ-Ÿ][\wÀ-ÿ' -]+$)/i.test(l) || l.length > 40); if (j >= 0) r.message = bloc(L, i + 2 + j, L[i + 1 + j]); }
      const k = L.findIndex((l) => /^annonce concernée/i.test(l));
      if (k >= 0) {
        const v = L.slice(k + 1, k + 6);
        const lc = v.map(V.lieu).find((x) => x.ville); if (lc) Object.assign(r.bien, lc);
        const s = v.join(" "); r.bien.prix = V.prix(s); r.bien.surface = V.surface(s); r.bien.pieces = V.pieces(s); r.bien.chambres = V.chambres(s);
        r.bien.type = V.typeBien(v[0]) || r.bien.type;
      }
    },
  },
  {
    id: "french_property", nom: "FRENCH PROPERTY", test: (d) => /french-property\.com$/.test(d),
    nature: (o) => (/enquiry|demande/i.test(o) && !/confirmation/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, texte, r }) => {
      const ref = texte.match(/(?:enquiry - ref|demande de renseignements - réf\.?)\s*:\s*([\w-]+)/i); if (ref) r.bien.reference = ref[1];
      const i = L.findIndex((l) => /^(property details|détails du bien)/i.test(l));
      if (i >= 0) { r.bien.titre = L[i + 1]; const s = L.slice(i + 1, i + 5).join(" "); r.bien.prix = V.prix(s); const lo = texte.match(/(?:location|lieu)\s*:\s*(.+)/i); if (lo) { const parts = lo[1].split(","); r.bien.ville = parts[parts.length - 1].trim(); const dep = lo[1].match(/\((\d{2})\)/); if (dep) r.bien.departement = dep[1]; } }
      const m = L.findIndex((l) => /^message\s*:/i.test(l));
      if (m >= 0) {
        const msg = bloc(L, m + 1, L[m].replace(/^message\s*:\s*/i, ""));
        const req = L.slice(m + 1).filter((l, j, a) => /^requests\s*:/i.test(a[0]) || true);
        const q = texte.match(/(?:requests|demandes)\s*:\s*\n([\s\S]*?)\n(?:purchase timescale|calendrier d'achat|property details|détails du bien)/i);
        r.message = [msg, q ? "Demandes : " + q[1].replace(/\n/g, ", ").replace(/\*\s*/g, "") : ""].filter(Boolean).join("\n");
      }
    },
  },
  {
    id: "properstar", nom: "Properstar", test: (d) => /properstar\.com$/.test(d),
    nature: (o) => (/nouveau message|new message|demande/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, texte, r }) => {
      const n = texte.match(/=\s*(?:nouveau message de|new message from)\s+(.+?)\s*=/i); if (n) r.contact.nom_complet = n[1];
      const i = L.findIndex((l) => /^=\s*(nouveau message|new message)/i.test(l));
      if (i >= 0) r.message = bloc(L, i + 1);
      const j = L.findIndex((l) => /annonce désirée|desired listing/i.test(l));
      if (j >= 0) { const s = L.slice(j + 1, j + 5).join(" "); r.bien.titre = L[j + 1]; const pt = L.slice(j + 1, j + 5).find((l) => /·/.test(l)); r.bien.type = V.typeBien(pt ? pt.split("·")[0] : L[j + 1]); r.bien.surface = V.surface(s); r.bien.pieces = V.pieces(s); r.bien.chambres = V.chambres(s); r.bien.prix = V.prix(s); }
    },
  },
  {
    id: "bienici", nom: "BIEN ICI", test: (d) => /bienici\.com$/.test(d),
    nature: (o) => (/contact .*acquéreur|contact prospect|contact vendeur/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, o, texte, liens, r }) => {
      const a = o.match(/annonce\s+([\w-]+)\s+à\s+(.+)$/i); if (a) { r.bien.reference = a[1]; r.bien.ville = a[2].trim(); }
      const id = liens.map((u) => u.match(/immo-facile-(\d{6,})/)).find(Boolean); if (id) r.bien.id_crm = id[1];
      const c = texte.match(/ses coordonnées\s*([^\n]+?)\s+téléphone\s*:\s*([+\d ().-]+)/i);
      if (c) { r.contact.nom_complet = c[1].trim(); r.contact.telephone = c[2]; }
      const i = L.findIndex((l) => /^rappel de l.annonce/i.test(l));
      if (i >= 0) { const v = L.slice(i + 1, i + 5); const s = v.join(" "); r.bien.type = V.typeBien(v[0]); r.bien.pieces = V.pieces(s); r.bien.surface = V.surface(s); r.bien.prix = V.prix(s); const lc = v.map(V.lieu).find((x) => x.code_postal); if (lc) Object.assign(r.bien, lc); }
      const m = texte.match(/(?:son message|message)\s*:\s*\n?([\s\S]*?)\n(?:rappel de l|voir l)/i); if (m && !r.message) r.message = m[1].trim();
    },
  },
  {
    id: "site_agence", nom: "Site d'agence (AC3)", test: (d) => /ac3-groupe\.com$/.test(d),
    nature: (o) => (/demande|request|création compte|account/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, texte, r }) => {
      const cl = texte.match(/(?:client|customer)\s*:\s*([^\n]+)/i);
      if (cl) {
        const parts = cl[1].replace(/\s+(e-?mail|t[ée]l[ée]phone|phone)\s*:.*$/i, "").split(/\s+-\s+/).map((x) => x.trim());
        const em = parts.find((x) => V.email(x)), tel = parts.find((x) => V.telephone(x) && !V.email(x));
        const noms = parts.filter((x) => x !== em && x !== tel && !/email|t[ée]l/i.test(x));
        if (noms.length >= 2 && noms.every((x) => !/\s/.test(x))) { r.contact.nom = noms[0]; r.contact.prenom = noms[1]; }
        else if (noms.length) r.contact.nom_complet = noms.join(" ");
        if (em) r.contact.email = V.email(em);
        if (tel) r.contact.telephone = tel;
      }
      const de = texte.match(/(?:TEXT_DE|^De)\s*:\s*(.+?)\s+-\s+(\S+@\S+)/im);
      if (de) { r.contact.email = r.contact.email || V.email(de[2]); if (!r.contact.nom && !r.contact.nom_complet) r.contact.nom_complet = de[1]; }
      const ref = texte.match(/\((?:reference|référence)\s*:\s*([\w-]+)\)/i); if (ref) r.bien.reference = ref[1];
      const b = texte.match(/^(?:Biens?|Properties)\s+(.+?)\s*\((?:reference|référence)/im) || texte.match(/^(.+?)\s*\((?:reference|référence)\s*:/im);
      if (b) { r.bien.titre = b[1]; Object.assign(r.bien, { ...V.faitsTitre(b[1]), ...r.bien }); const v = b[1].match(/(?:^|\s)à\s+([\wÀ-ÿ' -]+)$/i); if (v && !r.bien.ville) r.bien.ville = v[1]; }
      const nego = texte.match(/(?:nego|pour l'agence|for the real estate)\s*:\s*([^\n]+?)(?:\s+(?:client|customer)\s*:|$)/im); if (nego && nego[1].trim()) r.agence_nommee = nego[1].trim();
      const i = L.findIndex((l) => /^(message du client|customer message)\s*:?$/i.test(l));
      if (i >= 0) {
        const msg = bloc(L, i + 1).replace(/^(properties|biens?)$/im, "");
        const fl = texte.match(/->\s*([\s\S]*?)\n(?:properties|biens?)\n/i);
        r.message = (fl ? fl[1] : msg).trim();
      }
      const d = texte.match(/délai du projet\s*:\s*(.+)/i); if (d) r.delai = d[1].trim();
      const oc = texte.match(/origine du contact\s*:\s*(.+)/i); if (oc) r.origine_declaree = oc[1].trim();
      if (/n'a pas accepté d'?[eê]tre recontacté par e-?mail/i.test(texte)) r.consentement_email = false;
    },
  },
  {
    id: "bellespierres", nom: "Belles Pierres", test: (d) => /bellespierres\.com$/.test(d), nature: (o) => (/demande/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, r }) => {
      const i = L.findIndex((l) => /^vous avez une demande d/i.test(l) && !/sur bellespierres/i.test(l));
      if (i >= 0) { const s = L.slice(i + 1, i + 6).join(" "); r.bien.titre = L[i + 1]; r.bien.type = V.typeBien(L[i + 1]); r.bien.prix = V.prix(s); r.bien.surface = V.surface(s); r.bien.pieces = V.pieces(s); r.bien.chambres = V.chambres(s); const v = L[i + 1].match(/.*(?:^|\s)à\s+([^:|]+?)\s*:/); if (v) r.bien.ville = v[1].trim(); }
      const k = L.findIndex((l) => /^référence de l.annonce\s*:?$/i.test(l)); if (k >= 0) r.bien.reference = L[k + 1];
    },
  },
  {
    id: "ma_propriete", nom: "Ma Propriété.fr", test: (d) => /ma-propriete\.fr$/.test(d), nature: (o) => (/message|projet/i.test(o) ? "lead" : "non_lead"),
    regles: ({ texte, liens, r }) => { const t = texte.match(/titre de l.annonce\s*\*?\s*:\s*\*?\s*(.+?)\s*\*?$/im); if (t) r.bien.titre = t[1]; const u = liens.map((x) => x.match(/ma-propriete\.fr\/fr\/[^?]*\/([a-z-]+)\/[^/?]+\?prix=(\d+)/)).find(Boolean); if (u) r.bien.prix = +u[2]; },
  },
  {
    id: "rightmove", nom: "RIGHTMOVE", test: (d) => /rightmove\.co\.uk$/.test(d), nature: (o) => (/lead|enquiry/i.test(o) ? "lead" : "non_lead"),
    regles: ({ texte, r }) => {
      const a = texte.match(/^address:\s*(.+)$/im); if (a) { const p = a[1].split(","); r.bien.ville = p[p.length - 1].trim(); }
      const b = texte.match(/^bedrooms:\s*(\d+)/im); if (b) r.bien.chambres = +b[1];
      const t = texte.match(/^type:\s*(.+)$/im); if (t) r.bien.type = V.typeBien(t[1]);
      const ph = texte.match(/^phone:\s*(\d{10,})/im); if (ph) r.contact.telephone = "+" + ph[1];
    },
  },
  {
    id: "paruvendu", nom: "Paru-vendu", test: (d) => /paruvendu(pro)?\.fr$/.test(d), nature: (o) => (/contact/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, o, texte, r }) => {
      const ref = o.match(/réf\.\s*:\s*([\w]+)/i) || texte.match(/réf\. pro\s*:\s*(\S+)/i); if (ref) r.bien.reference_portail = ref[1];
      const own = (r.bien.reference_portail || "").match(/_(\d+)$/); if (own) r.bien.reference = own[1];
      const i = L.findIndex((l) => /^réf\. pro/i.test(l));
      if (i >= 0) { const s = L.slice(i + 1, i + 3).join(" "); r.bien.prix = V.prix(s); r.bien.surface = V.surface(s); r.bien.pieces = V.pieces(s); r.bien.type = V.typeBien(s); const lc = s.match(/([\wÀ-ÿ' -]+)\s*\((\d{5})\)/); if (lc) { r.bien.ville = lc[1].replace(/^.*€\s*/, "").trim(); r.bien.code_postal = lc[2]; } }
      const k = L.findIndex((l) => /^répondez à ce contact/i.test(l)); if (k >= 0) { r.contact.nom_complet = L[k + 2]; delete r.contact.nom; delete r.contact.prenom; }
      const m = L.findIndex((l) => /^voici son message/i.test(l)); if (m >= 0) r.message = bloc(L, m + 1).replace(/\nmailto:.*$/s, "");
    },
  },
  {
    id: "jestimo", nom: "Jestimo estimation en ligne", test: (d) => /jestim(o|online)\.(com|fr)$/.test(d), nature: (o) => (/piste|réaction|estimation/i.test(o) ? "estimation" : "non_lead"),
    regles: ({ texte, r }) => {
      const c = texte.match(/contacter\s+(.+?)\s+sur l.adresse email\s+(\S+@\S+?)\s+ou au\s+([+\d ]+)/i);
      if (c) { r.contact.nom_complet = c[1]; r.contact.email = V.email(c[2]); r.contact.telephone = c[3]; }
      const a = texte.match(/située (?:au|à)\s+(.+?),\s*(\d{5})\s+([A-Za-zÀ-ÿ' -]+?)(?:\s+a\s|\.|\n|$)/i); if (a) { r.bien.adresse = a[1]; r.bien.code_postal = a[2]; r.bien.ville = a[3].trim(); }
      const e = texte.match(/pré-estimation du bien\s*:\s*([\d  ]+)\s*€/i); if (e) r.bien.prix = V.prix(e[1] + " €");
    },
  },
  { id: "ekonsilio", nom: "eKonsilio (chat)", test: (d) => /ekonsilio\.(fr|com)$/.test(d), nature: (o, t) => (/nouvelle demande de contact/i.test(t) ? "lead" : "non_lead"), regles: ({ texte, r }) => { const m = texte.match(/# commentaire\s*\n([\s\S]*?)\n#/i); if (m) r.message = m[1].trim(); } },
  { id: "zefir", nom: "Zefir (Zefir)", test: (d) => /zefir\.fr$/.test(d), nature: () => "estimation" },
  { id: "huisenaanbod", nom: "HUISenAANBOD.nl", test: (d) => /huisenaanbod\.nl$/.test(d), nature: () => "lead" },
  { id: "kyero", nom: "KYERO", test: (d) => /kyero\.com$/.test(d), nature: () => "lead" },
  { id: "jamesedition", nom: "JAMES EDITION", test: (d) => /jamesedition\.com$/.test(d), nature: () => "lead" },
  { id: "chateauxpourtous", nom: "Châteaux pour tous", test: (d, o) => /chateauxpourtous/.test(d) || /^chateauxpourtous a un contact/i.test(o), nature: () => "lead",
    regles: ({ L, o, r }) => { const m = o.match(/ref\.\s*([\w-]+)/i); if (m) r.bien.reference = m[1]; r.bien.prix = V.prix(o); const i = L.findIndex((l) => /^il s.agit de/i.test(l)); if (i >= 0) { r.contact.nom_complet = V.nomPropre(L[i + 1].replace(/^monsieur ou madame\s+/i, "").replace(/^(miss|mister|mr|mrs|ms)\s+/i, "")); delete r.contact.nom; delete r.contact.prenom; } } },
  { id: "meretdemeures", nom: "MERS ET DEMEURES", test: (d) => /meretdemeures|mersetdemeures/.test(d), nature: () => "lead" },
  { id: "moulin", nom: "Moulin.nl", test: (d) => /moulin\.nl$/.test(d), nature: () => "lead" },
  { id: "idealista", nom: "Idealista", test: (d) => /idealista\.(fr|com)$/.test(d), nature: (o) => (/contact|message|demande|intéress/i.test(o) && !/compte|mot de passe|bienvenue/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, o, r }) => {
      const n = o.match(/message de (.+?) concernant/i); if (n) { r.contact.nom_complet = n[1]; delete r.contact.nom; delete r.contact.prenom; }
      const e = L.findIndex((l) => V.email(l) && !/idealista/.test(l)); if (e >= 0) { r.contact.email = V.email(L[e]); const f = L.slice(e + 1).findIndex((l) => /^(réponse depuis|réf\.|code de l)/i.test(l)); r.message = L.slice(e + 1, f >= 0 ? e + 1 + f : e + 8).join("\n"); }
      const t = L.find((l) => /^\+?[\d ]{9,}/.test(l)); if (t) r.contact.telephone = t.replace(/\[.*$/, "");
      const pr = L.find((l) => /^[\d.  ]+\s*€$/.test(l)); if (pr) r.bien.prix = V.prix(pr);
      const a = o.match(/réf\.\s*:\s*(\w+),\s*([^,]+?)\s*-\s*.*,\s*([^,]+)$/i); if (a) { r.bien.reference = a[1]; r.bien.type = V.typeBien(a[2]); r.bien.ville = a[3].trim(); }
    } },
  { id: "arkadia", nom: "Arkadia", test: (d, o) => /arkadia/.test(d) || /sur arkadia/i.test(o), nature: () => "lead", regles: ({ o, r }) => { const m = o.match(/annonce n°\s*([\w-]+)/i); if (m) r.bien.reference_portail = m[1]; } },
  { id: "snpi", nom: "Sites partenaires SNPI (Apimo)", test: (d, o) => /apimo\.(com|net|fr)$/.test(d) && /demande|contact/i.test(o), nature: () => "lead" },
  { id: "adapt", nom: "Adapt immobilier", test: (d) => /adaptinformatique\.fr$|adaptimmobilier/.test(d), nature: () => "lead" },
  { id: "annonces_diverses", nom: "Autres portails", test: (d) => /(stonimmo\.com|annonce-immobilier\.com|lesiteimmo\.com|superimmo(pro)?\.com|contact\.superimmopro\.com|belles-demeures|jetrouvetous\.fr|immobilier\.email)$/.test(d), nature: (o) => (/contact|demande|message|intéress|lead/i.test(o) ? "lead" : "non_lead") },
  /* Rapport de quarantaine anti-spam : ce n'est pas un lead mais il peut en cacher. */
  { id: "vade", nom: "Rapport anti-spam", test: (d) => /vadesecure\.com$/.test(d), nature: () => "alerte_spam",
    regles: ({ texte, r }) => { r.bloques = (texte.match(/^.{3,40}\|.+\|\s*\d+\s*k\s*\|.+$/gm) || []).map((l) => l.split("|")[0].trim()).filter((x) => /properstar|green|leboncoin|seloger|figaro|bienici|rightmove|french|giraffe|ac3|immo/i.test(x)); } },
  { id: "bruit", nom: "Service / newsletter", test: (d) => /(immo-facile\.fr|toutvendre\.fr|opinionsystem\.fr|notaires\.fr|cci\.fr|tiktok\.com|news\.leboncoin\.fr|gestiviag\.com|communication-snpi\.com|centre-conventions-collectives\.fr|linkedin\.com|facebookmail\.com|google\.com)$/.test(d), nature: () => "non_lead" },
];

const detecter = (mail) => {
  const d = dom(mail.expediteur), o = String(mail.objet || "");
  return PORTAILS.find((p) => p.test(d, o)) || null;
};

module.exports = { PORTAILS, detecter, dom };
