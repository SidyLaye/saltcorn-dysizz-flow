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
      if ((/^messagerie\./.test(d) || !/leboncoin/.test(d)) && /nouveau message pour/i.test(o)) return "lead";
      if (/demande de contact .*page pro/i.test(o)) return "recherche";
      return "non_lead";
    },
    regles: ({ L, o, r, texte }) => {
      const m = o.match(/nouveau message pour\s*[«"“](.+?)[»"”]/i);
      if (m) { r.bien.titre = m[1]; Object.assign(r.bien, V.faitsTitre(m[1]), r.bien); }
      /* L'interlocuteur est la ligne après l'e-mail ; le message est entre « ». */
      const i = L.findIndex((l) => /^e-?mail\s*:/i.test(l));
      if (i >= 0 && L[i + 1] && !/[«"]/.test(L[i + 1]) && !/^[^:]{2,25}:/.test(L[i + 1]) && !r.contact.nom_complet) r.contact.nom_complet = L[i + 1];
      /* message suivant d'une conversation : pas d'e-mail, le nom est juste avant le message « … » */
      if (i < 0 && !r.contact.nom_complet) { const k = L.findIndex((l) => /^vous avez un nouveau message/i.test(l)); if (k >= 0 && L[k + 1] && /^[«"]/.test(L[k + 2] || "") && !/[«":]/.test(L[k + 1])) r.contact.nom_complet = L[k + 1]; }
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
    nature: (o) => (/buyer replied|a répondu|replied/i.test(o) ? "relance" : /demande d.information|nouveau contact|new contact/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, o, r, texte }) => {
      const ref = texte.match(/\((?:reference|référence)\s*([\w-]+)\)|^(?:reference|référence)\s*:\s*([\w-]+)/im);
      if (ref) r.bien.reference = ref[1] || ref[2];
      if (!r.bien.reference) { const rm = texte.match(/r[ée]f[ée]rence (?:de l.annonce )?(?:est|is)\s*:?\s*([\w-]*\d[\w-]*)/i); if (rm) r.bien.reference = rm[1]; }
      const t = o.match(/-\s*([^-]+?)\s*-\s*(?:Achat|Location|Buy|Rent)\s*-\s*(.+?)(?:\s+\d+\s*m²|$)/i);
      if (t) { r.bien.type = V.typeBien(t[1]) || r.bien.type; r.bien.ville = r.bien.ville || t[2].trim(); }
      r.bien.surface = r.bien.surface || V.surface(o); r.bien.prix = r.bien.prix || V.prix(o);
      const pl = L.find((l) => /^[\d  .,]+\s*€$/.test(l)); if (pl) r.bien.prix = V.prix(pl);
      const ty = L.findIndex((l) => /^analyse du profil$/i.test(l)); if (ty >= 0 && V.typeBien(L[ty + 1])) r.bien.type = r.bien.type || V.typeBien(L[ty + 1]);
      const env = L.findIndex((l) => l === "✉"); if (env >= 0 && !/^agence-/i.test(L[env + 1] || "")) r.contact.email_relais = V.email(L[env + 1]);
      const rep = texte.match(/^(.+?) has replied to you/m) || texte.match(/^(.+?) vous a répondu/m);
      if (rep && !r.contact.nom_complet) r.contact.nom_complet = rep[1];
      const tete = L.findIndex((l) => /^(.+?)\s+-\s+\d{1,2}(\/\d{1,2}\/\d{4}|\s+\w+\s+\d{4})(\s+à\s+\d.*)?$/.test(l));
      if (tete >= 0) {
        if (!r.contact.nom_complet) r.contact.nom_complet = L[tete].replace(/\s+-\s+\d.*$/, "");
        const fin = L.slice(tete + 1).findIndex((l) => /^(vos coordonnées|reply to this|répondez à cet|contact offert|you  ?-|vous  ?-)/i.test(l) || /^(you|vous)\s+-\s+\d/i.test(l));
        r.message = L.slice(tete + 1, fin >= 0 ? tete + 1 + fin : tete + 12).join("\n");
      }
      const tel = L.findIndex((l) => l === "☎");
      if (tel >= 0 && !r.contact.telephone) r.contact.telephone = L[tel + 1];
      /* Green-Acres affiche souvent la grande ville la plus proche, pas la commune du bien. */
      r.bien.lieu_approche = true;
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
      if (r.contact.nom && /\s/.test(r.contact.nom) && !r.contact.prenom) { r.contact.nom_complet = r.contact.nom; delete r.contact.nom; }
      const p = cherche(L, /projet\s*:?\s*(.+?)(?:\s+https?:|$)/i) || [null, ligneApres(L, /^nouveau prospect pour le projet$/i).replace(/\s+https?:.*$/, "")];
      const titre = (p && p[1]) || "";
      if (titre) {
        r.bien.titre = titre;
        const ref = titre.match(/\bREF\.?\s*(\d{3,})/i) || titre.match(/\b(\d{4,6})\b(?!\s*,)/);
        if (ref) r.bien.reference = ref[1];
        /* référence accolée à des lettres (« SEL12345 ») : essayée telle quelle, puis comme référence du portail */
        const colle = titre.match(/\b([A-Z]{2,6}-?\d{3,6})\b/);
        if (colle) { if (!r.bien.reference) r.bien.reference = colle[1]; else if (colle[1] !== r.bien.reference) r.bien.reference_portail = colle[1]; }
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
      const fin = L.findIndex((l) => /^ref\. de/i.test(l));
      const lo = L.slice(0, fin > 0 ? fin : 40).map(V.loyer).find(Boolean); if (lo) { r.bien.loyer = lo; r.projet = "location"; }
      const k = L.findIndex((l, j) => (fin < 0 || j < fin) && (V.prix(l) || V.loyer(l)));
      if (k >= 0) {
        if (V.prix(L[k])) r.bien.prix = V.prix(L[k]);
        const v = L.slice(k + 1, k + 5);
        const cp = v.find((x) => /^\d{5}$/.test(x)); if (cp) r.bien.code_postal = cp;
        if (v[0] && /^[A-ZÀ-Ÿ' -]{2,}$/.test(v[0])) r.bien.ville = v[0];
        const ty = v.find((x) => V.typeBien(x)); if (ty) r.bien.type = V.typeBien(ty);
      }
      /* « CARCASSONNE, 11000 » (SeLoger Luxe) */
      const vc = cherche(L.slice(0, fin > 0 ? fin : 40), /^([A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ' -]+),\s*(\d{5})$/);
      if (vc) { r.bien.ville = vc[1].trim(); r.bien.code_postal = vc[2]; }
      if (!r.bien.code_postal) { const lc = L.slice(0, k + 12).filter((l) => !/annonce|contact|r[ée]f|client/i.test(l)).map(V.lieu).find((x) => x.code_postal); if (lc) Object.assign(r.bien, lc); }
      const bl = L.slice(k).join(" ");
      r.bien.pieces = r.bien.pieces || V.pieces(bl); r.bien.surface = r.bien.surface || V.surface(bl);
      const m = L.findIndex((l) => /^découvrir$/i.test(l));
      if (m >= 0) { const s = L.slice(m + 1).findIndex((l) => !/^(son|projet)$/i.test(l)); if (s >= 0) r.message = bloc(L, m + 1 + s + 1, L[m + 1 + s]).replace(/\nmailto:[\s\S]*$/, ""); }
      /* le téléphone du prospect est avant le pied de page (où SeLoger met son propre numéro) */
      const pied = L.findIndex((l) => /^ce message a été envoyé|^pour toutes questions|^cet email vous est adressé|^mes interlocuteurs/i.test(l));
      const tel = cherche(pied > 0 ? L.slice(0, pied) : L, /^<?tel:(\+?[\d ]{8,})/i); if (tel) r.contact.telephone = tel[1].replace(/\s+/g, "");
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
        const fin = L.slice(i + 1).findIndex((l) => /^voir votre annonce|^voici ses coordonnées/i.test(l));
        const v = L.slice(i + 1, fin > 0 ? i + 1 + fin : i + 9).join(" ");
        r.bien.type = L.slice(i + 1, i + 6).map(V.typeBien).find(Boolean) || r.bien.type;
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
      /* le projet (« Achat », la ville, les types, « A un bien à vendre ») précède le vrai message */
      if (r.message && /a un bien à vendre\s*:/i.test(r.message)) { const v = r.message.match(/a un bien à vendre\s*:\s*(oui|non)/i); if (v) r.a_un_bien_a_vendre = /oui/i.test(v[1]); r.message = r.message.split("\n").slice(r.message.split("\n").findIndex((l) => /a un bien à vendre\s*:/i.test(l)) + 1).join("\n").trim(); }
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
      /* la référence du BIEN (« Détails du bien - Réf. », « votre bien N ») d'abord ; celle de la demande ensuite */
      const rb = texte.match(/(?:property details - ref|détails du bien - réf\.?)\s*:\s*([\w-]+)/i) || texte.match(/(?:enquiry on your property|demande concernant votre bien)\s+([\w-]+)/i);
      const rd = texte.match(/(?:enquiry - ref|demande de renseignements - réf\.?)\s*:\s*([\w-]+)/i);
      if (rb) r.bien.reference = rb[1]; else if (rd) r.bien.reference = rd[1];
      if (rd && rb && rd[1] !== rb[1]) r.bien.reference_portail = rd[1];
      const i = L.findIndex((l) => /^(property details|détails du bien)/i.test(l));
      if (i >= 0) {
        /* sous « Détails du bien » : parfois une ligne avec l'identifiant du bien, puis le titre, le prix, « Lieu : Région, Département (NN), Commune » */
        const sous = L.slice(i + 1, i + 6);
        const idl = sous.find((l) => /\b6\d{7}\b/.test(l) && !/[€$£]/.test(l)); if (idl) r.bien.id_crm = idl.match(/\b(6\d{7})\b/)[1];
        r.bien.titre = sous.find((l) => l !== idl && /[a-zà-ÿ]{3}/i.test(l) && !/^(location|lieu)\s*:/i.test(l)) || L[i + 1];
        r.bien.prix = V.prix(sous.filter((l) => l !== idl).join(" "));
        const lo = texte.match(/(?:location|lieu)\s*:\s*(.+)/i);
        if (lo) {
          const parts = lo[1].split(",").map((x) => x.trim()), k = parts.findIndex((x) => /\(\d{2,3}\)/.test(x));
          const ville = k >= 0 ? parts[k + 1] || null : parts[parts.length - 1];
          if (ville && !/^(france|frankrijk|frankreich|francia)$/i.test(ville)) r.bien.ville = ville;
          const dep = lo[1].match(/\((\d{2,3})\)/); if (dep) r.bien.departement = dep[1];
        }
      }
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
      if (j >= 0) { const fin = L.slice(j + 1).findIndex((l) => /^==/.test(l)); const s = L.slice(j + 1, fin > 0 ? j + 1 + fin : j + 8).join(" "); r.bien.titre = L[j + 1]; const pt = L.slice(j + 1, j + 5).find((l) => /·/.test(l)); r.bien.type = V.typeBien(pt ? pt.split("·")[0] : L[j + 1]); r.bien.surface = V.surface(s); r.bien.pieces = V.pieces(s); r.bien.chambres = V.chambres(s); r.bien.prix = V.prix(s); }
    },
  },
  {
    id: "bienici", nom: "BIEN ICI", test: (d) => /bienici\.com$/.test(d),
    nature: (o) => (/contact .*acquéreur|contact prospect|contact vendeur|contact candidat|contact bailleur|locataire|tenté de vous contacter/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, o, texte, liens, r }) => {
      const appel = (o + "\n" + texte).match(/(?:rappelez-le au|pouvez le rappeler à ce numéro\s*:?)\s*([+\d][\d .]{8,})/i);
      if (appel) { r.contact.telephone = appel[1].trim(); r.appel_manque = true; if (!r.message) r.message = "Appel manqué : le prospect a tenté de joindre l'agence par téléphone (Bien'ici)."; }
      if (/locataire/i.test(o)) r.projet = "location";
      const a = o.match(/annonce\s+([\w-]+)\s+à\s+(.+)$/i); if (a) { r.bien.reference = a[1]; r.bien.ville = a[2].trim(); }
      /* at_id_compte=immo-facile-405876 : c'est le compte (l'agence) chez Bien'ici, pas le bien */
      const id = liens.map((u) => u.match(/at_id_compte=immo-facile-(\d{5,7})\b/)).find(Boolean); if (id) r.agence_crm = id[1];
      const pid = liens.map((u) => u.match(/immo-facile-(\d{8})\b/)).find(Boolean); if (pid) r.bien.id_crm = pid[1];
      const c = texte.match(/ses coordonnées\s*([^\n]+?)\s+téléphone\s*:\s*([+\d ().-]+)/i);
      if (c) { r.contact.nom_complet = c[1].trim(); r.contact.telephone = c[2]; }
      const i = L.findIndex((l) => /^rappel de l.annonce/i.test(l));
      if (i >= 0) { const v = L.slice(i + 1, i + 5); const s = v.join(" "); r.bien.type = V.typeBien(v[0]); r.bien.pieces = V.pieces(s); r.bien.surface = V.surface(s); r.bien.prix = V.prix(s); const lc = v.map(V.lieu).find((x) => x.code_postal); if (lc) Object.assign(r.bien, lc); }
      const m = texte.match(/(?:son message|message)\s*:\s*\n?([\s\S]*?)\n(?:rappel de l|voir l)/i); if (m && !r.message) r.message = m[1].trim();
    },
  },
  {
    id: "site_agence", nom: "Site d'agence (AC3)", test: (d) => /ac3-groupe\.com$/.test(d),
    /* création de compte sur le site : un lead seulement si le mail porte le client (e-mail ou téléphone) ET un bien */
    valider: ({ o, r }) => (/cr[ée]ation (de )?compte|account creation|account created/i.test(o)
      ? ((r.contact.email || r.contact.telephone) && (r.bien.reference || r.bien.titre || r.bien.id_crm) ? "lead" : "non_lead") : null),
    nature: (o) => (/résolution de votre demande|demande d.assistance|ticket/i.test(o) ? "non_lead" : /demande|request|création compte|account/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, o, texte, r }) => {
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
      /* l'agence dont le site a reçu la demande (« Demande auprès de SELECTION HABITAT », « Request to … ») : c'est elle la source, pas AC3 */
      const ag = String(o || "").match(/(?:demande auprès de|request to|création (?:de )?compte sur|account creation on)\s+(.+?)\s*$/i);
      if (ag && ag[1].trim()) { const n = V.nomPropre(ag[1].trim()); r.site_nom = n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : n; }
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
      const idc = (r.bien.reference_portail || "").match(/^(6\d{7})_/); if (idc) r.bien.id_crm = idc[1];
      const i = L.findIndex((l) => /^réf\. pro/i.test(l));
      if (i >= 0) { const s = L.slice(i + 1, i + 3).join(" "); r.bien.prix = V.prix(s); r.bien.surface = V.surface(s); r.bien.pieces = V.pieces(s); r.bien.type = V.typeBien(s); const lc = s.match(/([\wÀ-ÿ' -]+)\s*\((\d{5})\)/); if (lc) { r.bien.ville = lc[1].replace(/^.*€\s*/, "").trim(); r.bien.code_postal = lc[2]; } }
      const k = L.findIndex((l) => /^répondez à ce contact/i.test(l)); if (k >= 0) { r.contact.nom_complet = L[k + 2]; delete r.contact.nom; delete r.contact.prenom; }
      const m = L.findIndex((l) => /^voici son message/i.test(l)); if (m >= 0) r.message = bloc(L, m + 1).replace(/\nmailto:.*$/s, "");
    },
  },
  {
    id: "jestimo", nom: "Jestimo estimation en ligne", test: (d) => /jestim(o|online)\.(com|fr)$/.test(d), nature: (o) => (/piste|réaction|estimation|rendez-vous/i.test(o) ? "estimation" : "non_lead"),
    regles: ({ texte, r }) => {
      const c = texte.match(/contacter\s+(.+?)\s+sur l.adresse\s+email\s+(\S+@\S+?)\s+ou\s+au\s+([+\d ]+)/i);
      if (/démarchage hors horaires autorisé/i.test(texte)) r.hors_horaires = true;
      if (c) { r.contact.nom_complet = c[1]; r.contact.email = V.email(c[2]); r.contact.telephone = c[3]; }
      const a = texte.match(/située (?:au|à)\s+(.+?),\s*(\d{5})\s+([A-Za-zÀ-ÿ' -]+?)(?:\s+a\s|\.|\n|$)/i); if (a) { r.bien.adresse = a[1]; r.bien.code_postal = a[2]; r.bien.ville = a[3].trim(); }
      const e = texte.match(/pré-estimation du bien\s*:\s*([\d  ]+)\s*€/i); if (e) r.bien.prix = V.prix(e[1] + " €");
    },
  },
  { id: "ekonsilio", nom: "eKonsilio (chat)", test: (d) => /ekonsilio\.(fr|com)$/.test(d), nature: (o, t) => (/nouvelle demande de contact|lead acqu[ée]reur|lead vendeur|voici les informations concernant ce contact/i.test(o + "\n" + t) ? "lead" : "non_lead"), regles: ({ texte, r }) => { const m = texte.match(/# commentaire\s*\n([\s\S]*?)\n#/i); if (m) r.message = m[1].trim(); } },
  /* Zefir : « Un acheteur Zefir souhaite visiter l'un de vos biens », « Cet acheteur attend votre retour » : un ACHETEUR */
  { id: "zefir", nom: "Zefir (Zefir)", test: (d) => /zefir\.fr$/.test(d),
    nature: (o, t) => (/acheteur|visiter|visite/i.test(o + "\n" + String(t).slice(0, 800)) ? "lead" : /vendeur|estimation|estimer/i.test(o) ? "estimation" : "non_lead"),
    regles: ({ L, texte, r }) => {
      const i = L.findIndex((l) => /^coordonn[ée]es de/i.test(l));
      if (i >= 0) { const n = L[i].replace(/^coordonn[ée]es de\s*/i, "").replace(/\s*:\s*$/, "").trim() || L[i + 1]; if (n && !/[📞📧@]/u.test(n) && !/\d{4}/.test(n)) r.contact.nom_complet = V.nomPropre(n); }
      const t = texte.match(/📞\s*([+\d][\d .]{8,})/u); if (t) r.contact.telephone = t[1].trim();
      const e = texte.match(/📧\s*(\S+@\S+)/u); if (e) r.contact.email = V.email(e[1]);
      const b = L.find((l) => /(vendre|vente)\s*-\s*\w+/i.test(l)); if (b) { r.bien.titre = b; Object.assign(r.bien, { ...V.faitsTitre(b), ...r.bien }); const ty = b.match(/-\s*(maison|appartement|terrain|propri[ée]t[ée]|immeuble|local|grange|moulin|villa)/i); if (ty) r.bien.type = V.typeBien(ty[1]); }
      const pr = L.find((l) => /\d[\d  .]*\s*€/.test(l)); if (pr) r.bien.prix = V.prix(pr);
      const lc = texte.match(/🗺️?\s*([^\n(]+?)\s*\((\d{5})\)/u); if (lc) { r.bien.ville = lc[1].trim(); r.bien.code_postal = lc[2]; }
    } },
  { id: "huisenaanbod", nom: "HUISenAANBOD.nl", test: (d) => /huisenaanbod\.nl$/.test(d), nature: (o, t) => (/#naamaanvrager|#vraag|#adv_details/i.test(t) ? "non_lead" : "lead") },
  { id: "kyero", nom: "KYERO", test: (d) => /kyero\.com$/.test(d), nature: () => "lead",
    regles: ({ o, texte, r }) => { const m = texte.match(/\*\*\[([A-Z0-9-]{5,})\]\s*\*\*/) || o.match(/:\s*([A-Z0-9-]{5,})\/?\s*$/); if (m && /\d/.test(m[1])) r.bien.reference = m[1]; } },
  { id: "jamesedition", nom: "JAMES EDITION", test: (d) => /jamesedition\.com$/.test(d), nature: (o) => (/enquiry|inquiry|demande|request|message|lead|contact/i.test(o) && !/app is here|newsletter|webinar|report|rapport/i.test(o) ? "lead" : "non_lead") },
  { id: "chateauxpourtous", nom: "Châteaux pour tous", test: (d, o) => /chateauxpourtous/.test(d) || /^chateauxpourtous[\w-]* a un contact/i.test(o), nature: () => "lead",
    regles: ({ L, o, r }) => { const m = o.match(/ref\.\s*([\w-]+)/i); if (m) r.bien.reference = m[1]; r.bien.prix = V.prix(o); const i = L.findIndex((l) => /^il s.agit de/i.test(l)); if (i >= 0) { r.contact.nom_complet = V.nomPropre(L[i + 1].replace(/^monsieur ou madame\s+/i, "").replace(/^(miss|mister|mr|mrs|ms)\s+/i, "")); delete r.contact.nom; delete r.contact.prenom; } } },
  { id: "meretdemeures", nom: "MERS ET DEMEURES", test: (d) => /meretdemeures|mersetdemeures/.test(d), nature: () => "lead" },
  { id: "moulin", nom: "Moulin.nl", test: (d) => /moulin\.nl$/.test(d), nature: () => "lead",
    regles: ({ L, o, r }) => {
      /* « Object: <titre de l'annonce> » ; objet « Property request: '<titre> (<réf>)' » ; « ID: » est l'identifiant du portail */
      const t = cherche(L, /^object\s*:\s*(.+)$/i); if (t) r.bien.titre = t[1].trim();
      const ref = o.match(/\(\s*([\w-]*\d[\w-]*)\s*\)\s*'?\s*(?:by\b|$)/i); if (ref) r.bien.reference = ref[1];
      const id = cherche(L, /^id\s*:\s*(\d+)\s*$/i); if (id && !r.bien.reference_portail) r.bien.reference_portail = id[1];
    } },
  { id: "idealista", nom: "Idealista", test: (d) => /idealista\.(fr|com)$/.test(d), nature: (o) => (/contact|message|demande|intéress/i.test(o) && !/compte|mot de passe|bienvenue/i.test(o) ? "lead" : "non_lead"),
    regles: ({ L, o, r }) => {
      const n = o.match(/message de (.+?) concernant/i); if (n) { r.contact.nom_complet = n[1]; delete r.contact.nom; delete r.contact.prenom; }
      const e = L.findIndex((l) => V.email(l) && !/idealista/.test(l)); if (e >= 0) { r.contact.email = V.email(L[e]); const f = L.slice(e + 1).findIndex((l) => /^(réponse depuis|réf\.|code de l)/i.test(l)); r.message = L.slice(e + 1, f >= 0 ? e + 1 + f : e + 8).join("\n"); }
      const t = L.find((l) => /^\+?[\d ]{9,}/.test(l)); if (t) r.contact.telephone = t.replace(/\[.*$/, "");
      const pr = L.find((l) => /^[\d.  ]+\s*€$/.test(l)); if (pr) r.bien.prix = V.prix(pr);
      const a = o.match(/réf\.\s*:\s*(\w+),\s*([^,]+?)\s*-\s*.*,\s*([^,]+)$/i); if (a) { r.bien.reference = a[1]; r.bien.type = V.typeBien(a[2]); r.bien.ville = a[3].trim(); }
    } },
  { id: "arkadia", nom: "Arkadia", test: (d, o) => /arkadia/.test(d) || /sur arkadia/i.test(o), nature: () => "lead",
    regles: ({ o, texte, r }) => {
      const m = o.match(/annonce n°\s*([\w-]+)/i); if (m) r.bien.reference_portail = m[1];
      /* « Au sujet de … ABCD-T123 / B7ACE… sur Arkadia » : l'identifiant Arkadia, puis la référence de l'agence */
      const d = (o + "\n" + texte).match(/\b([A-Z]{2,}-[A-Z]?\d+)\s*\/\s*([A-Z0-9][\w-]{3,})/i);
      if (d) { r.bien.reference_portail = r.bien.reference_portail || d[1]; if (!/^sur$/i.test(d[2])) r.bien.reference = d[2]; }
    } },
  { id: "snpi", nom: "Sites partenaires SNPI (Apimo)", test: (d, o) => /apimo\.(com|net|fr)$/.test(d) && /demande|contact/i.test(o), nature: () => "lead" },
  { id: "adapt", nom: "Adapt immobilier", test: (d) => /adaptinformatique\.fr$|adaptimmobilier/.test(d), nature: (o) => (/recherche/i.test(o) ? "recherche" : "lead"),
    regles: ({ L, o, r }) => {
      if (!/recherche/i.test(o)) return;
      for (const k of ["ville", "code_postal", "adresse"]) if (r.bien[k]) { r.contact[k] = r.bien[k]; delete r.bien[k]; }
      const i = L.findIndex((l) => /^sa recherche$/i.test(l));
      if (i >= 0) { const z = L.slice(i + 1, i + 14); const g = (re) => (z.find((l) => re.test(l)) || "").replace(/^[^:]*:\s*/, "");
        const loc = [g(/^ville\s*:/i), g(/^département\s*:/i)].filter(Boolean).join(" ("); if (loc) r.recherche.localisation = loc + (loc.includes("(") ? ")" : "");
        const bmax = g(/^budget max/i); if (bmax) r.recherche.budget_max = +bmax.replace(/\D/g, "") || undefined;
        const smin = g(/^surface habitable min/i); if (smin) r.recherche.surface_min = +smin.replace(/[^\d]/g, "") || undefined;
        const ty = g(/^bien de type/i); if (ty) r.recherche.type = V.typeBien(ty) || ty;
        const op = g(/^opération/i); if (op) r.projet = /location/i.test(op) ? "location" : "achat"; }
    } },
  { id: "annonces_diverses", nom: "Autres portails", test: (d) => /(stonimmo\.com|lesannoncesducommerce\.fr|annonce-immobilier\.com|lesiteimmo\.com|superimmo(pro)?\.com|contact\.superimmopro\.com|belles-demeures|jetrouvetous\.fr|immobilier\.email)$/.test(d), nature: (o) => (/vous avez (un|une) (nouveau |nouvelle )?(contact|demande|message)|nouveau message|nouveau contact|^\W*contact\b|contact .*annonce|internaute|demande d.information|souhaite (plus d.)?information|nouveau contact|a un contact|intéressé par/i.test(o) && !/collaborateurs|profil|page agence|saviez-vous|soyez prêt|tenez vos clients|facture|abonnement|newsletter/i.test(o) ? "lead" : "non_lead") },
  /* Rapport de quarantaine anti-spam : ce n'est pas un lead mais il peut en cacher. */
  { id: "vade", nom: "Rapport anti-spam", test: (d) => /vadesecure\.com$/.test(d), nature: () => "alerte_spam",
    regles: ({ texte, r }) => { r.bloques = (texte.match(/^.{3,40}\|.+\|\s*\d+\s*k\s*\|.+$/gm) || []).map((l) => l.split("|")[0].trim()).filter((x) => /properstar|green|leboncoin|seloger|figaro|bienici|rightmove|french|giraffe|ac3|immo/i.test(x)); } },
  { id: "bruit", nom: "Service / newsletter", test: (d) => /(immo-facile\.(fr|com)|cessionpme\.com|orisha\.com|gedeon\.im|canva\.com|firebaseapp\.com|toutvendre\.fr|opinionsystem\.fr|notaires\.fr|cci\.fr|tiktok\.com|news\.leboncoin\.fr|gestiviag\.com|communication-snpi\.com|centre-conventions-collectives\.fr|linkedin\.com|facebookmail\.com|google\.com)$/.test(d), nature: () => "non_lead" },
];

/* Signature dans le texte : sert quand l'expéditeur d'origine est perdu
   (mail de portail retransféré depuis une boîte de l'agence). */
const SIGNATURES = {
  leboncoin: /l.équipe leboncoin|leboncoin\.fr\/ad\/|vous a contacté sur leboncoin/i,
  seloger: /seloger\.com|un acquéreur est intéressé par un de vos biens/i,
  green_acres: /green-acres\.(com|fr)/i,
  figaro: /immobilier\.lefigaro\.fr|visible sur figaro immobilier/i,
  proprietes_figaro: /propriétés le figaro|proprietes\.lefigaro\.fr/i,
  bienici: /l.équipe bien.ici|bienici\.com/i,
  properstar: /properstar\.(com|fr)/i,
  paruvendu: /paruvendu(pro)?\.fr/i,
  french_property: /french-property\.com/i,
  site_agence: /ac3-groupe\.com|message du client\s*:|customer message\s*:/i,
  ekonsilio: /ekonsilio/i,
  annonces_diverses: /lesiteimmo\.com|superimmo|annonce-immobilier\.com/i,
  rightmove: /rightmove\.co\.uk/i,
  bellespierres: /bellespierres\.com/i,
};
const detecterParTexte = (texte) => {
  const t = String(texte || "").slice(0, 6000);
  for (const [id, re] of Object.entries(SIGNATURES)) if (re.test(t)) return PORTAILS.find((p) => p.id === id) || null;
  return null;
};

/* Portail déclaré par le client (table ld_portails), sans code :
   { id, nom, domaines: ["exemple-immo.fr", "formulaire@agence.fr"], objets_lead: ["nouveau contact", "demande"],
     objets_non_lead: ["facture"], libelles: { "tél. perso": "telephone" }, reference: "Réf\\s*:\\s*(\\S+)" }
   Les expressions sont testées sans tenir compte des majuscules ; une expression invalide est ignorée. */
const re = (x) => { try { return new RegExp(x, "i"); } catch (e) { return null; } };
const declare = (p) => {
  /* « domaines » : un domaine (tous ses expéditeurs) ou une adresse complète (ce seul expéditeur, ex. le formulaire d'un site
     qui écrit depuis le domaine de l'agence : les autres adresses de ce domaine restent des mails de l'équipe) */
  const tout = (p.domaines || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const adr = tout.filter((x) => x.includes("@")), dom_ = tout.filter((x) => !x.includes("@"));
  const oui = (p.objets_lead || []).map(re).filter(Boolean), non = (p.objets_non_lead || []).map(re).filter(Boolean);
  const ref = p.reference ? re(p.reference) : null;
  return {
    id: p.id || "declare_" + (tout[0] || "x").replace(/\W+/g, "_"), nom: p.nom || tout[0], declare: true, libelles: p.libelles || null,
    test: (d, o, a) => dom_.some((x) => d === x || d.endsWith("." + x)) || (!!a && adr.includes(a)),
    nature: (o) => (non.some((r) => r.test(o)) ? "non_lead" : !oui.length || oui.some((r) => r.test(o)) ? p.nature || "lead" : "non_lead"),
    regles: ref ? ({ o, texte, r }) => { const m = (o + "\n" + texte).match(ref); if (m && !r.bien.reference) r.bien.reference = (m[1] || m[0]).trim(); } : undefined,
  };
};

/* Portails du code d'abord (testés), puis ceux déclarés par le client. */
const detecter = (mail, declares = []) => {
  const d = dom(mail.expediteur), o = String(mail.objet || "");
  const a = (String(mail.expediteur || "").match(/[\w.+-]+@[\w.-]+/) || [""])[0].toLowerCase();
  return PORTAILS.find((p) => p.test(d, o)) || declares.map(declare).find((p) => p.test(d, o, a)) || null;
};

module.exports = { PORTAILS, detecter, detecterParTexte, declare, dom };
