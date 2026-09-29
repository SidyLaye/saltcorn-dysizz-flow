/* Lecture des mails par IA + gabarits appris (moteur : dysizz-flow lib/leads/lecture, ia, apprentissage).
   Ici : le stockage des gabarits (ld_gabarits), la bibliothèque commune entre clients (facultative),
   le plafond d'appels à l'IA (ld_ia) et l'import des gabarits de l'ancien AMBS (gabarit_version.json). */
"use strict";
const { tables, nom } = require("./schema");
const { reglages } = require("./conf");

const db = () => require("@saltcorn/data/db");
const tenant = () => { try { return db().getTenantSchema(); } catch (e) { return "public"; } };
const json = (s, d) => { if (s && typeof s === "object") return s; try { return JSON.parse(s); } catch (e) { return d; } };
const C = globalThis[Symbol.for("dysizz-flow.leads.gabarits")] || (globalThis[Symbol.for("dysizz-flow.leads.gabarits")] = new Map());
const cleCache = () => tenant() + ":" + require("./schema").prefixe();
const oublier = () => C.delete(cleCache());

const versGabarit = (r) => ({ ...r, signature: json(r.signature, {}), champs: json(r.champs, []) });
const versLigne = (g) => {
  const o = {};
  for (const k of ["source", "nature", "statut", "nb_observations", "nb_echecs", "nb_utilisations", "origine", "cree_le", "vu_le", "active_le", "suspendu_le"]) if (g[k] !== undefined) o[k] = g[k];
  if (g.signature !== undefined) o.signature = JSON.stringify(g.signature);
  if (g.champs !== undefined) o.champs = JSON.stringify(g.champs);
  for (const k of ["cree_le", "vu_le", "active_le", "suspendu_le"]) if (o[k]) o[k] = new Date(o[k]);
  return o;
};

/* ——— Bibliothèque commune (schéma public) : formes de mails de PORTAILS, jamais de donnée de prospect ——— */
const COMMUNS = `"public".dzl_gabarits_communs`;
const communsPrets = new Set();
const preparerCommuns = async () => {
  if (db().isSQLite || communsPrets.has("x")) return !db().isSQLite;
  await db().query(`create table if not exists ${COMMUNS} (cle text primary key, source text, nature text, signature text, champs text, clients text, maj_le timestamptz default now())`);
  communsPrets.add("x");
  return true;
};
const lireCommuns = async () => {
  if (!(await preparerCommuns().catch(() => false))) return [];
  return (await db().query(`select * from ${COMMUNS} order by maj_le desc limit 2000`)).rows.map((r) => ({ id: "c:" + r.cle, source: r.source, nature: r.nature, signature: json(r.signature, {}), champs: json(r.champs, []), statut: "actif", nb_observations: 0, origine: "commun" }));
};
const publier = async (api, g, R) => {
  if (!R.gabarits_partages || !(await preparerCommuns().catch(() => false))) return;
  const A = api.leads.apprentissage;
  const dom = String((g.signature || {}).expediteur || "").replace(/\\/g, "").replace(/\$$/, "");
  if (!dom || String(R.domaines_agence || "").toLowerCase().split(/[\s,;]+/).some((d) => d && dom.endsWith(d))) return;   // pas les mails de l'agence elle-même
  if ((g.champs || []).some((c) => A.motifSur(c.motif))) return;
  const cle = require("crypto").createHash("sha1").update(A.cleForme(g) + JSON.stringify(g.champs)).digest("hex");
  await db().query(`insert into ${COMMUNS} (cle, source, nature, signature, champs, clients) values ($1,$2,$3,$4,$5,$6)
    on conflict (cle) do update set maj_le = now(), clients = case when position($6 in coalesce(${COMMUNS}.clients,'')) > 0 then ${COMMUNS}.clients else coalesce(${COMMUNS}.clients,'') || ',' || $6 end`,
  [cle, g.source, g.nature, JSON.stringify(g.signature), JSON.stringify(g.champs), tenant()]);
};

/* ——— Stockage pour le moteur : { lister, creer, maj } ——— */
const stockage = (api, R) => {
  const A = api.leads.apprentissage;
  const lister = async () => {
    const k = cleCache(), c = C.get(k);
    if (c && Date.now() - c.t < 60000) return c.l;
    const t = await tables();
    const locaux = (await t.gabarits.getRows({})).map(versGabarit);
    let communs = R.gabarits_partages ? await lireCommuns().catch(() => []) : [];
    const vus = new Set(locaux.map((g) => A.cleForme(g) + JSON.stringify(g.champs)));
    communs = communs.filter((g) => !vus.has(A.cleForme(g) + JSON.stringify(g.champs)));
    const l = [...locaux, ...communs];
    C.set(k, { t: Date.now(), l });
    return l;
  };
  const creer = async (g) => { const t = await tables(); const id = await t.gabarits.insertRow(versLigne(g)); oublier(); return { ...g, id }; };
  const maj = async (id, champs) => {
    const t = await tables();
    if (String(id).startsWith("c:")) {
      /* gabarit commun : on garde une copie locale qui porte l'état propre à ce client (échecs, suspension) */
      const g = (await lister()).find((x) => x.id === id);
      if (g) await t.gabarits.insertRow(versLigne({ ...g, ...champs, origine: "commun", cree_le: new Date() }));
    } else {
      await t.gabarits.updateRow(versLigne(champs), +id);
      if (champs.statut === "actif") { const r = await t.gabarits.getRow({ id: +id }); if (r) await publier(api, versGabarit(r), R).catch(() => {}); }
    }
    oublier();
  };
  return { lister, creer, maj };
};

/* ——— Plafond d'appels et journal ——— */
const debutJour = () => { const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" })); const p = new Date(); p.setTime(p.getTime() - (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * 1000); return p; };
const appelsDuJour = async () => +(await db().query(`select count(*) n from "${tenant()}".${nom("ia")} where quand >= $1`, [debutJour()])).rows[0].n;
const noter = async (a) => { const t = await tables(); await t.ia.insertRow({ quand: new Date(), ok: !!a.ok, ms: a.ms || null, nature: a.nature || null, source: a.source ? String(a.source).slice(0, 120) : null, erreur: a.erreur ? String(a.erreur).slice(0, 300) : null }); };

/* Options de lecture passées au moteur pour chaque mail. */
const optionsLecture = async (api) => {
  await tables();
  const R = await reglages();
  const A = api.leads.apprentissage;
  if (!A) return {};
  const o = { gabarits: stockage(api, R) };
  if (R.ia_actif && api.iaDepuisCoffre) {
    o.ia = api.iaDepuisCoffre(R.ia_fournisseur || "saltcorn", R.ia_modele || "", "LEADS_IA_CLE", R.ia_url || undefined);
    const plafond = +R.ia_plafond_jour || 200;
    o.budget = async () => (await appelsDuJour()) < plafond;
    o.noter = noter;
  }
  return o;
};

/* Import de l'ancienne table gabarit_version (sauvegarde AMBS) : seuls les gabarits actifs. */
const importerAmbs = async (api, lignes) => {
  const t = await tables();
  const deja = new Set((await t.gabarits.getRows({})).map((g) => g.origine));
  let n = 0;
  for (const g of api.leads.apprentissage.depuisAmbs(lignes)) {
    if (deja.has(g.origine)) continue;
    await t.gabarits.insertRow(versLigne({ ...g, cree_le: new Date(), active_le: new Date() }));
    n++;
  }
  oublier();
  return n;
};

module.exports = { optionsLecture, stockage, importerAmbs, appelsDuJour, noter, oublier, versGabarit, lireCommuns };
