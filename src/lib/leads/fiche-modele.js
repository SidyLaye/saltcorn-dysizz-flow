/* Fiche PDF du bien sur le modèle unifié de Sidy (« fiche-bien-agence-unifiée_retour SH.pdf », 13/11, feu vert le 17/11) : un seul
   modèle pour tous les biens, quelle que soit l'agence, aux deux marques (Agence Hamilton en doré, Selection Habitat en vert).
   Remplace les deux modèles du 12/11 (Selection Habitat si le nom de l'agence contenait « selection », sinon Agence Hamilton).
   Une page HTML imprimée par Chromium (Gotenberg) : couverture, le bien et son résumé, caractéristiques et DPE, liste des pièces,
   galerie, contact. Chaque texte vient de l'annonce ou du CRM : rien n'est rédigé ni inventé ; une information absente retire sa
   ligne ou son bloc, jamais une phrase de remplissage. Sidy, 17/11 : la fiche ne porte NI le numéro de mandat, NI le téléphone ni
   l'e-mail du négociateur (son nom seul, règle de Pascal du 23/10), NI les honoraires (ni qui les paie, ni leur montant), alors que le
   modèle Canva les montre : ils sont retirés sans laisser de libellé vide. Les dépenses d'énergie et la date du DPE restent. */
const RES = require("./fiche-ressources");

/* couleurs relevées dans le PDF modèle */
const C = { or: "#b59049", orTexte: "#ae8d57", orClair: "#c9ae7e", vert: "#28401e", bleu: "#1b3656", texte: "#333235", gris: "#6b6b65", grisDetail: "#77776f",
  grisClair: "#8a8a84", grisPied: "#595956", trait: "#e5e0d6", creme: "#f5f2ec", sable: "#efece4" };

const MOTS = {
  fr: { dossier: "Dossier de présentation", pieces: "Pièces", chambres: "Chambres", hab: "Habitables", terrain: "Terrain", construction: "Construction",
    leBien: "Le bien", resume: "Résumé du bien", carac: "Caractéristiques", essentiel: "L'essentiel en un coup d'œil", grBien: "Le bien", grConfort: "Construction & confort",
    grExt: "Extérieurs & accès", perf: "Performance énergétique", conso: "Consommation d'énergie", ges: "Émissions de gaz à effet de serre", volumes: "Détail des volumes",
    listePieces: "Liste des pièces", piece: "Pièce", surface: "Surface", detail: "Détail", galerie: "Galerie", photos: "Les photos du bien", contact: "Votre contact",
    nego: "Le négociateur dédié à votre projet", metier: "Négociateur immobilier",
    complet: (n) => (n ? `Dossier complet disponible auprès de ${n}` : "Dossier complet disponible sur demande"),
    completSuite: "photos supplémentaires, plan cadastral, diagnostics techniques. Nous pouvons également organiser une visite à votre convenance, sur place ou en visioconférence. N'hésitez pas à nous contacter.",
    aVendre: "À vendre", type: "Type de bien", transaction: "Transaction", prix: "Prix", surfHab: "Surface habitable", annee: "Année de construction",
    depenses: (a, b) => `Dépenses annuelles d'énergie estimées pour un usage standard : entre ${a} et ${b}.`, diag: (d) => `Diagnostic établi le ${d}.`, parAn: "an",
    entites: "Agence Hamilton — Selection Habitat - Entités de Selection Groupe", infos: (j) => `Informations de l'annonce au ${j}.`,
    nc: "Document non contractuel — les informations et surfaces sont données à titre indicatif et ne sauraient engager la responsabilité de l'agence.",
    dpeLegal: (d) => `Diagnostic de performance énergétique établi le ${d}.` },
  en: { dossier: "Property presentation", pieces: "Rooms", chambres: "Bedrooms", hab: "Living", terrain: "Land", construction: "Built",
    leBien: "The property", resume: "Property summary", carac: "Features", essentiel: "At a glance", grBien: "The property", grConfort: "Construction & comfort",
    grExt: "Outdoors & access", perf: "Energy performance", conso: "Energy consumption", ges: "Greenhouse gas emissions", volumes: "Room details",
    listePieces: "Rooms", piece: "Room", surface: "Area", detail: "Detail", galerie: "Gallery", photos: "Property photos", contact: "Your contact",
    nego: "The negotiator dedicated to your project", metier: "Real estate negotiator",
    complet: (n) => (n ? `Full file available from ${n}` : "Full file available on request"),
    completSuite: "additional photos, cadastral plan, technical surveys. We can also arrange a viewing at your convenience, on site or by video call. Do not hesitate to contact us.",
    aVendre: "For sale", type: "Property type", transaction: "Transaction", prix: "Price", surfHab: "Living area", annee: "Year built",
    depenses: (a, b) => `Estimated annual energy costs for standard use: between ${a} and ${b}.`, diag: (d) => `Survey dated ${d}.`, parAn: "year",
    entites: "Agence Hamilton — Selection Habitat - Selection Groupe entities", infos: (j) => `Listing information as of ${j}.`,
    nc: "Non-contractual document — information and areas are given as an indication only and do not engage the agency's liability.",
    dpeLegal: (d) => `Energy performance certificate dated ${d}.` },
};

const echap = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const milliers = (n, en) => String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, en ? "," : " ");
const euros = (n, en) => (en ? `€${String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}` : `${milliers(n)} €`);
const nombre = (v) => { const m = String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".").match(/\d+(\.\d+)?/); return m ? +m[0] : null; };
const surfaceTxt = (n, en) => (n == null ? "" : `${en ? String(n) : String(n).replace(".", ",")} m²`);
const sansAccent = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/* texte saisi en capitales dans le CRM (« GRANGE 2 x 38 M² ») : remis en minuscules, première lettre en capitale */
const casse = (t) => { const s = String(t || "").trim(); if (!s) return ""; const l = s.replace(/[^\p{L}]/gu, ""), maj = l.replace(/[^\p{Lu}]/gu, "").length;
  const b = l.length >= 3 && maj / l.length > 0.7 ? s.toLowerCase() : s; return b.charAt(0).toUpperCase() + b.slice(1); };
/* une phrase de l'annonce qui signe l'agence ou parle des langues est retirée (comme la fiche précédente) : la fiche porte déjà les marques */
const SIGNE = /agence|hamilton|s[ée]lection (habitat|ocean|med|immobilier|senegal|groupe)|groupe s[ée]lection|arieg.?immo|toit ?2 ?r[êe]ve|bliss|van den berg|we also speak|we spreken|wir sprechen/i;
/* marque du négociateur sur sa carte (« Négociateur immobilier — Agence Hamilton ») : seulement les deux marques du modèle */
const marqueDe = (nom) => (/hamilton/i.test(String(nom || "")) ? "Agence Hamilton" : /s[ée]lection\s+habitat/i.test(String(nom || "")) ? "Sélection Habitat" : "");

/* titre de la couverture en deux lignes comme le modèle (« BÂTISSE EN PIERRE » / « AU CŒUR D'UN DOMAINE AGRICOLE ») : le titre de
   l'annonce coupé à un séparateur (« - », « , », « : ») ou devant un mot de liaison ; aucun mot ajouté ni retiré */
const couper = (t) => {
  const s = String(t || "").trim();
  if (s.length <= 22) return [s, ""];
  const sep = s.match(/^(.{6,40}?)(?:\s*[-–—|]\s+|\s+[-–—|]\s*|,\s+|\s*:\s+)(.{3,})$/);
  if (sep) return [sep[1].trim(), sep[2].trim()];
  const re = /\s(?=(?:avec|au|aux|à|en|sur|sous|dans|près|proche|entre|face|with|in|on|near|by|overlooking)\s)/gi;
  let m;
  while ((m = re.exec(s))) if (m.index >= 8 && m.index <= 34 && s.length - m.index > 4) return [s.slice(0, m.index), s.slice(m.index + 1)];
  return [s, ""];
};

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
  /* Sidy, 17/11 : ni numéro de mandat, ni honoraires (ni qui les paie, ni leur montant) : ces critères ne sont pas lus */
  const prix = b.prix ? euros(b.prix, en) : "";
  const terrain = nombre(detFr["Surface terrain"]), annee = nombre(crit(51)) || nombre(val(/^ann[ée]e construction/i));
  const stats = [[b.pieces, M.pieces], [b.chambres, M.chambres], [b.surface, M.hab, "m²"], [terrain, M.terrain, "m²"], [annee, M.construction]]
    .filter(([v]) => v).map(([v, l, u]) => ({ v: u ? milliers(v, en) : String(v), u: u || "", l }));
  /* caractéristiques : les champs de l'annonce déjà filtrés (slide 07), rangés comme dans le modèle. « Informations complémentaires »
     (texte libre du CRM, classé interne le 03/11) n'est plus lu : seuls les critères de l'annonce. */
  const vu = new Set(["Pays", "Consommation énergie primaire", "Gaz Effet de Serre", "Valeur consommation énergie primaire", "Valeur Gaz Effet de serre", "Soumis à l'affichage du DPE", "Temps de trajet", "Surface terrain", "Année construction", "Informations complémentaires"]);
  const libelle = (k) => (en ? T.traduireNom(k) || "" : k.replace(/^Type de Stationnement$/, "Stationnement").replace(/^Mode Chauffage$/, "Chauffage").replace(/^Nombre places parking$/, "Places de parking")
    .replace(/^Nombre de terrasses$/, "Terrasses").replace(/^Cave\(s\)$/, "Caves").replace(/^Nombre étages$/, "Étages").replace(/^Surface séjour$/, "Surface du séjour").replace(/^Salle\(s\) de bains$/, "Salles de bains").replace(/^Salle\(s\) d'eau$/, "Salles d'eau"));
  const lot = /appartement|studio|duplex|loft|apartment|flat/i.test(String(b.type));
  const g = { bien: [[M.type, typeAff], [M.transaction, M.aVendre], ...(prix ? [[M.prix, prix]] : []), ...(b.surface ? [[M.surfHab, surfaceTxt(b.surface, en)]] : []),
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
  /* résumé du bien : les points marquants que l'annonce donne, tels quels */
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
  /* DPE : lettres, valeurs, dépenses estimées et date (confirmé par Sidy le 17/11) */
  const lettre = (v) => (/^[A-G]$/i.test(String(v).trim()) ? String(v).trim().toUpperCase() : "");
  const dpe = { dpe: lettre(detFr["Consommation énergie primaire"]), ges: lettre(detFr["Gaz Effet de Serre"]),
    dpeVal: detFr["Valeur consommation énergie primaire"] ? `${detFr["Valeur consommation énergie primaire"]} kWh/m²/${M.parAn}` : "",
    gesVal: detFr["Valeur Gaz Effet de serre"] ? `${detFr["Valeur Gaz Effet de serre"]} kg CO₂/m²/${M.parAn}` : "" };
  const dMin = nombre(crit(2736)), dMax = nombre(crit(2737)), dateDpe = crit(1850);
  dpe.date = /^\d{2}\/\d{2}\/\d{4}$/.test(dateDpe) ? dateDpe : "";
  dpe.note = [dMin && dMax ? M.depenses(euros(dMin, en), euros(dMax, en)) : "", dpe.date ? M.diag(dpe.date) : ""].filter(Boolean).join(" ");
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
  const [titreCouv, sousTitre] = couper(titre);
  return { langue: en ? "en" : "fr", lieu, titre, titreCouv, sousTitre, accroche, prix, stats, paragraphes, atouts, carac: g, dpe, groupes,
    photos: (photos || []).filter((u) => /^(https:\/\/|data:image\/)/.test(String(u))).slice(0, 37), jour,
    /* négociateur : son nom seul (règle de Pascal du 23/10, rappelée par Sidy le 17/11), jamais son téléphone ni son e-mail */
    contact: { nom: String(contact.nom || "").trim(), agence: nomAgence, marque: marqueDe(agence && agence.nom) } };
};

/* ---------- rendu HTML (A4, Chromium) ---------- */
const DPE_COUL = { A: "#3b9b48", B: "#5dbb57", C: "#97d078", D: "#f5e14b", E: "#f5b14b", F: "#ee7b2e", G: "#e03c31" };
const echelle = (lettre, valeur) => ["A", "B", "C", "D", "E", "F", "G"].map((l, i) =>
  `<div class="barre"><span style="width:${(17.9 + i * 6.43).toFixed(2)}mm;background:${DPE_COUL[l]}"><i>${l}</i></span>${l === lettre && valeur ? `<b>${echap(valeur)}</b>` : ""}</div>`).join("");
const tableau = (lignes) => `<table class="carac">${lignes.map(([l, v]) => `<tr><td>${echap(l)}</td><td>${echap(v)}</td></tr>`).join("")}</table>`;
/* bas de la couverture et de la dernière page : les deux marques, leurs logos blancs et leurs sites (modèle) */
const MARQUES = `<div class="marques"><div class="m-or"></div><div class="m-vert"></div><img class="l-ham" src="${RES.logo_hamilton_blanc}" alt="Agence Hamilton"><img class="l-sh" src="${RES.logo_sh_blanc}" alt="Selection Habitat">
<div class="sites"><span class="s-ham">www.agence-hamilton.com</span><span class="s-sh">www.selectionhabitat.com</span></div></div>`;

const htmlFiche = (d) => {
  const M = MOTS[d.langue] || MOTS.fr, en = d.langue === "en";
  /* grand titre : 50 pt comme le modèle (« BÂTISSE EN PIERRE »), réduit pour tenir sur une ligne de 175 mm (largeur moyenne d'une
     capitale de Jost Light ≈ 0,58 em) ; au-delà de 26 pt (18 pt pour plus de 60 signes), il passe à la ligne */
  const n = (d.titreCouv || d.titre || "").length, tailleTitre = Math.max(n > 60 ? 18 : 26, Math.min(50, Math.floor(496 / (0.58 * Math.max(n, 1)))));
  const tailleSous = (d.sousTitre || "").length > 36 ? 11.5 : 13.3, espaceSous = (d.sousTitre || "").length > 36 ? ".16em" : ".3em";
  const css = `
@font-face{font-family:Lato;font-weight:300;src:url(${RES.lato_300}) format("woff2")}
@font-face{font-family:Lato;font-weight:400;src:url(${RES.lato_400}) format("woff2")}
@font-face{font-family:Lato;font-weight:700;src:url(${RES.lato_700}) format("woff2")}
@font-face{font-family:Jost;font-weight:300;src:url(${RES.jost_300}) format("woff2")}
@font-face{font-family:Bodoni;font-weight:400;font-style:italic;src:url(${RES.bodoni_400i}) format("woff2")}
@page{size:A4;margin:15mm 15mm 19mm;
  @top-left-corner{content:"";background:linear-gradient(${C.or} 0 2.4mm,transparent 2.4mm)}
  @top-left{content:"";width:90mm;background:linear-gradient(${C.or} 0 2.4mm,transparent 2.4mm)}
  @top-right{content:"";width:90mm;background:linear-gradient(${C.vert} 0 2.4mm,transparent 2.4mm)}
  @top-right-corner{content:"";background:linear-gradient(${C.vert} 0 2.4mm,transparent 2.4mm)}
  @bottom-center{content:counter(page);font:400 8.7pt Lato;color:${C.grisPied}}}
@page pleine{margin:0;@top-left-corner{content:none}@top-left{content:none}@top-right{content:none}@top-right-corner{content:none}@bottom-center{content:none}}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;padding:0}
body{font-family:Lato,sans-serif;color:${C.texte};font-size:10.7pt;line-height:1.62}
.page{break-before:page}
.pleine{page:pleine;position:relative;height:297mm;width:210mm;overflow:hidden;break-before:page}
.pleine:first-child{break-before:auto}
.bandeau{position:absolute;top:0;left:0;right:0;height:2.4mm;background:linear-gradient(90deg,${C.or} 50%,${C.vert} 50%)}
/* couverture */
.sable{position:absolute;left:0;right:0;top:146.1mm;bottom:0;background:${C.sable}}
.couv-haut{position:absolute;top:15mm;left:15mm;right:15mm;height:87.5mm;display:flex;flex-direction:column;align-items:center;text-align:center;overflow:hidden}
.couv-haut .esp{flex:0 1 auto}
/* sans le numéro de mandat (Sidy, 17/11), « Dossier de présentation » prend la place et le style de la ligne du mandat du modèle */
.ref{flex:none;line-height:1.3;font-size:9.3pt;letter-spacing:.2em;text-transform:uppercase;color:${C.or}}
h1{flex:none;margin:0;font-family:Jost,Lato,sans-serif;font-weight:300;font-size:${tailleTitre}pt;line-height:1.08;letter-spacing:-.01em;text-transform:uppercase;color:${C.vert}}
.sous{flex:none;margin-top:1.2mm;font-weight:300;font-size:${tailleSous}pt;line-height:1.35;letter-spacing:${espaceSous};text-transform:uppercase;color:${C.or}}
.filet{flex:none;display:flex;align-items:center;gap:4.2mm}
.filet i{display:block;width:32.7mm;border-top:.75pt solid ${C.vert}}
.filet b{display:block;width:2mm;height:2mm;background:${C.vert};transform:rotate(45deg)}
.lieu{flex:none;font-size:9.3pt;font-weight:700;letter-spacing:.32em;text-transform:uppercase;color:${C.vert};line-height:1.55}
.accroche{flex:none;margin-top:2.6mm;font-family:Bodoni,Georgia,serif;font-style:italic;font-size:10.7pt;line-height:1.35;color:${C.or}}
.couv-photo{position:absolute;top:104.2mm;left:15mm;width:180mm;height:103.7mm;background:${C.creme} center/cover no-repeat}
.prix{position:absolute;top:180.5mm;left:0;width:62.3mm;min-height:19.8mm;background:${C.or};color:#fff;padding:2.6mm 5.9mm 2.4mm;text-align:right;display:flex;flex-direction:column;justify-content:center}
.prix b{display:block;font-size:18pt;font-weight:700;line-height:1.15}
.stats{position:absolute;top:215.2mm;left:0;width:198mm;display:grid;grid-template-columns:repeat(5,1fr)}
.stats div{height:18.3mm;padding:2.6mm 0 0 10.6mm;border-left:.75pt solid ${C.vert}}
.stats div:first-child{padding-left:18mm;border-left:0}
.stats b{font-size:14.7pt;font-weight:700;color:${C.orTexte};line-height:1.2}
.stats sup{font-size:7pt;font-weight:700;color:${C.orTexte};margin-left:.6mm;vertical-align:3.5pt}
.stats span{display:block;font-size:7.3pt;letter-spacing:.15em;text-transform:uppercase;color:${C.vert};line-height:1.5;margin-top:.3mm}
.marques .m-or,.marques .m-vert{position:absolute;top:257.2mm;height:28.6mm}
.marques .m-or{left:0;width:104.5mm;background:${C.or}}
.marques .m-vert{left:104.5mm;right:0;background:${C.vert}}
.marques img{position:absolute}
.marques .l-ham{left:28.5mm;top:264.4mm;width:38.25mm}
.marques .l-sh{left:145.2mm;top:263.7mm;width:30.7mm}
.sites{position:absolute;left:0;right:0;top:285.8mm;bottom:0;background:${C.sable}}
.sites span{position:absolute;top:4.3mm;width:70mm;margin-left:-35mm;text-align:center;font-size:6pt;font-weight:700;letter-spacing:.08em}
.sites .s-ham{left:47.8mm;color:${C.or}}
.sites .s-sh{left:161.4mm;color:${C.vert}}
/* titres des pages */
.surtitre{font-size:8.7pt;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:${C.orTexte};line-height:1.4;margin:0 0 .6mm}
h2{margin:0;font-weight:300;font-size:17pt;letter-spacing:.03em;line-height:1.25;color:${C.vert}}
.trait-bleu{margin:3.8mm 0 3.4mm;border-top:1.6pt solid ${C.bleu}}
/* le bien */
.texte p{margin:0 0 2.35mm;text-align:justify}
.texte h2{margin-bottom:1.2mm}
.resume{background:${C.creme};border-left:1mm solid ${C.vert};padding:5.2mm 6mm 2mm 6.8mm;margin:8.5mm 0 0;break-inside:avoid}
.resume h3{margin:0 0 4mm;font-weight:300;font-size:10.7pt;letter-spacing:.2em;text-transform:uppercase;color:${C.vert}}
.resume ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:0 8mm}
.resume li{position:relative;padding-left:5.9mm;margin-bottom:3.4mm;font-size:9.3pt;line-height:1.5}
.resume li:before{content:"";position:absolute;left:.2mm;top:1.25mm;width:2.4mm;height:2.4mm;border-radius:50%;background:${C.vert}}
.resume li b{color:${C.vert}}
/* caractéristiques */
.carac-titre .surtitre{font-size:10pt;margin-bottom:.4mm}
.carac-titre h2{font-size:16pt}
.carac-titre .lebien{font-size:11.3pt;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:${C.orTexte};line-height:1.5;margin-top:1.4mm;padding-bottom:1.6mm;border-bottom:1.5pt solid ${C.vert}}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 5.6mm}
h4{margin:0;height:9.6mm;padding-top:3mm;border-bottom:.8pt solid ${C.trait};font-size:9.3pt;letter-spacing:.3em;text-transform:uppercase;color:${C.orTexte};font-weight:700;line-height:1.3}
.ext h4{margin-top:9mm;height:auto;padding:0 0 3mm}
table{border-collapse:collapse;width:100%}
.carac td{padding:1.3mm 0 1.3mm 1.9mm;border-bottom:.8pt solid ${C.trait};font-size:8.7pt;line-height:1.35;vertical-align:top;font-weight:700}
.carac td:first-child{width:31.7mm;color:${C.gris}}.carac td:last-child{color:${C.texte}}
.ext .carac td:first-child{width:35%}
.groupe{break-inside:avoid}
.dpe{background:${C.creme};padding:4.4mm 5.9mm 5mm;margin-top:9mm;break-inside:avoid}
.dpe h3{margin:0 0 3mm;font-weight:300;font-size:9.3pt;letter-spacing:.3em;text-transform:uppercase;color:${C.vert}}
.dpe .cols{gap:0 3mm}
.dpe .cols>div>small{display:block;font-size:7.3pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.gris};margin-bottom:2mm}
.barre{display:flex;align-items:center;height:4.75mm}
.barre span{display:flex;align-items:center;height:3.8mm}
.barre i{display:block;font-style:normal;color:#fff;font-size:7.3pt;font-weight:700;padding-left:2.4mm;line-height:1}
.barre b{font-size:8pt;margin-left:2.5mm;color:${C.bleu};white-space:nowrap}
.dpe .note{margin-top:4mm;padding-top:3mm;border-top:.8pt solid ${C.trait};font-size:7.3pt;color:${C.gris};line-height:1.5}
/* pièces */
.niveau{margin-bottom:4.2mm;break-inside:avoid}
.niveau .tete{background:${C.vert};color:#fff;font-size:9.3pt;font-weight:700;letter-spacing:.3em;text-transform:uppercase;height:9mm;line-height:9mm;padding:0 4mm;break-after:avoid}
.niveau .tete.or{background:${C.or}}
.pieces th{font-size:7.3pt;letter-spacing:.12em;text-transform:uppercase;color:${C.grisClair};font-weight:700;padding:2.6mm 1.8mm 1.4mm;border-bottom:.8pt solid ${C.trait};text-align:left}
.pieces td{font-size:8.7pt;padding:1.6mm 1.8mm;border-bottom:.8pt solid ${C.trait};line-height:1.4}
.pieces tr{break-inside:avoid}
.pieces td:nth-child(2),.pieces th:nth-child(2){text-align:right;font-weight:700;width:20%;padding-right:4mm}
.pieces td:first-child{width:44%}
.pieces td:last-child{color:${C.grisDetail}}
/* galerie : dix-huit photos par page, trois colonnes */
.galerie{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm 3.6mm}
.galerie div{height:37.3mm;background:${C.creme} center/cover no-repeat}
/* contact */
.contact{position:absolute;top:15mm;left:15mm;right:15mm}
.contact .surtitre{font-size:8pt;margin-top:1.4mm}
.contact h2{font-size:17.3pt}
.carte{background:${C.vert};color:#fff;padding:9.5mm 13.6mm 10mm 9.9mm}
.carte small{display:block;font-size:8pt;letter-spacing:.3em;text-transform:uppercase;color:${C.orClair};line-height:1.4}
.carte .nom{font-size:19.3pt;font-weight:300;letter-spacing:.04em;margin:3mm 0 2mm;line-height:1.2}
.carte .agence{font-size:9.3pt;color:${C.orClair}}
.encart{background:${C.creme};border-left:1mm solid ${C.vert};padding:3.6mm 8mm 3.6mm 8.6mm;margin-top:6.4mm;font-size:9.3pt;line-height:1.55}
.encart b{color:${C.vert}}
.legal{font-size:7.3pt;color:${C.grisClair};line-height:1.5;margin-top:5.6mm}
.filets{position:absolute;left:15mm;right:15mm;top:174.4mm;height:17.2mm;border-top:.8pt solid ${C.trait};border-bottom:.8pt solid ${C.trait}}`;
  const titreSection = (sur, titre, trait = true) => `<div class="surtitre">${echap(sur)}</div><h2>${echap(titre)}</h2>${trait ? '<div class="trait-bleu"></div>' : ""}`;
  const out = [];
  /* 1. couverture */
  out.push(`<section class="pleine couverture"><div class="sable"></div>
<div class="couv-haut"><i class="esp" style="flex-basis:2.6mm"></i><div class="ref">${echap(M.dossier)}</div>
<i class="esp" style="flex-basis:16.4mm"></i><h1>${echap(d.titreCouv || d.titre)}</h1>${d.sousTitre ? `<div class="sous">${echap(d.sousTitre)}</div>` : ""}
<i class="esp" style="flex-basis:7.4mm"></i><div class="filet"><i></i><b></b><i></i></div>
<i class="esp" style="flex-basis:8.6mm"></i>${d.lieu ? `<div class="lieu">${echap(d.lieu)}</div>` : ""}${d.accroche ? `<div class="accroche">${echap(d.accroche)}</div>` : ""}</div>
${d.photos[0] ? `<div class="couv-photo" style="background-image:url('${echap(d.photos[0])}')"></div>` : ""}
${d.prix ? `<div class="prix"><b>${echap(d.prix)}</b></div>` : ""}
${d.stats.length ? `<div class="stats">${d.stats.map((s) => `<div><b>${echap(s.v)}</b>${s.u ? `<sup>${s.u}</sup>` : ""}<span>${echap(s.l)}</span></div>`).join("")}</div>` : ""}
${MARQUES}</section>`);
  /* 2. le bien et son résumé */
  if (d.paragraphes.length) out.push(`<section class="page texte">${titreSection(M.leBien, d.titre, false)}${d.paragraphes.map((x) => `<p>${echap(x)}</p>`).join("")}
${d.atouts.length >= 3 ? `<div class="resume"><h3>${echap(M.resume)}</h3><ul>${d.atouts.map(([l, v]) => `<li><b>${echap(l)}</b> : ${echap(v)}</li>`).join("")}</ul></div>` : ""}</section>`);
  /* 3. caractéristiques et DPE */
  const aDpe = d.dpe.dpe || d.dpe.ges;
  out.push(`<section class="page"><div class="carac-titre"><div class="surtitre">${echap(M.carac)}</div><h2>${echap(M.essentiel)}</h2><div class="lebien">${echap(M.grBien)}</div></div>
<div class="cols"><div class="groupe"><h4></h4>${tableau(d.carac.bien)}</div><div class="groupe">${d.carac.confort.length ? `<h4>${echap(M.grConfort)}</h4>${tableau(d.carac.confort)}` : ""}</div></div>
${d.carac.ext.length ? `<div class="groupe ext"><h4>${echap(M.grExt)}</h4>${tableau(d.carac.ext)}</div>` : ""}
${aDpe ? `<div class="dpe"><h3>${echap(M.perf)}</h3><div class="cols">${d.dpe.dpe ? `<div><small>${echap(M.conso)}</small>${echelle(d.dpe.dpe, d.dpe.dpeVal)}</div>` : "<div></div>"}${d.dpe.ges ? `<div><small>${echap(M.ges)}</small>${echelle(d.dpe.ges, d.dpe.gesVal)}</div>` : ""}</div>${d.dpe.note ? `<div class="note">${echap(d.dpe.note)}</div>` : ""}</div>` : ""}</section>`);
  /* 4. pièces : bandeau vert par niveau, doré pour les dépendances et extérieurs (modèle) */
  if (d.groupes.length) out.push(`<section class="page">${titreSection(M.volumes, M.listePieces)}${d.groupes.map((g) => `<div class="niveau"><div class="tete${/d[ée]pendance|ext[ée]rieur|annexe/i.test(g.titre) ? " or" : ""}">${echap(g.titre)}</div>
<table class="pieces"><thead><tr><th>${echap(M.piece)}</th><th>${echap(M.surface)}</th><th>${echap(M.detail)}</th></tr></thead><tbody>${g.lignes.map(([nom, s, x]) => `<tr><td>${echap(nom)}</td><td>${s ? echap(s) : "—"}</td><td>${echap(x)}</td></tr>`).join("")}</tbody></table></div>`).join("")}</section>`);
  /* 5. galerie : dix-huit photos par page */
  const gal = d.photos.slice(1), pages = Math.ceil(gal.length / 18);
  for (let i = 0; i < pages; i++) out.push(`<section class="page">${titreSection(M.galerie, `${M.photos} — ${i + 1}/${pages}`)}<div class="galerie">${gal.slice(i * 18, i * 18 + 18).map((u) => `<div style="background-image:url('${echap(u)}')"></div>`).join("")}</div></section>`);
  /* 6. contact, puis les deux marques en bas de page */
  const c = d.contact, legal = [`${M.entites}.`, d.prix ? `${M.prix}${en ? ":" : " :"} ${d.prix}.` : "",
    M.infos(d.jour), d.dpe.date ? M.dpeLegal(d.dpe.date) : "", M.nc].filter(Boolean).join(" ");
  out.push(`<section class="pleine"><div class="bandeau"></div><div class="contact">${titreSection(M.contact, M.nego)}
${c.nom ? `<div class="carte"><small>${echap(M.metier)}${c.marque ? ` — ${echap(c.marque)}` : ""}</small><div class="nom">${echap(c.nom)}</div>${c.agence ? `<div class="agence">${echap(c.agence)}</div>` : ""}</div>` : ""}
<div class="encart"><b>${echap(M.complet(c.nom))}</b> — ${echap(M.completSuite)}</div>
<div class="legal">${echap(legal)}</div></div><div class="filets"></div>
${MARQUES}</section>`);
  return `<!doctype html><html lang="${en ? "en" : "fr"}"><head><meta charset="utf-8"><title>${echap(d.titre)}</title><style>${css}</style></head><body>${out.join("\n")}</body></html>`;
};

module.exports = { donneesFiche, htmlFiche, couper, marqueDe };
