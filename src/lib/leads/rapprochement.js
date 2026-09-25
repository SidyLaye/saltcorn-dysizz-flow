/* Rapprochement lead → bien du CRM (procédure « non-conformes ») :
   1. identifiant CRM explicite (lien, « ID de ton CRM ») ;
   2. référence complète ;
   3. référence moins le dernier caractère ;
   4. référence composite : segments lus de droite à gauche ;
   chaque bien trouvé est comparé aux infos du mail (prix, ville, code postal,
   surface, pièces, type) : contradiction → rejet et on continue ;
   5. recherche séquentielle par critères (on ajoute un critère à la fois,
      retour arrière si zéro, arrêt dès qu'il reste un seul bien).
   Le CRM est injecté : crm.bienParId(id), crm.biensParReference(ref),
   crm.biensParCriteres(criteres) (au plus 2 résultats suffisent). */
"use strict";
const { cle } = require("./texte");

const REGLES = { prix_ok: 0.035, prix_ko: 0.10, surface_ok_m2: 3, surface_ok: 0.035, surface_ko: 0.10 };

const ecart = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
const memeVille = (a, b) => { const x = cle(a).replace(/\b(saint|st)\b/g, "st").replace(/\s+/g, ""), y = cle(b).replace(/\b(saint|st)\b/g, "st").replace(/\s+/g, ""); return x && y && (x === y || x.includes(y) || y.includes(x)); };

/* Compare les faits du mail et du bien. Renvoie { accords:[], conflits:[], inconnus:[] }. */
const comparer = (mail = {}, bien = {}, regles = REGLES) => {
  const out = { accords: [], conflits: [], inconnus: [] };
  const note = (nom, ok, ko) => (ok ? out.accords : ko ? out.conflits : out.inconnus).push(nom);
  if (mail.prix && bien.prix) { const e = ecart(+mail.prix, +bien.prix); note("prix", e <= regles.prix_ok, e > regles.prix_ko); }
  if (mail.surface && bien.surface) { const d = Math.abs(mail.surface - bien.surface), e = ecart(+mail.surface, +bien.surface); note("surface", d <= regles.surface_ok_m2 || e <= regles.surface_ok, e > regles.surface_ko && d > regles.surface_ok_m2); }
  if (mail.pieces && bien.pieces) note("pieces", +mail.pieces === +bien.pieces, Math.abs(mail.pieces - bien.pieces) >= 2);
  if (mail.code_postal && bien.code_postal) note("code_postal", mail.code_postal === bien.code_postal, mail.code_postal.slice(0, 2) !== String(bien.code_postal).slice(0, 2));
  else if (mail.departement && bien.code_postal) note("departement", String(bien.code_postal).startsWith(mail.departement), !String(bien.code_postal).startsWith(mail.departement));
  if (mail.ville && bien.ville) note("ville", memeVille(mail.ville, bien.ville), false);
  if (mail.type && bien.type) note("type", mail.type === bien.type, false);
  return out;
};

/* Verdict : aucun conflit, et assez d'accords selon la solidité de la preuve d'origine. */
const verdict = (cmp, minAccords, preuveForte = false) => {
  /* Référence exacte ou identifiant CRM : un seul écart (souvent le prix après une baisse)
     est toléré si au moins deux autres faits concordent ; il est signalé. */
  if (preuveForte && cmp.conflits.length === 1 && cmp.accords.length >= 2) return { ok: true, raison: "accords : " + cmp.accords.join(", ") + " — écart signalé : " + cmp.conflits[0], alerte: cmp.conflits[0] };
  if (cmp.conflits.length) return { ok: false, raison: "contradiction : " + cmp.conflits.join(", ") };
  if (cmp.accords.length < minAccords) return { ok: false, raison: `preuves insuffisantes (${cmp.accords.length}/${minAccords} accord)` };
  return { ok: true, raison: cmp.accords.length ? "accords : " + cmp.accords.join(", ") : "référence exacte, rien à comparer" };
};

/* Variantes d'une référence : complète, sans le dernier caractère, segments de droite à gauche. */
const variantes = (ref) => {
  const r = String(ref || "").trim();
  if (!r) return [];
  const out = [];
  const add = (valeur, etape, min) => { if (valeur && valeur.length >= 2 && !out.some((x) => x.valeur === valeur)) out.push({ valeur, etape, min }); };
  add(r, "reference_complete", 0);
  if (r.length > 3) add(r.slice(0, -1), "reference_moins_dernier", 1);
  const seg = r.split(/[_\-/.\s|:]+/).filter(Boolean);
  if (seg.length > 1) for (let i = seg.length - 1; i >= 0; i--) add(seg[i], "segment_" + (seg.length - i), 1);
  const num = r.match(/\d{3,}/g) || [];
  for (let i = num.length - 1; i >= 0; i--) add(num[i], "partie_numerique", 1);
  return out;
};

const CRITERES = ["type", "pieces", "surface", "prix", "lieu"];

const rapprocher = async (lead, crm, opts = {}) => {
  const b = lead.bien || {};
  const faits = { prix: b.prix, surface: b.surface, pieces: b.pieces, chambres: b.chambres, type: b.type, ville: b.ville, code_postal: b.code_postal, departement: b.departement };
  const etapes = [], alertes = [];
  const essayer = async (etape, requete, biens, minAccords, forte = false) => {
    const vus = new Set(), list = (biens || []).filter((x) => x && !vus.has(String(x.id)) && vus.add(String(x.id)));
    const res = { etape, requete, trouves: list.length, candidats: [] };
    etapes.push(res);
    for (const x of list) {
      const cmp = comparer(faits, x, opts.regles || REGLES);
      const v = verdict(cmp, minAccords, forte);
      res.candidats.push({ id: x.id, reference: x.reference, ok: v.ok, raison: v.raison, alerte: v.alerte });
    }
    const ok = res.candidats.filter((c) => c.ok);
    if (ok.length === 1) { const x = list.find((y) => y.id === ok[0].id); if (ok[0].alerte) alertes.push(ok[0].alerte + " différent entre le mail et le CRM"); return x; }
    if (ok.length > 1) res.ambigu = true;
    return null;
  };

  /* 1. identifiant CRM explicite */
  for (const id of [b.id_crm].filter(Boolean)) {
    const x = await crm.bienParId(id).catch(() => null);
    const hit = await essayer("identifiant_crm", id, x ? [x] : [], 0, true);
    if (hit) return { bien: hit, methode: "identifiant_crm", etapes, alertes, confiance: "haute" };
  }
  /* 2-4. références et variantes (référence de l'agence d'abord, puis celle du portail) */
  const refs = [b.reference, b.reference_portail].filter(Boolean);
  for (const ref of refs) {
    for (const v of variantes(ref)) {
      const biens = await crm.biensParReference(v.valeur).catch(() => []);
      const exacts = biens.filter((x) => String(x.reference).trim().toLowerCase() === v.valeur.toLowerCase());
      const hit = await essayer(v.etape, v.valeur, exacts, v.min, v.etape === "reference_complete");
      if (hit) return { bien: hit, methode: v.etape, etapes, alertes, confiance: v.min ? "moyenne" : "haute" };
    }
  }
  /* 5. recherche séquentielle par critères */
  if (crm.biensParCriteres && !opts.sansCriteres) {
    const dispo = CRITERES.filter((k) => (k === "lieu" ? faits.ville || faits.code_postal : faits[k]));
    if (dispo.length >= 2) {
      let retenus = [], dernier = null;
      for (const k of dispo) {
        const essai = retenus.concat([k]);
        const q = Object.fromEntries(essai.map((x) => (x === "lieu" ? ["lieu", faits.ville || faits.code_postal] : [x, faits[x]])));
        const r = await crm.biensParCriteres(q, { max: 2 }).catch(() => []);
        etapes.push({ etape: "criteres", requete: q, trouves: r.length });
        if (!r.length) continue;
        retenus = essai; dernier = r;
        if (r.length === 1) break;
      }
      if (dernier && dernier.length === 1 && retenus.length >= 2) {
        const hit = await essayer("criteres_verification", retenus.join("+"), dernier, 2);
        if (hit) return { bien: hit, methode: "criteres:" + retenus.join("+"), etapes, alertes, confiance: retenus.length >= 3 ? "moyenne" : "basse" };
      }
    }
  }
  const ambigu = etapes.some((e) => e.ambigu);
  const contredit = etapes.some((e) => (e.candidats || []).some((c) => /contradiction/.test(c.raison)));
  return { bien: null, methode: null, etapes, motif: ambigu ? "plusieurs biens possibles" : contredit ? "bien trouvé mais contredit par le mail" : refs.length ? "référence introuvable" : "pas de référence ni assez de critères" };
};

module.exports = { rapprocher, comparer, verdict, variantes, REGLES };
