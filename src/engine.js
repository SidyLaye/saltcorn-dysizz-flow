/* dysizz-flow — le moteur commun à tous les blocs.

   Un bloc est un objet :
     { name, label, category, icon, description,
       params: [{ name, label, type, default, help, options, required }],
       output: "nom de variable par défaut",
       run: async (p, ctx, api) => résultat }

   Le moteur en fait une « action » Saltcorn, utilisable :
     - comme étape dans l'éditeur de workflows (le résultat est rangé dans le
       contexte sous le nom choisi, les étapes suivantes le lisent) ;
     - comme déclencheur simple (sur une table, planifié, appel d'API) ;
     - comme bouton dans une vue.

   Chaque réglage texte accepte des {{variables}} du contexte :
     "Bonjour {{user.email}}", "{{articles}}" (valeur brute si c'est tout le champ). */
"use strict";

/* ---------- variables {{ }} ---------- */
const getPath = (obj, path) => {
  if (!path) return undefined;
  let cur = obj;
  for (const k of String(path).trim().split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[/^\d+$/.test(k) ? +k : k];
  }
  return cur;
};
const WHOLE = /^\s*\{\{\s*([\w.$-]+)\s*\}\}\s*$/;
const ANY = /\{\{\s*([\w.$-]+)\s*\}\}/g;
const interpolate = (v, ctx) => {
  if (typeof v !== "string" || !v.includes("{{")) return v;
  const m = WHOLE.exec(v);
  if (m) return getPath(ctx, m[1]);
  return v.replace(ANY, (_, p) => {
    const x = getPath(ctx, p);
    return x === undefined || x === null ? "" : typeof x === "object" ? JSON.stringify(x) : String(x);
  });
};
/* un objet JSON écrit dans un réglage : on remplace les {{ }} dans chaque valeur */
const deep = (v, ctx) => {
  if (typeof v === "string") return interpolate(v, ctx);
  if (Array.isArray(v)) return v.map((x) => deep(x, ctx));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, ctx)]));
  return v;
};
const parseJSON = (s, what) => {
  if (s === undefined || s === null || s === "") return undefined;
  if (typeof s === "object") return s;
  try { return JSON.parse(s); } catch (e) { throw new Error(`${what} : JSON invalide (${e.message})`); }
};

/* ---------- réglages → champs du formulaire Saltcorn ---------- */
const tableNames = async () => {
  const Table = require("@saltcorn/data/models/table");
  return (await Table.find({})).map((t) => t.name).filter((n) => n !== "users").sort();
};
const toField = async (p) => {
  const base = { name: p.name, label: p.label || p.name, sublabel: p.help || "", required: !!p.required, default: p.default };
  switch (p.type) {
    case "int": return { ...base, type: "Integer" };
    case "number": return { ...base, type: "Float" };
    case "bool": return { ...base, type: "Bool" };
    case "select": return { ...base, type: "String", attributes: { options: p.options } };
    case "table": return { ...base, type: "String", attributes: { options: await tableNames() } };
    case "json": return { ...base, type: "String", fieldview: "code_editor", attributes: { mode: "application/json" } };
    case "code": return { ...base, type: "String", fieldview: "code_editor", attributes: { mode: "application/javascript" } };
    case "text": return { ...base, type: "String", fieldview: "textarea" };
    case "password": return { ...base, type: "String", fieldview: "password" };
    default: return { ...base, type: "String" };
  }
};
const COMMON = (b) => [
  { name: "sortie", label: "Ranger le résultat dans", sublabel: "Nom de la variable du contexte que les étapes suivantes liront", type: "String", default: b.output || "resultat" },
  { name: "si_erreur", label: "En cas d'erreur", type: "String", attributes: { options: ["arrêter", "continuer"] }, default: "arrêter", sublabel: "« continuer » range le message dans <sortie>_erreur et passe à la suite" },
  { name: "delai_max", label: "Délai max (secondes)", type: "Integer", default: b.timeout || 30 },
];

/* ---------- valeurs des réglages ---------- */
const resolveParams = (b, cfg, ctx) => {
  const p = {};
  for (const d of b.params || []) {
    let v = cfg[d.name];
    if (v === undefined || v === "") v = d.default;
    /* raw : le bloc fait lui-même les {{ }} (ex. un modèle appliqué à chaque élément) */
    if (!d.raw) v = interpolate(v, ctx);
    if (d.type === "json" && typeof v === "string") { v = parseJSON(v, d.label || d.name); if (!d.raw) v = deep(v, ctx); }
    if ((d.type === "int" || d.type === "number") && typeof v === "string" && v !== "") v = Number(v);
    if (d.type === "bool" && typeof v === "string") v = v === "true" || v === "on";
    if (d.required && (v === undefined || v === null || v === "")) throw new Error(`réglage « ${d.label || d.name} » manquant`);
    p[d.name] = v;
  }
  return p;
};

const withTimeout = (promise, s, label) => {
  if (!s) return promise;
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} : délai de ${s} s dépassé`)), s * 1000); })]).finally(() => clearTimeout(t));
};

/* ---------- ce que chaque bloc reçoit en plus (api) ---------- */
const makeApi = ({ user, req, out }) => ({
  out,
  Table: require("@saltcorn/data/models/table"),
  user, req,
  env: (name) => (name ? process.env[name] : undefined),
  log: (...a) => { try { require("@saltcorn/data/db/state").getState().log(5, `[dysizz-flow] ${a.join(" ")}`); } catch (e) { /* rien */ } },
});

/* ---------- journal : seulement les erreurs, ou tout si demandé ---------- */
const journal = async (row) => {
  try {
    const { ensureTables } = require("./store");
    const T = await ensureTables();
    await T.journal.insertRow({ quand: new Date(), ...row, message: String(row.message || "").slice(0, 1000) });
  } catch (e) { /* le journal ne doit jamais casser un workflow */ }
};

/* ---------- bloc → action Saltcorn ---------- */
const toAction = (b) => ({
  description: `${b.label} — ${b.description}`,
  disableInBuilder: !!b.noButton,
  requireRow: false,
  configFields: async () => [...(await Promise.all((b.params || []).map(toField))), ...COMMON(b)],
  run: async ({ configuration = {}, row, user, req, table, mode }) => {
    const ctx = { ...(row || {}), user: row && row.user ? row.user : user ? { id: user.id, email: user.email, role_id: user.role_id } : undefined };
    const out = configuration.sortie || b.output || "resultat";
    const t0 = Date.now();
    try {
      const p = resolveParams(b, configuration, ctx);
      const res = await withTimeout(Promise.resolve(b.run(p, ctx, makeApi({ user, req, table, mode, out }))), +configuration.delai_max || b.timeout || 30, b.label);
      if (b.log || configuration.journaliser) await journal({ bloc: b.name, ok: true, duree_ms: Date.now() - t0, message: summarize(res) });
      /* résultats spéciaux de Saltcorn (notify, error, goto…) : transmis tels quels */
      if (res && res.__saltcorn) { const { __saltcorn, ...rest } = res; return rest; }
      /* « fusionner dans le contexte » : les clés vont directement dans le contexte */
      if (res && res.__merge) return res.__merge;
      return { [out]: res };
    } catch (e) {
      await journal({ bloc: b.name, ok: false, duree_ms: Date.now() - t0, message: e.message });
      if (configuration.si_erreur === "continuer") return { [out]: null, [`${out}_erreur`]: e.message };
      throw new Error(`[${b.label}] ${e.message}`);
    }
  },
});

const summarize = (res) => {
  if (Array.isArray(res)) return `${res.length} élément(s)`;
  if (res && typeof res === "object") return JSON.stringify(res).slice(0, 300);
  return String(res ?? "");
};

/* petit utilitaire de parallélisme borné, partagé par les blocs */
const pool = async (items, n, fn) => {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n || 4, items.length)) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); }
  }));
  return res;
};
const asList = (v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : typeof v === "string" && v.trim().startsWith("[") ? parseJSON(v, "liste") : [v]);

module.exports = { interpolate, deep, getPath, parseJSON, toAction, toField, resolveParams, COMMON, pool, asList, withTimeout, makeApi, journal };
