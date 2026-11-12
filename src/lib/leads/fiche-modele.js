/* Fiche PDF du bien sur les modèles de Sidy (12/11) : « fiche-bien-selection-habitat-v2.pdf » quand le nom de l'agence du bien
   contient « selection », sinon « fiche-bien-agence-hamilton-v1.pdf ». Une page HTML imprimée par Chromium (Gotenberg) :
   couverture, le bien, caractéristiques et DPE, liste des pièces, galerie, contact. Chaque texte vient de l'annonce ou du CRM :
   rien n'est rédigé ni inventé ; une information absente laisse sa ligne ou sa section vide, jamais une phrase de remplissage. */
const RES = require("./fiche-ressources");

const THEMES = {
  sh: { marque: "Sélection Habitat", fonce: "#183d1e", or: "#ac8b55", accent: "#528b44", clair: "rgba(255,255,255,.78)", fond: "#f4f1ea", trait: "#e3ded3",
    logo: "logo_sh", logoH: "24mm", site: "www.selectionhabitat.com", leger: false,
    devise: "« Des hommes, des femmes et des maisons de caractère »", signature: ["« Une expérience immobilière à hautes valeurs humaines »", "Biens de caractère à la campagne"],
    relais: { fr: "Vous avez échangé avec l'assistant IA de Sélection Habitat — votre négociateur prend directement le relais pour organiser une visite.",
      en: "You have been chatting with the Sélection Habitat AI assistant — your negotiator now takes over to arrange a viewing." } },
  hamilton: { marque: "Agence Hamilton", fonce: "#1b3656", or: "#ae8d57", accent: "#ae8d57", clair: "#c9ae7e", fond: "#f5f2ec", trait: "#e5e0d6",
    logo: "logo_hamilton", logoH: "20mm", site: "www.agence-hamilton.com", leger: true,
    bandeau: ["Châteaux & demeures depuis 1992", "Anglet | Paris | Cannes | Marbella | Ibiza", "www.agence-hamilton.com"],
    signature: ["Châteaux & demeures depuis 1992", "Anglet | Paris | Cannes | Marbella | Ibiza — Groupe Sélection Habitat"],
    relais: { fr: "Votre négociateur se tient à votre disposition pour organiser une visite.", en: "Your negotiator is at your disposal to arrange a viewing." } },
};
/* Sidy, 12/11 : « quand le nom de l'agence du bien contient "selection" », sinon le modèle Agence Hamilton */
const themeDe = (nomAgence) => (/s[ée]lection/i.test(String(nomAgence || "")) ? "sh" : "hamilton");

const MOTS = {
  fr: { dossier: "Dossier de présentation", mandat: "Mandat n°", pieces: "Pièces", chambres: "Chambres", hab: "Hab.", terrain: "Terrain", construction: "Construction",
    leBien: "Le bien", atouts: "Les atouts du bien", carac: "Caractéristiques", essentiel: "L'essentiel en un coup d'œil", grBien: "Le bien", grConfort: "Construction & confort",
    grExt: "Extérieurs & accès", perf: "Performance énergétique", conso: "Consommation d'énergie", ges: "Émissions de gaz à effet de serre", volumes: "Détail des volumes",
    listePieces: "Liste des pièces", piece: "Pièce", surface: "Surface", detail: "Détail", galerie: "Galerie", photos: "Les photos du bien", contact: "Votre contact",
    nego: "Le négociateur dédié à votre projet", metier: "Négociateur immobilier", tel: "Téléphone", mail: "E-mail", langues: "We also speak English — We spreken ook Nederlands",
    complet: "Dossier complet disponible sur demande", completSuite: "photos supplémentaires, plan cadastral, diagnostics techniques. Nous pouvons organiser une visite à votre convenance, sur place ou en visioconférence.",
    completGalerie: "photos supplémentaires, plan cadastral, diagnostics.", aVendre: "À vendre", type: "Type de bien", transaction: "Transaction", prix: "Prix",
    surfHab: "Surface habitable", annee: "Année de construction", vendeur: "Honoraires à la charge du vendeur", acquereur: "Honoraires à la charge de l'acquéreur",
    vendeurCourt: "honoraires charge vendeur", acquereurCourt: "honoraires charge acquéreur", depenses: (a, b) => `Dépenses annuelles d'énergie estimées pour un usage standard : entre ${a} et ${b}.`,
    diag: (d) => `Diagnostic établi le ${d}.`, groupe: "Groupe Sélection Habitat", parAn: "an", infos: (j) => `Informations de l'annonce au ${j}.`,
    nc: "Document non contractuel — les informations et surfaces sont données à titre indicatif et ne sauraient engager la responsabilité de l'agence.",
    dpeLegal: (d) => `Diagnostic de performance énergétique établi le ${d}.` },
  en: { dossier: "Property presentation", mandat: "Mandate no.", pieces: "Rooms", chambres: "Bedrooms", hab: "Living", terrain: "Land", construction: "Built",
    leBien: "The property", atouts: "Highlights", carac: "Features", essentiel: "At a glance", grBien: "The property", grConfort: "Construction & comfort",
    grExt: "Outdoors & access", perf: "Energy performance", conso: "Energy consumption", ges: "Greenhouse gas emissions", volumes: "Room details",
    listePieces: "Rooms", piece: "Room", surface: "Area", detail: "Detail", galerie: "Gallery", photos: "Property photos", contact: "Your contact",
    nego: "The negotiator dedicated to your project", metier: "Real estate negotiator", tel: "Phone", mail: "E-mail", langues: "Nous parlons français — We spreken ook Nederlands",
    complet: "Full file available on request", completSuite: "additional photos, cadastral plan, technical surveys. We can arrange a viewing at your convenience, on site or by video call.",
    completGalerie: "additional photos, cadastral plan, surveys.", aVendre: "For sale", type: "Property type", transaction: "Transaction", prix: "Price",
    surfHab: "Living area", annee: "Year built", vendeur: "Agency fees paid by the seller", acquereur: "Agency fees paid by the buyer",
    vendeurCourt: "fees paid by the seller", acquereurCourt: "fees paid by the buyer", depenses: (a, b) => `Estimated annual energy costs for standard use: between ${a} and ${b}.`,
    diag: (d) => `Survey dated ${d}.`, groupe: "Sélection Habitat Group", parAn: "year", infos: (j) => `Listing information as of ${j}.`,
    nc: "Non-contractual document — information and areas are given as an indication only and do not engage the agency's liability.",
    dpeLegal: (d) => `Energy performance certificate dated ${d}.` },
};

const echap = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const milliers = (n, en) => String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, en ? "," : " ");
const euros = (n, en) => (en ? `€${String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}` : `${milliers(n)} €`);
const nombre = (v) => { const m = String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".").match(/\d+(\.\d+)?/); return m ? +m[0] : null; };
const surfaceTxt = (n, en) => (n == null ? "" : `${en ? String(n) : String(n).replace(".", ",")} m²`);
const sansAccent = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/* téléphone français lisible : « 06 16 06 03 23 » ; un numéro étranger reste tel quel */
const telephone = (t) => { const n = String(t || "").replace(/[^\d+]/g, ""), f = n.replace(/^(\+33|0033|33)(?=\d{9}$)/, "0"); return /^0\d{9}$/.test(f) ? f.replace(/(\d{2})(?=\d)/g, "$1 ") : String(t || "").trim(); };
/* texte saisi en capitales dans le CRM (« GRANGE 2 x 38 M² ») : remis en minuscules, première lettre en capitale */
const casse = (t) => { const s = String(t || "").trim(); if (!s) return ""; const l = s.replace(/[^\p{L}]/gu, ""), maj = l.replace(/[^\p{Lu}]/gu, "").length;
  const b = l.length >= 3 && maj / l.length > 0.7 ? s.toLowerCase() : s; return b.charAt(0).toUpperCase() + b.slice(1); };
/* une phrase de l'annonce qui signe l'agence ou parle des langues est retirée (comme la fiche précédente) : la fiche porte déjà la marque */
const SIGNE = /agence|hamilton|s[ée]lection (habitat|ocean|med|immobilier|senegal|groupe)|groupe s[ée]lection|arieg.?immo|toit ?2 ?r[êe]ve|bliss|van den berg|we also speak|we spreken|wir sprechen/i;

/* Données de la fiche : bien lu dans le CRM (champs publics et annonce), photos publiques, personne qui suit la demande, agence du bien */
const donneesFiche = (bien, { langue = "fr", photos = [], contact = {}, agence = null, quand = new Date() } = {}) => {
  const B = require("./bot");
  const b = B.bienPublic(bien);
  if (!b || !(b.type || b.ville)) return null;
  const en = langue === "en", M = MOTS[en ? "en" : "fr"], an = B.annonce(bien && bien.annonce), dans = (o) => (o && (o[en ? "en" : "fr"] || (!en && o.en) || "")) || "";
  const brut = new Map(((bien && bien.annonce && bien.annonce.criteres) || []).map((c) => [+c.id, c]));
  const crit = (id) => { const c = brut.get(id); return c && c.valeur != null && String(c.valeur).trim() !== "" ? String(c.valeur).trim() : ""; };
  const det = (en ? an.details_en : an.details) || {}, detFr = an.details || {};
  const cle = (re) => Object.keys(detFr).find((k) => re.test(k));
  const val = (re) => { const k = cle(re); return k ? (en ? det[k] : detFr[k]) || "" : ""; };
  const theme = themeDe(agence && agence.nom);
  const T = require("./traduction");
  const typeAff = en ? (T.typeEn(b.type) || "Property") : B.majuscule(b.type) || "Bien";
  /* titre et accroche : ceux de l'annonce ; jamais une phrase qui signe l'agence */
  const titreA = dans(an.titre_annonce).replace(/[.\s]+$/, "");
  const titre = (titreA && !SIGNE.test(titreA) ? titreA : "") || [typeAff, b.ville && (en ? `in ${b.ville}` : `à ${b.ville}`)].filter(Boolean).join(" ");
  const phrases = String(dans(an.description_annonce)).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x && !SIGNE.test(x));
  const accroche = phrases[0] && phrases[0].length <= 150 ? phrases[0].replace(/\.$/, "") : "";
  const paragraphes = []; let p = [];
  for (const x of phrases) { p.push(x); if (p.join(" ").length > 420) { paragraphes.push(p.join(" ")); p = []; } }
  if (p.length) paragraphes.push(p.join(" "));
  const cp = String(b.code_postal || ""), dep = /^97/.test(cp) ? cp.slice(0, 3) : cp.slice(0, 2);
  const lieu = [b.ville && String(b.ville).toUpperCase(), dep && `(${dep})`].filter(Boolean).join(" ");
  /* honoraires : qui les paie, jamais leur montant ; mandat : son numéro (modèle de Sidy du 12/11) */
  const honVendeur = (nombre(crit(1929)) || 0) > 0, honAcq = [...brut.values()].some((c) => /honoraires? acqu/i.test(c.nom || "") && (nombre(c.valeur) || 0) > 0);
  const honoraires = honAcq ? M.acquereur : honVendeur ? M.vendeur : "", honCourt = honAcq ? M.acquereurCourt : honVendeur ? M.vendeurCourt : "";
  const prix = b.prix ? euros(b.prix, en) : "";
  const terrain = nombre(detFr["Surface terrain"]), annee = nombre(crit(51)) || nombre(val(/^ann[ée]e construction/i));
  const stats = [[b.pieces, M.pieces], [b.chambres, M.chambres], [b.surface, M.hab, "m²"], [terrain, M.terrain, "m²"], [annee, M.construction]]
    .filter(([v]) => v).map(([v, l, u]) => ({ v: u ? milliers(v, en) : String(v), u: u || "", l }));
  /* caractéristiques : les champs de l'annonce déjà filtrés (slide 07), rangés comme dans le modèle */
  const vu = new Set(["Pays", "Consommation énergie primaire", "Gaz Effet de Serre", "Valeur consommation énergie primaire", "Valeur Gaz Effet de serre", "Soumis à l'affichage du DPE", "Temps de trajet", "Surface terrain", "Année construction", "Informations complémentaires"]);
  const libelle = (k) => (en ? T.traduireNom(k) || "" : k.replace(/^Type de Stationnement$/, "Stationnement").replace(/^Mode Chauffage$/, "Chauffage").replace(/^Nombre places parking$/, "Places de parking")
    .replace(/^Nombre de terrasses$/, "Terrasses").replace(/^Cave\(s\)$/, "Caves").replace(/^Nombre étages$/, "Étages").replace(/^Surface séjour$/, "Surface du séjour").replace(/^Salle\(s\) de bains$/, "Salles de bains").replace(/^Salle\(s\) d'eau$/, "Salles d'eau"));
  const lot = /appartement|studio|duplex|loft|apartment|flat/i.test(String(b.type));
  const g = { bien: [[M.type, typeAff], [M.transaction, M.aVendre], ...(prix ? [[M.prix, prix + (honCourt ? ` (${honCourt})` : "")]] : []), ...(b.surface ? [[M.surfHab, surfaceTxt(b.surface, en)]] : []),
    ...(terrain ? [[M.terrain, surfaceTxt(milliers(terrain, en), en)]] : []), ...(b.pieces ? [[M.pieces, String(b.pieces)]] : []), ...(b.chambres ? [[M.chambres, String(b.chambres)]] : [])], confort: [], ext: [] };
  for (const k of Object.keys(detFr)) {
    if (vu.has(k) || /trajet|distance|copro/i.test(k)) continue;
    const v = en ? det[k] : detFr[k], lib = libelle(k);
    if (!v || !lib) continue;   // en anglais : jamais un libellé ni une valeur en français
    if (/^type chauffage$/i.test(k) && !lot && /collecti/i.test(v)) continue;   // « Collectif » d'une maison : valeur sans sens (essai du 12/11)
    const ligne = [lib, casse(String(v).replace(/(\d)\.(\d)/g, en ? "$1.$2" : "$1,$2"))];
    if (/stationnement|parking|garage|box|piscine|terrasse|balcon|jardin|cave|cour|abri|portail|cl[oô]tur/i.test(k)) g.ext.push(ligne);
    else if (/surface|salle|wc|[ée]tage|niveau|chambre|pi[èe]ce|s[ée]jour/i.test(k)) g.bien.push(ligne);
    else g.confort.push(ligne);
  }
  if (annee) g.bien.push([M.annee, String(annee)]);
  /* « - Menuiseries : BOIS » de l'annonce : une ligne chacune */
  for (const l of String(detFr["Informations complémentaires"] || "").split(/\n/)) { const m = l.match(/^\s*-?\s*([^:]{2,40})\s*:\s*(.+)$/); if (m && !en) g.confort.push([casse(m[1]), casse(m[2])]); }
  /* atouts : les points marquants que l'annonce donne, tels quels */
  const atouts = [];
  const ajout = (l, v) => { if (v && atouts.length < 8) atouts.push([l, v]); };
  if (terrain) ajout(M.terrain, surfaceTxt(milliers(terrain, en), en));
  ajout(en ? "Pool" : "Piscine", /^(oui|yes)/i.test(val(/^piscine$/i)) ? (en ? "yes" : "oui") : "");
  ajout(en ? "View" : "Vue", val(/^vue$/i).toLowerCase());
  ajout(en ? "Aspect" : "Exposition", val(/^exposition$/i).toLowerCase());
  ajout(M.construction, [val(/^construction$/i).toLowerCase(), annee].filter(Boolean).join(", "));
  ajout(en ? "Fireplace" : "Cheminée", val(/^chemin[ée]e$/i).toLowerCase());
  ajout(en ? "Terraces" : "Terrasses", val(/terrasse/i));
  ajout(en ? "Parking" : "Stationnement", [val(/stationnement/i).toLowerCase(), val(/places parking/i) && `${val(/places parking/i)} ${en ? "spaces" : "places"}`].filter(Boolean).join(", "));
  ajout(en ? "Cellar" : "Cave", val(/^cave/i));
  /* DPE : lettres, valeurs, dépenses estimées et date (modèle de Sidy du 12/11) */
  const lettre = (v) => (/^[A-G]$/i.test(String(v).trim()) ? String(v).trim().toUpperCase() : "");
  const dpe = { dpe: lettre(detFr["Consommation énergie primaire"]), ges: lettre(detFr["Gaz Effet de Serre"]),
    dpeVal: detFr["Valeur consommation énergie primaire"] ? `${detFr["Valeur consommation énergie primaire"]} kWh/m²/${M.parAn}` : "",
    gesVal: detFr["Valeur Gaz Effet de serre"] ? `${detFr["Valeur Gaz Effet de serre"]} kg CO₂/m²/${M.parAn}` : "" };
  const dMin = nombre(crit(2736)), dMax = nombre(crit(2737)), dateDpe = crit(1850);
  dpe.note = [dMin && dMax ? M.depenses(euros(dMin, en), euros(dMax, en)) : "", /^\d{2}\/\d{2}\/\d{4}$/.test(dateDpe) ? M.diag(dateDpe) : ""].filter(Boolean).join(" ");
  /* pièces : regroupées par niveau (« Niveau : RDC. » dans le commentaire vaut pour les suivantes) ; pas de traduction en anglais */
  const groupes = [];
  if (!en) {
    let niveau = "";
    const NIV = (t) => { const s = String(t || "").trim().replace(/\.$/, ""); return /^rdc|rez/i.test(s) ? "Rez-de-chaussée" : /sous.?sol/i.test(s) ? "Sous-sol" : casse(s); };
    for (const x of ((bien && bien.annonce && bien.annonce.pieces) || []).slice(0, 60)) {
      const c = String(x.commentaire || ""), m = c.match(/niveau\s*:\s*([^.]+)/i);
      if (x.niveau) niveau = NIV(x.niveau); else if (m) niveau = NIV(m[1]);
      const nom = String(x.piece || "").trim();
      /* le commentaire du CRM répète le nom de la pièce (« Chambre 1. PARQUET », « Salle de bain. CARRELAGE ») : ce début est retiré,
         comme une surface seule (« 30M² ») ou un numéro seul */
      let d = B.nettoyer(c.replace(/niveau\s*:\s*[^.]*\.?/i, " "), 120).trim();
      const debut = d.match(/^([^.]{1,40})\.\s*/);
      if (debut && sansAccent(debut[1]).slice(0, 5) === sansAccent(nom).slice(0, 5)) d = d.slice(debut[0].length);
      d = d.replace(/^(wc|w\.c\.)\.?\s*/i, "").trim();
      if (/^[\d\s.,x]*(m²|m2|m)?\.?$/i.test(d)) d = "";
      d = casse(d).replace(/\.$/, "");
      if (!nom) continue;
      const titreG = niveau || M.listePieces;
      let gr = groupes.find((z) => z.titre === titreG);
      if (!gr) groupes.push(gr = { titre: titreG, lignes: [] });
      gr.lignes.push([nom, x.surface ? surfaceTxt(x.surface, en) : "", d]);
    }
  }
  const jour = quand.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
  const nomAgence = agence && agence.nom ? String(agence.nom).toLowerCase().replace(/(^|[\s'’-])(\p{L}+)/gu, (_, s, w) => s + (s && /^(sur|sous|de|des|du|la|le|les|en|et|d|l|by)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).replace(/^Selection /, "Sélection ") : "";
  return { theme, langue: en ? "en" : "fr", mandat: crit(26), lieu, titre, accroche, prix, honoraires, stats, paragraphes, atouts, carac: g, dpe, groupes,
    photos: (photos || []).filter((u) => /^(https:\/\/|data:image\/)/.test(String(u))).slice(0, 37), jour,
    contact: { nom: contact.nom || "", telephone: telephone(contact.telephone), email: contact.email || "", agence: nomAgence } };
};

/* ---------- rendu HTML (A4, Chromium) ---------- */
const DPE_COUL = { A: "#3b9b48", B: "#5dbb57", C: "#97d078", D: "#f5e14b", E: "#f5b14b", F: "#ee7b2e", G: "#e03c31" };
const echelle = (lettre, valeur) => ["A", "B", "C", "D", "E", "F", "G"].map((l, i) =>
  `<div class="barre"><span style="width:${46 + i * 19}pt;background:${DPE_COUL[l]}">${l}</span>${l === lettre && valeur ? `<b>${echap(valeur)}</b>` : ""}</div>`).join("");
const tableau = (lignes) => `<table class="carac">${lignes.map(([l, v]) => `<tr><td>${echap(l)}</td><td>${echap(v)}</td></tr>`).join("")}</table>`;

const htmlFiche = (d) => {
  const th = THEMES[d.theme] || THEMES.sh, M = MOTS[d.langue], en = d.langue === "en";
  const css = `
@font-face{font-family:Lato;font-weight:300;src:url(${RES.lato_300}) format("woff2")}
@font-face{font-family:Lato;font-weight:400;src:url(${RES.lato_400}) format("woff2")}
@font-face{font-family:Lato;font-weight:400;font-style:italic;src:url(${RES.lato_400i}) format("woff2")}
@font-face{font-family:Lato;font-weight:700;src:url(${RES.lato_700}) format("woff2")}
@font-face{font-family:Lato;font-weight:900;src:url(${RES.lato_900}) format("woff2")}
@page{size:A4;margin:15mm 15mm 19mm;
  @bottom-left{content:${JSON.stringify(th.marque.toUpperCase())};font:400 6pt Lato;letter-spacing:1.2pt;color:#9a9a96}
  @bottom-center{content:counter(page);font:700 7pt Lato;color:#6b6b65}
  @bottom-right{content:${JSON.stringify(d.mandat ? `${M.mandat} ${d.mandat}` : "")};font:400 6.5pt Lato;color:#9a9a96}}
@page couverture{margin:0;@bottom-left{content:none}@bottom-center{content:none}@bottom-right{content:none}}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;padding:0}
body{font-family:Lato,sans-serif;color:#333235;font-size:8.3pt;line-height:1.8}
.page{break-before:page}
.couverture{page:couverture;position:relative;height:297mm;width:210mm;overflow:hidden}
.couv-haut{position:absolute;top:13mm;left:15mm;right:15mm;display:flex;justify-content:space-between;align-items:flex-start}
.couv-haut img{height:${th.logoH}}
.dossier{text-align:right;padding-top:5mm}
.dossier small{display:block;font-size:6.5pt;letter-spacing:2.4pt;text-transform:uppercase;color:${th.or};font-weight:700}
.dossier b{font-size:7.5pt;color:#333235}
.couv-titre{position:absolute;top:46mm;left:15mm;right:15mm}
.lieu{font-size:7.4pt;font-weight:700;letter-spacing:2.6pt;text-transform:uppercase;color:${th.accent};line-height:1.6}
h1{margin:2mm 0 1.5mm;color:${th.fonce};${th.leger ? "font-weight:300;font-size:19pt;letter-spacing:1.6pt;text-transform:uppercase;line-height:1.25" : "font-weight:700;font-size:23pt;line-height:1.15"}}
.accroche{font-size:7.6pt;color:#6b6b65;line-height:1.5}
.couv-photo{position:absolute;top:96mm;left:15mm;right:15mm;height:104mm;background:${th.fond} center/cover no-repeat}
.prix{position:absolute;top:172mm;left:11mm;background:${th.or};color:#fff;padding:3.2mm 5mm 3mm;min-width:52mm;box-shadow:0 2mm 4mm rgba(0,0,0,.18)}
.prix b{display:block;font-size:16.5pt;font-weight:900;line-height:1.1}
.prix small{font-size:5.6pt;opacity:.92}
.bande{position:absolute;left:0;right:0;bottom:0;height:44mm;background:${th.fonce};color:#fff;padding:9mm 15mm 0}
.stats{display:flex}
.stats div{flex:1;padding-left:4mm;border-left:.6pt solid rgba(255,255,255,.35)}
.stats div:first-child{padding-left:0;border-left:0}
.stats b{font-size:12.5pt;font-weight:900}.stats sup{font-size:6pt;font-weight:700;margin-left:.6mm}
.stats span{display:block;font-size:5.4pt;letter-spacing:1.6pt;text-transform:uppercase;color:rgba(255,255,255,.75);line-height:1.6}
.pied-bande{margin-top:5.5mm;padding-top:4.5mm;border-top:.6pt solid rgba(255,255,255,.3);display:flex;justify-content:space-between;align-items:flex-start;font-size:6.6pt;gap:6mm}
.pied-bande i{font-style:italic}
.pied-bande span{letter-spacing:1.6pt;text-transform:uppercase;line-height:1.5}
.surtitre{font-size:6.6pt;font-weight:700;letter-spacing:2.6pt;text-transform:uppercase;color:${th.or};margin:0 0 1.2mm}
h2{margin:0 0 5mm;padding-bottom:3mm;border-bottom:1.2pt solid ${th.fonce};color:${th.fonce};${th.leger ? "font-weight:300;font-size:17pt;letter-spacing:.4pt" : "font-weight:700;font-size:16.5pt"};line-height:1.2}
p{margin:0 0 2.6mm}
.encart{background:${th.fond};border-left:2pt solid ${th.or};padding:5mm 6mm;margin:6mm 0 0;break-inside:avoid}
.encart h3{margin:0 0 3mm;font-size:8.4pt;letter-spacing:2.2pt;text-transform:uppercase;color:${th.fonce};font-weight:${th.leger ? 400 : 900}}
.atouts{display:grid;grid-template-columns:1fr 1fr;gap:2.2mm 8mm;font-size:7.3pt;line-height:1.55}
.atouts div{position:relative;padding-left:5mm}
.atouts div:before{content:"";position:absolute;left:0;top:1.3mm;width:2.2mm;height:2.2mm;border-radius:50%;background:${th.or}}
.atouts b{color:${th.fonce}}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 9mm}
h4{margin:0 0 1mm;padding-bottom:1.8mm;border-bottom:.6pt solid ${th.trait};font-size:7.3pt;letter-spacing:2.2pt;text-transform:uppercase;color:${th.or};font-weight:700}
table{border-collapse:collapse;width:100%}
.carac td{padding:1.55mm 1.8mm;border-bottom:.6pt solid ${th.trait};font-size:7.1pt;line-height:1.45;vertical-align:top}
.carac td:first-child{width:42%;color:#333235}.carac td:last-child{font-weight:700;color:#333235}
.groupe{margin-bottom:5mm;break-inside:avoid}
.dpe{background:${th.fond};padding:5mm 6mm;margin-top:3mm;break-inside:avoid}
.dpe h3{margin:0 0 2mm;font-size:8.4pt;letter-spacing:2.2pt;text-transform:uppercase;color:${th.fonce};font-weight:${th.leger ? 400 : 900}}
.dpe .cols>div>small{display:block;font-size:6pt;letter-spacing:1.2pt;text-transform:uppercase;color:#6b6b65;margin-bottom:1.5mm}
.barre{display:flex;align-items:center;height:4.3mm;margin-bottom:.5mm}
.barre span{display:block;height:3.9mm;color:#fff;font-size:5.6pt;font-weight:900;padding-left:1.6mm;line-height:3.9mm}
.barre b{font-size:6.6pt;margin-left:2mm;color:#333235}
.dpe .note{margin-top:3mm;padding-top:2.5mm;border-top:.6pt solid ${th.trait};font-size:6.3pt;color:#6b6b65;line-height:1.5}
.niveau{margin-bottom:4mm;break-inside:avoid}
.niveau .tete{background:${th.fonce};color:#fff;font-size:7.2pt;font-weight:700;letter-spacing:2.2pt;text-transform:uppercase;padding:2.2mm 3.5mm;break-after:avoid}
.pieces th{font-size:5.6pt;letter-spacing:1.4pt;text-transform:uppercase;color:#8a8a84;font-weight:400;padding:2mm 1.8mm 1.2mm;border-bottom:.6pt solid ${th.trait};text-align:left}
.pieces td{font-size:7.1pt;padding:1.6mm 1.8mm;border-bottom:.6pt solid ${th.trait};line-height:1.4}
.pieces tr{break-inside:avoid}
.pieces td:nth-child(2),.pieces th:nth-child(2){text-align:right;font-weight:700;width:18%;padding-right:4mm}
.pieces th:nth-child(2){font-weight:400}
.pieces td:first-child{width:38%}
.pieces td:last-child{color:#77776f;font-size:6.6pt}
.galerie{display:grid;grid-template-columns:repeat(3,1fr);gap:2.8mm}
.galerie div{height:38mm;background:${th.fond} center/cover no-repeat}
.carte{background:${th.fonce};color:#fff;padding:8mm 9.5mm;margin-bottom:6mm}
.carte small{display:block;font-size:5.8pt;letter-spacing:2.4pt;text-transform:uppercase;color:${th.leger ? th.or : "rgba(255,255,255,.75)"}}
.carte .nom{font-size:15pt;font-weight:${th.leger ? 300 : 700};margin:2mm 0 .5mm;letter-spacing:${th.leger ? ".6pt" : "0"}}
.carte .agence{font-size:7pt;color:${th.clair}}
.carte .coords{display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-top:6mm}
.carte .coords div{border-top:.6pt solid rgba(255,255,255,.4);padding-top:4mm}
.carte .coords b{display:block;font-size:9pt;margin-top:1mm}
.langues{font-size:6.6pt;font-weight:700;letter-spacing:1.4pt;text-transform:uppercase;color:${th.accent};margin:5mm 0 6mm}
.marque{display:flex;align-items:center;gap:10mm;padding-bottom:5mm}
.marque img{height:${th.leger ? "18mm" : "25mm"}}
.marque i{display:block;font-size:7.6pt;color:#333235}
.marque span{display:block;font-size:6.6pt;letter-spacing:1.6pt;text-transform:uppercase;color:#6b6b65;margin-top:1mm}
.marque b{display:block;font-size:7.6pt;letter-spacing:2.4pt;text-transform:uppercase;color:${th.fonce}}
.reseaux{display:flex;justify-content:space-between;align-items:center;border-top:.6pt solid ${th.trait};border-bottom:.6pt solid ${th.trait};padding:3.5mm 0}
.reseaux img{height:6.5mm;margin-right:3mm}
.reseaux b{font-size:7pt;letter-spacing:1.4pt;color:${th.fonce}}
.legal{font-size:5.8pt;color:#8a8a84;line-height:1.6;margin-top:3.5mm}`;
  const titreSection = (sur, titre) => `<div class="surtitre">${echap(sur)}</div><h2>${echap(titre)}</h2>`;
  const out = [];
  /* 1. couverture */
  out.push(`<section class="couverture">
<div class="couv-haut"><img src="${RES[th.logo]}" alt=""><div class="dossier"><small>${echap(M.dossier)}</small>${d.mandat ? `<b>${echap(M.mandat)} ${echap(d.mandat)}</b>` : ""}</div></div>
<div class="couv-titre"><div class="lieu">${echap(d.lieu)}</div><h1>${echap(d.titre)}</h1>${d.accroche ? `<div class="accroche">${echap(d.accroche)}</div>` : ""}</div>
${d.photos[0] ? `<div class="couv-photo" style="background-image:url('${echap(d.photos[0])}')"></div>` : ""}
${d.prix ? `<div class="prix"><b>${echap(d.prix)}</b>${d.honoraires ? `<small>${echap(d.honoraires)}</small>` : ""}</div>` : ""}
<div class="bande"><div class="stats">${d.stats.map((s) => `<div><b>${echap(s.v)}</b>${s.u ? `<sup>${s.u}</sup>` : ""}<span>${echap(s.l)}</span></div>`).join("")}</div>
<div class="pied-bande">${th.bandeau ? th.bandeau.map((x) => `<span>${echap(x)}</span>`).join("") : `<i>${echap(th.devise)}</i><span>${echap(th.site.toUpperCase())}</span>`}</div></div>
</section>`);
  /* 2. le bien */
  if (d.paragraphes.length) out.push(`<section class="page">${titreSection(M.leBien, d.titre)}${d.paragraphes.map((x) => `<p>${echap(x)}</p>`).join("")}
${d.atouts.length >= 3 ? `<div class="encart"><h3>${echap(M.atouts)}</h3><div class="atouts">${d.atouts.map(([l, v]) => `<div><b>${echap(l)}</b> : ${echap(v)}</div>`).join("")}</div></div>` : ""}</section>`);
  /* 3. caractéristiques et DPE */
  const gr = (t, l) => (l.length ? `<div class="groupe"><h4>${echap(t)}</h4>${tableau(l)}</div>` : "");
  const aDpe = d.dpe.dpe || d.dpe.ges;
  out.push(`<section class="page">${titreSection(M.carac, M.essentiel)}<div class="cols">${gr(M.grBien, d.carac.bien)}${gr(M.grConfort, d.carac.confort)}</div>${gr(M.grExt, d.carac.ext)}
${aDpe ? `<div class="dpe"><h3>${echap(M.perf)}</h3><div class="cols">${d.dpe.dpe ? `<div><small>${echap(M.conso)}</small>${echelle(d.dpe.dpe, d.dpe.dpeVal)}</div>` : "<div></div>"}${d.dpe.ges ? `<div><small>${echap(M.ges)}</small>${echelle(d.dpe.ges, d.dpe.gesVal)}</div>` : ""}</div>${d.dpe.note ? `<div class="note">${echap(d.dpe.note)}</div>` : ""}</div>` : ""}</section>`);
  /* 4. pièces */
  if (d.groupes.length) out.push(`<section class="page">${titreSection(M.volumes, M.listePieces)}${d.groupes.map((g) => `<div class="niveau"><div class="tete">${echap(g.titre)}</div>
<table class="pieces"><thead><tr><th>${echap(M.piece)}</th><th>${echap(M.surface)}</th><th>${echap(M.detail)}</th></tr></thead><tbody>${g.lignes.map(([n, s, x]) => `<tr><td>${echap(n)}</td><td>${s ? echap(s) : "—"}</td><td>${echap(x)}</td></tr>`).join("")}</tbody></table></div>`).join("")}</section>`);
  /* 5. galerie : neuf photos par page */
  const gal = d.photos.slice(1), pages = Math.ceil(gal.length / 9);
  for (let i = 0; i < pages; i++) out.push(`<section class="page">${titreSection(M.galerie, `${M.photos} — ${i + 1}/${pages}`)}<div class="galerie">${gal.slice(i * 9, i * 9 + 9).map((u) => `<div style="background-image:url('${echap(u)}')"></div>`).join("")}</div>
${i === pages - 1 ? `<div class="encart"><b>${echap(M.complet)}</b> : ${echap(M.completGalerie)} ${echap(th.relais[d.langue])}</div>` : ""}</section>`);
  /* 6. contact */
  const c = d.contact, legal = [`${th.marque}${th.leger ? " — " + M.groupe : ""}${d.mandat ? ` — ${M.mandat} ${d.mandat}` : ""}.`, d.prix ? `${M.prix} : ${d.prix}${d.honoraires ? `, ${d.honoraires.charAt(0).toLowerCase() + d.honoraires.slice(1)}` : ""}.` : "",
    M.infos(d.jour), /\d{2}\/\d{2}\/\d{4}/.test(d.dpe.note) ? M.dpeLegal(d.dpe.note.match(/\d{2}\/\d{2}\/\d{4}/)[0]) : "", M.nc].filter(Boolean).join(" ");
  out.push(`<section class="page">${titreSection(M.contact, M.nego)}
<div class="carte"><small>${echap(M.metier)} — ${echap(th.marque)}</small><div class="nom">${echap(c.nom)}</div>${c.agence ? `<div class="agence">${echap(c.agence)} — ${echap(M.groupe)}</div>` : ""}
${c.telephone || c.email ? `<div class="coords">${c.telephone ? `<div><small>${echap(M.tel)}</small><b>${echap(c.telephone)}</b></div>` : "<div></div>"}${c.email ? `<div><small>${echap(M.mail)}</small><b>${echap(c.email)}</b></div>` : ""}</div>` : ""}</div>
<div class="encart" style="margin-top:0"><b>${echap(M.complet)}</b> — ${echap(M.completSuite)}</div>
<div class="langues">${echap(M.langues)}</div>
<div class="marque"><img src="${RES[th.logo]}" alt=""><div>${th.leger ? `<b>${echap(th.signature[0])}</b><span>${echap(th.signature[1])}</span>` : `<i>${echap(th.signature[0])}</i><span>${echap(th.signature[1])}</span>`}</div></div>
<div class="reseaux"><div><img src="${RES.facebook}" alt=""><img src="${RES.instagram}" alt=""></div><b>${echap(th.site)}</b></div>
<div class="legal">${echap(legal)}</div></section>`);
  return `<!doctype html><html lang="${en ? "en" : "fr"}"><head><meta charset="utf-8"><title>${echap(d.titre)}</title><style>${css}</style></head><body>${out.join("\n")}</body></html>`;
};

module.exports = { THEMES, themeDe, donneesFiche, htmlFiche };
