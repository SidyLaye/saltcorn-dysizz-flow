/* Rapprochement lead → bien du CRM (procédure « non-conformes », revue sur les 8 675 mails d'AMBS) :
   1. identifiant CRM explicite (lien, « ID de ton CRM », identifiant à 8 chiffres dans une référence) ;
   2. chaque référence lue dans le mail (celle de l'agence, le mandat, celle du portail), complète ;
   3. puis ses variantes : sans le dernier caractère, segments de droite à gauche, paires de segments, partie numérique ;
   chaque bien trouvé est comparé aux infos du mail (prix, surface, pièces, ville, code postal, type) :
   une contradiction le rejette et on continue ;
   4. recherche par critères : chaque bien du catalogue est noté sur le prix (obligatoire), la surface, les pièces
      et le lieu ; le type ne filtre jamais (« Propriété » sur Leboncoin est une « Maison » dans le CRM).
      Un bien n'est retenu que s'il est seul en tête, sans contradiction, avec le prix et un autre fait concordants.
   Le lieu affiché par un portail est souvent approximatif (commune voisine, grande ville la plus proche) :
   un désaccord de lieu n'est alors jamais une contradiction.
   Le CRM est injecté : crm.bienParId(id), crm.biensParReference(ref), crm.tousLesBiens() (catalogue local, si présent),
   sinon crm.biensParCriteres(criteres, { max }). */
"use strict";
const { cle } = require("./texte");

const REGLES = { prix_ok: 0.035, prix_proche: 0.10, prix_ko: 0.10, surface_ok_m2: 3, surface_ok: 0.035, surface_ko: 0.10, surface_ko_m2: 8 };

const ecart = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
/* « Ste-Croix » = « Sainte Croix », « St-Cere » = « Saint Céré » */
const formeVille = (v) => cle(v).replace(/\b(sainte|ste)\b/g, "ste").replace(/\b(saint|st)\b/g, "st").replace(/\s+/g, "");
const memeVille = (a, b) => { const x = formeVille(a), y = formeVille(b); return x && y && (x === y || x.includes(y) || y.includes(x)); };

/* Compare les faits du mail et du bien. Renvoie { accords, conflits, inconnus, legers }. */
const comparer = (mail = {}, bien = {}, regles = REGLES) => {
  const out = { accords: [], conflits: [], inconnus: [], legers: [] };
  const note = (nom, ok, ko) => (ok ? out.accords : ko ? out.conflits : out.inconnus).push(nom);
  const prixMail = mail.prix ? [+mail.prix] : (mail.prix_candidats || []).map(Number).filter((x) => x > 0);
  if (prixMail.length && +bien.prix > 0) {
    const e = Math.min(...prixMail.map((p) => ecart(p, +bien.prix)));
    /* un prix relevé dans le texte (pas lu à sa place) ne peut que confirmer, jamais contredire */
    if (mail.prix || e <= regles.prix_ok) note("prix", e <= regles.prix_ok, e > regles.prix_ko);
    if (prixMail.some((p) => p === +bien.prix)) out.prix_exact = true;
    if (e > regles.prix_ok && e <= regles.prix_proche) out.prix_proche = true;
  }
  if (mail.loyer && bien.prix && +bien.prix < 20000) { const e = ecart(+mail.loyer, +bien.prix); note("prix", e <= 0.1, e > 0.25); }
  if (mail.surface && +bien.surface > 0) { const d = Math.abs(mail.surface - bien.surface), e = ecart(+mail.surface, +bien.surface); note("surface", d <= regles.surface_ok_m2 || e <= regles.surface_ok, e > regles.surface_ko && d > regles.surface_ko_m2); }
  if (mail.pieces && +bien.pieces > 0) note("pieces", +mail.pieces === +bien.pieces, Math.abs(mail.pieces - bien.pieces) >= 2);
  /* Lieu : un portail au lieu approximatif ne contredit jamais ; il peut seulement confirmer. */
  const approx = !!mail.lieu_approche;
  if (mail.code_postal && bien.code_postal) {
    const ok = String(mail.code_postal) === String(bien.code_postal), ko = String(mail.code_postal).slice(0, 2) !== String(bien.code_postal).slice(0, 2);
    if (ok || !approx) note("code_postal", ok, ko && !approx); if (!ok && approx) out.legers.push("code_postal");
  } else if (mail.departement && bien.code_postal) {
    const ok = String(bien.code_postal).startsWith(mail.departement);
    if (ok || !approx) note("departement", ok, !ok && !approx); if (!ok && approx) out.legers.push("departement");
  }
  if (mail.ville && bien.ville) { const ok = memeVille(mail.ville, bien.ville); if (ok || !approx) { note("ville", ok, false); if (!ok) out.legers.push("ville"); } else out.legers.push("ville"); }
  if (mail.type && bien.type) { const ok = mail.type === bien.type; note("type", ok, false); if (!ok) out.legers.push("type"); }
  return out;
};

/* Verdict selon la force de la preuve d'origine :
   - « tres_forte » : identifiant CRM, ou référence exacte d'au moins 8 caractères (identifiant unique de diffusion) :
     un seul fait contraire (prix changé, lieu mal affiché par le portail) est toléré, signalé ;
   - « forte » : référence exacte de l'agence : aucun conflit, ou un seul s'il y a deux accords ou le prix exact ;
   - « faible » (variante, segment, critères) : au moins un fait qui distingue vraiment le bien, aucun conflit. */
const DISTINCTIFS = ["prix", "surface", "code_postal", "ville", "departement"];
const verdict = (cmp, minAccords, force = "faible") => {
  if (force === true) force = "forte";
  const legers = cmp.legers || [];
  const distinctifs = cmp.accords.filter((a) => DISTINCTIFS.includes(a));
  const ecartSignale = (c) => ({ ok: true, raison: "accords : " + (cmp.accords.join(", ") || "aucun") + " — écart signalé : " + c, alerte: c });
  if (force === "tres_forte") {
    if (!cmp.conflits.length) return { ok: true, raison: cmp.accords.length ? "accords : " + cmp.accords.join(", ") : "identifiant exact, rien à comparer", alerte: legers.length ? legers.join(", ") : undefined };
    if (cmp.conflits.length === 1) return ecartSignale(cmp.conflits[0]);
    return { ok: false, raison: "contradiction : " + cmp.conflits.join(", ") };
  }
  if (force === "forte") {
    /* le lieu seul (commune voisine affichée par l'agence ou le portail) ne rejette pas une référence exacte : il est signalé */
    if (cmp.conflits.length && cmp.conflits.every((c) => ["code_postal", "departement", "ville"].includes(c))) return ecartSignale(cmp.conflits.join(", "));
    if (!cmp.conflits.length) return { ok: true, raison: cmp.accords.length ? "accords : " + cmp.accords.join(", ") : "référence exacte, rien à comparer", alerte: legers.length ? legers.join(", ") : undefined };
    if (cmp.conflits.length === 1 && (cmp.accords.length >= 2 || cmp.prix_exact)) return ecartSignale(cmp.conflits[0]);
    return { ok: false, raison: "contradiction : " + cmp.conflits.join(", ") };
  }
  if (minAccords <= 0 && !cmp.conflits.length) return { ok: true, raison: cmp.accords.length ? "accords : " + cmp.accords.join(", ") : "rien à comparer" };
  const solide = distinctifs.length >= 2;
  if (cmp.conflits.length === 1 && cmp.conflits[0] === "prix" && solide) return ecartSignale("prix");
  if (cmp.conflits.length) return { ok: false, raison: "contradiction : " + cmp.conflits.join(", ") };
  if (legers.filter((l) => l !== "type").length && !solide) return { ok: false, raison: "contradiction : " + legers.join(", ") + " (preuve faible)" };
  if (!distinctifs.length) return { ok: false, raison: "preuves insuffisantes : seulement " + (cmp.accords.join(", ") || "rien") };
  if (cmp.accords.length < minAccords) return { ok: false, raison: `preuves insuffisantes (${cmp.accords.length}/${minAccords} accord)` };
  return legers.length ? ecartSignale(legers.join(", ")) : { ok: true, raison: "accords : " + cmp.accords.join(", ") };
};

/* Variantes d'une référence, dans l'ordre de la procédure décrite au client : complète, sans le dernier caractère,
   segments de droite à gauche ; puis paires de segments voisins (« AB-1234 » dans « 7654321a-AB-1234 ») et
   parties numériques. */
/* Suffixes ajoutés par l'agence dans le CRM et absents des portails (« 33074 » sur Giraffe = « 33074-EXCL » dans
   Immofacile pour une exclusivité). La recherche du CRM est exacte : on essaie aussi la référence + suffixe, mais
   avec au moins un fait concordant (code postal, ville, prix…) pour ne jamais prendre un autre bien. */
const SUFFIXES = ["EXCL"];
const variantes = (ref, suffixes = SUFFIXES) => {
  const r = String(ref || "").trim();
  if (!r) return [];
  const out = [];
  const add = (valeur, etape, min) => { if (valeur && valeur.length >= 2 && !out.some((x) => x.valeur.toLowerCase() === valeur.toLowerCase())) out.push({ valeur, etape, min }); };
  add(r, "reference_complete", 0);
  /* seulement une référence courte de l'agence (« 33074 », « AC28925 ») : pas les identifiants composés des portails */
  if (/^[a-z0-9]{2,10}$/i.test(r)) for (const sfx of suffixes || []) if (sfx) add(`${r}-${sfx}`, "reference_suffixe", 1);
  const seg = r.split(/[_\-/.\s|:]+/).filter(Boolean);
  /* « 32562-32562 » : la même référence répétée vaut la référence complète */
  if (seg.length > 1 && new Set(seg.map((x) => x.toLowerCase())).size === 1) add(seg[0], "reference_complete", 0);
  if (r.length > 3) add(r.slice(0, -1), "reference_moins_dernier", 1);
  if (seg.length > 1) for (let i = seg.length - 1; i >= 0; i--) add(seg[i], "segment_" + (seg.length - i), 1);
  if (seg.length > 2) {
    const sep = r.match(/[_\-/.\s|:]+/g) || [];
    for (let i = seg.length - 2; i >= 0; i--) add(seg[i] + (sep[i] || "-") + seg[i + 1], "segments_" + (seg.length - i - 1) + "_" + (seg.length - i), 1);
  }
  const num = r.match(/\d{3,}/g) || [];
  for (let i = num.length - 1; i >= 0; i--) add(num[i], "partie_numerique", 1);
  return out;
};

/* Force d'une référence exacte : identifiant de diffusion long = très forte ; référence de l'agence d'au moins
   3 caractères = forte ; plus courte = faible (elle peut désigner un autre bien, les faits doivent confirmer). */
const forceRef = (valeur, etape) => {
  const n = String(valeur).replace(/[^A-Za-z0-9]/g, "").length;
  if (etape !== "reference_complete") return "faible";
  return n >= 8 ? "tres_forte" : n >= 3 ? "forte" : "faible";
};

/* Note d'un bien du catalogue pour la recherche par critères. */
const noter = (faits, b, regles = REGLES, exigeants = false) => {
  const cmp = comparer(faits, b, regles);
  const n = { cmp, score: 0 };
  if (cmp.accords.includes("prix")) n.score += 3; else if (cmp.prix_proche) n.score += 1;
  if (cmp.accords.includes("surface")) n.score += 2;
  if (cmp.accords.includes("pieces")) n.score += 1;
  if (cmp.accords.some((a) => ["code_postal", "ville"].includes(a))) n.score += 2; else if (cmp.accords.includes("departement")) n.score += 0.5;
  if (cmp.accords.includes("type")) n.score += 0.5;
  /* conditions pour être retenu : aucun conflit, prix concordant (ou proche avec surface ET pièces), et un autre fait */
  /* le département seul ne distingue pas un bien ; quand le mail donnait une référence absente du catalogue (annonce
     retirée, bien vendu), un autre bien au même prix est un piège : il faut alors deux autres faits concordants */
  const autres = cmp.accords.filter((a) => ["surface", "pieces", "code_postal", "ville"].includes(a));
  const besoin = exigeants ? 2 : 1;
  n.recevable = !cmp.conflits.length && ((cmp.accords.includes("prix") && autres.length >= besoin) || (cmp.prix_proche && cmp.accords.includes("surface") && cmp.accords.includes("pieces")));
  return n;
};

const rapprocher = async (lead, crm, opts = {}) => {
  const b = lead.bien || {};
  const faits = { lieu_approche: b.lieu_approche, loyer: b.loyer, prix: b.prix, prix_candidats: b.prix ? undefined : b.prix_candidats, surface: b.surface, pieces: b.pieces, chambres: b.chambres, type: b.type, ville: b.ville, code_postal: b.code_postal, departement: b.departement };
  const regles = opts.regles || REGLES;
  const etapes = [], alertes = [];
  const essayer = async (etape, requete, biens, minAccords, force = "faible") => {
    const vus = new Set(), list = (biens || []).filter((x) => x && !vus.has(String(x.id)) && vus.add(String(x.id)));
    const res = { etape, requete, trouves: list.length, candidats: [] };
    etapes.push(res);
    for (const x of list) {
      const cmp = comparer(faits, x, regles);
      const v = verdict(cmp, minAccords, force);
      res.candidats.push({ id: x.id, reference: x.reference, ok: v.ok, raison: v.raison, alerte: v.alerte });
    }
    const ok = res.candidats.filter((c) => c.ok);
    if (ok.length === 1) { const x = list.find((y) => y.id === ok[0].id); if (ok[0].alerte) alertes.push(ok[0].alerte + " différent entre le mail et le CRM"); return x; }
    if (ok.length > 1) res.ambigu = true;
    return null;
  };

  /* 1. identifiant CRM explicite (y compris un identifiant à 8 chiffres commençant par 6 caché dans une référence) */
  const toutesRefs = [b.reference, ...(b.references_autres || []), b.reference_portail].filter(Boolean).map(String);
  const idsCaches = toutesRefs.flatMap((x) => x.split(/[^0-9]+/)).filter((x) => /^6\d{7}$/.test(x));
  for (const id of [...new Set([b.id_crm, ...idsCaches].filter(Boolean).map(String))]) {
    const x = await crm.bienParId(id).catch(() => null);
    const hit = await essayer("identifiant_crm", id, x ? [x] : [], 0, "tres_forte");
    if (hit) return { bien: hit, methode: "identifiant_crm", etapes, alertes, confiance: "haute" };
  }
  /* 2-3. toutes les références, complètes d'abord (agence, mandat, portail), puis leurs variantes */
  const refs = [...new Set(toutesRefs)];
  const essais = [];
  for (const ref of refs) for (const v of variantes(ref, opts.suffixes || SUFFIXES)) essais.push(v);
  /* référence complète d'abord, puis référence + suffixe, puis les variantes plus courtes */
  const rang = (e) => (e === "reference_complete" ? 0 : e === "reference_suffixe" ? 1 : 2);
  essais.sort((a, c) => rang(a.etape) - rang(c.etape));
  const deja = new Set();
  for (const v of essais) {
    const k = v.valeur.toLowerCase(); if (deja.has(k)) continue; deja.add(k);
    const biens = await crm.biensParReference(v.valeur).catch(() => []);
    const exacts = biens.filter((x) => String(x.reference).trim().toLowerCase() === k);
    const force = forceRef(v.valeur, v.etape);
    /* référence + suffixe écrite telle quelle dans le mail (« réf. 33074-excl ») : c'est la preuve, pas besoin d'un autre fait */
    const litterale = v.etape === "reference_suffixe" && opts.texte && String(opts.texte).toLowerCase().includes(k);
    const hit = await essayer(v.etape, v.valeur, exacts, litterale ? 0 : force === "faible" || v.etape === "reference_suffixe" ? Math.max(v.min, 1) : v.min, litterale ? "forte" : force);
    if (hit) return { bien: hit, methode: v.etape, etapes, alertes, confiance: force === "faible" ? "moyenne" : "haute" };
  }
  /* 4. recherche par critères : le catalogue entier est noté (le prix est obligatoire) */
  if (!opts.sansCriteres && (faits.prix || (faits.prix_candidats || []).length || faits.loyer)) {
    let cands = null;
    if (crm.tousLesBiens) cands = await crm.tousLesBiens().catch(() => null);
    if (!cands && crm.biensParCriteres) {
      const p = faits.prix || (faits.prix_candidats || [])[0];
      cands = await crm.biensParCriteres({ prix_min: Math.floor(p * (1 - regles.prix_proche)), prix_max: Math.ceil(p * (1 + regles.prix_proche)), ...(faits.code_postal && !faits.lieu_approche ? { lieu: faits.code_postal } : {}) }, { max: 50 }).catch(() => []);
    }
    const exigeants = refs.length > 0;
    const notes = (cands || []).map((x) => ({ x, ...noter(faits, x, regles, exigeants) })).filter((n) => n.score > 0).sort((a, c) => c.score - a.score);
    const recevables = notes.filter((n) => n.recevable);
    const e = { etape: "criteres", requete: "catalogue noté", trouves: recevables.length, candidats: notes.slice(0, 5).map((n) => ({ id: n.x.id, reference: n.x.reference, score: n.score, ok: n.recevable, raison: (n.cmp.conflits.length ? "contradiction : " + n.cmp.conflits.join(", ") + " ; " : "") + "accords : " + (n.cmp.accords.join(", ") || "aucun") })) };
    etapes.push(e);
    const [t, s] = recevables;
    const autreProche = s && s.score > t.score - 1;
    if (t && !autreProche) {
      if (t.cmp.legers.length) alertes.push(t.cmp.legers.join(", ") + " différent entre le mail et le CRM");
      return { bien: t.x, methode: "criteres:" + t.cmp.accords.join("+"), etapes, alertes, confiance: t.cmp.accords.length >= 3 ? "moyenne" : "basse" };
    }
    if (autreProche) e.ambigu = true;
  }
  const ambigu = etapes.some((x) => x.ambigu);
  const contredit = etapes.some((x) => (x.candidats || []).some((c) => /contradiction/.test(c.raison) && x.etape !== "criteres"));
  const pistes = etapes.filter((x) => x.etape === "criteres").flatMap((x) => (x.candidats || []).filter((c) => c.ok)).slice(0, 3).map((c) => c.reference);
  return { bien: null, methode: null, etapes, pistes, motif: ambigu ? "plusieurs biens possibles" + (pistes.length ? " (" + pistes.join(", ") + ")" : "") : contredit ? "bien trouvé mais contredit par le mail" : refs.length ? "référence introuvable" : "pas de référence ni assez de critères (le prix est nécessaire)" };
};

module.exports = { rapprocher, comparer, verdict, variantes, noter, forceRef, REGLES };
