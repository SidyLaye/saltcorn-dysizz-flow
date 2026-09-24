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
  const base = { name: p.name, label: p.label || p.name, sublabel: p.help || "", required: !!p.required, default: p.default, ...(p.showIf ? { showIf: p.showIf } : {}) };
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
  { name: "essais", label: "Essais en cas d'échec", sublabel: "1 = pas de nouvel essai. Attente doublée à chaque fois", type: "Integer", default: b.retries || 1 },
  { name: "pause_essais", label: "Première attente entre deux essais (secondes)", type: "Integer", default: 2 },
];

/* ---------- valeurs des réglages ---------- */
const resolveParams = (b, cfg, ctx) => {
  const p = {};
  for (const d of b.params || []) {
    let v = cfg[d.name];
    if (v === undefined || v === "") v = d.default;
    /* raw : le bloc fait lui-même les {{ }} (ex. un modèle appliqué à chaque élément) */
    if (d.type === "json" && typeof v === "string") {
      /* JSON : on lit d'abord le JSON, puis on remplace les {{ }} valeur par valeur
         (ainsi {"projet":"{{projet}}"} donne null si projet est vide, pas "") */
      if (WHOLE.test(v)) { if (!d.raw) v = interpolate(v, ctx); }
      else { v = parseJSON(v, d.label || d.name); if (!d.raw) v = deep(v, ctx); }
    } else if (!d.raw) v = interpolate(v, ctx);
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
  /* secret : variable d'environnement d'abord, sinon le coffre chiffré (table dzf_secrets) */
  secret: async (name) => {
    if (!name) return undefined;
    if (process.env[name]) return process.env[name];
    return require("./vault").readSecret(name);
  },
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

/* ---------- métriques : comptées en mémoire, écrites une fois par heure et par tenant ---------- */
const METRICS = new Map(); /* tenant → { heure, blocs: Map(bloc → {n, erreurs, total_ms, max_ms}) } */
const tenantKey = () => { try { return require("@saltcorn/data/db").getTenantSchema(); } catch (e) { return "public"; } };
const hourOf = (d = new Date()) => { const x = new Date(d); x.setMinutes(0, 0, 0); return x; };
const record = async (name, ms, ok) => {
  const k = tenantKey();
  const h = +hourOf();
  let m = METRICS.get(k);
  if (m && m.heure !== h) { const old = m; m = null; METRICS.delete(k); flush(old).catch(() => {}); }
  if (!m) { m = { heure: h, blocs: new Map() }; METRICS.set(k, m); }
  const x = m.blocs.get(name) || { n: 0, erreurs: 0, total_ms: 0, max_ms: 0 };
  x.n++; if (!ok) x.erreurs++; x.total_ms += ms; x.max_ms = Math.max(x.max_ms, ms);
  m.blocs.set(name, x);
};
const flush = async (m) => {
  const { ensureTables } = require("./store");
  const T = await ensureTables();
  for (const [bloc, x] of m.blocs) {
    const heure = new Date(m.heure);
    const ex = await T.metriques.getRow({ heure, bloc });
    const row = { heure, bloc, n: x.n, erreurs: x.erreurs, ms_moyen: Math.round(x.total_ms / x.n), ms_max: x.max_ms };
    if (ex) await T.metriques.updateRow({ n: ex.n + x.n, erreurs: ex.erreurs + x.erreurs, ms_moyen: Math.round((ex.ms_moyen * ex.n + x.total_ms) / (ex.n + x.n)), ms_max: Math.max(ex.ms_max, x.max_ms) }, ex.id);
    else await T.metriques.insertRow(row);
  }
};
const liveMetrics = () => { const m = METRICS.get(tenantKey()); return m ? [...m.blocs.entries()].map(([bloc, x]) => ({ bloc, ...x })) : []; };

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
    const tries = Math.max(1, Math.min(10, +configuration.essais || b.retries || 1));
    let lastErr;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        const p = resolveParams(b, configuration, ctx);
        const res = await withTimeout(Promise.resolve(b.run(p, ctx, makeApi({ user, req, table, mode, out }))), +configuration.delai_max || b.timeout || 30, b.label);
        await record(b.name, Date.now() - t0, true);
        if (b.log || configuration.journaliser) await journal({ bloc: b.name, ok: true, duree_ms: Date.now() - t0, message: summarize(res) });
        /* résultats spéciaux de Saltcorn (notify, error, goto…) : transmis tels quels */
        if (res && res.__saltcorn) { const { __saltcorn, ...rest } = res; return rest; }
        /* « fusionner dans le contexte » : les clés vont directement dans le contexte */
        if (res && res.__merge) return res.__merge;
        return { [out]: res };
      } catch (e) {
        lastErr = e;
        /* une erreur de réglage ne sert à rien de la réessayer */
        if (e.permanent || /réglage|JSON invalide|introuvable|refus/i.test(e.message)) break;
        if (attempt < tries) await new Promise((r) => setTimeout(r, Math.min(60, (+configuration.pause_essais || 2) * 2 ** (attempt - 1)) * 1000));
      }
    }
    await record(b.name, Date.now() - t0, false);
    await journal({ bloc: b.name, ok: false, duree_ms: Date.now() - t0, message: lastErr.message });
    if (configuration.si_erreur === "continuer") return { [out]: null, [`${out}_erreur`]: lastErr.message };
    throw new Error(`[${b.label}] ${lastErr.message}`);
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

/* jamais de mot de passe, jeton ou empreinte de compte dans le contexte d'un workflow */
const SENSIBLE = /^(password|reset_password_token|reset_password_expiry|api_token|verification_token|_attributes)$/;
const sanitize = (v) => (Array.isArray(v) ? v.map(sanitize) : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).filter(([k]) => !SENSIBLE.test(k))) : v);

module.exports = { sanitize, liveMetrics, flush, METRICS, interpolate, deep, getPath, parseJSON, toAction, toField, resolveParams, COMMON, pool, asList, withTimeout, makeApi, journal };
