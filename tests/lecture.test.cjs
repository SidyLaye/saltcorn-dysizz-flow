/* Bloc « Table : tenir à jour une table de lecture » contre un vrai PostgreSQL.
   Saltcorn est simulé (tables, champs) ; le SQL tourne pour de vrai.
   Base : variables PG* habituelles. Sans PostgreSQL joignable, le test est sauté (il tourne en CI). */
const assert = require("assert");
const Module = require("module");
const { Pool } = require("pg");

const SCHEMA = `dzf_test_${process.pid}`;
const pool = new Pool({ max: 3, connectionTimeoutMillis: 3000 });
let tenant = SCHEMA;
const fakeDb = {
  getTenantSchema: () => tenant,
  connectObj: { default_schema: "public" },
  getClient: () => pool.connect(),
  query: (sql, p) => pool.query(sql, p),
};
const champs = (noms) => ({ getFields: () => noms.map((name) => ({ name })) });
const TABLES = { vue: { name: "vue", ...champs(["id", "cle", "total", "dernier", "note"]) }, sans_unique: { name: "sans_unique", ...champs(["id", "cle", "total"]) } };
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === "@saltcorn/data/db") return fakeDb;
  if (req.startsWith("@saltcorn/")) return class {};
  return orig.call(this, req, ...rest);
};
const { BLOCKS } = require("../src/blocks");
const bloc = BLOCKS.find((b) => b.name === "dzf_table_lecture");
const api = { user: { role_id: 1 }, Table: { findOne: ({ name }) => TABLES[name] || null } };
const run = (p) => bloc.run({ table: "vue", cle: "cle", supprimer: true, delai_s: 10, ...p }, {}, api);
const REQ = "select c.id as cle, sum(v.n)::int as total, max(v.le) as dernier, 'x' as inconnue from client c join vente v on v.client = c.id group by c.id";

(async () => {
  try { await pool.query("select 1"); } catch (e) { console.log(`lecture.test : PostgreSQL injoignable, test sauté (${e.message})`); await pool.end(); return; }
  const q = (s, p) => pool.query(s, p);
  try {
    await q(`create schema "${SCHEMA}"`);
    await q(`create table "${SCHEMA}".client (id int primary key)`);
    await q(`create table "${SCHEMA}".vente (id serial primary key, client int, n int, le timestamptz)`);
    await q(`create table "${SCHEMA}".vue (id serial primary key, cle int unique, total int, dernier timestamptz, note text)`);
    await q(`create table "${SCHEMA}".sans_unique (id serial primary key, cle int, total int)`);
    await q(`insert into "${SCHEMA}".client values (1),(2),(3)`);
    await q(`insert into "${SCHEMA}".vente (client, n, le) values (1, 2, '2026-01-01'), (1, 3, '2026-02-01'), (2, 5, '2026-03-01')`);

    let r = await run({ requete: REQ });
    assert.deepStrictEqual([r.lignes, r.ecrites, r.retirees], [2, 2, 0], "premier calcul : deux lignes écrites");
    let v = (await q(`select cle, total, dernier from "${SCHEMA}".vue order by cle`)).rows;
    assert.deepStrictEqual(v.map((x) => [x.cle, x.total]), [[1, 5], [2, 5]]);
    assert.strictEqual(new Date(v[0].dernier).toISOString(), new Date("2026-02-01").toISOString(), "dates conservées");

    r = await run({ requete: REQ });
    assert.strictEqual(r.ecrites, 0, "rien n'a changé : rien n'est réécrit");

    await q(`insert into "${SCHEMA}".vente (client, n, le) values (3, 1, now())`);
    await q(`delete from "${SCHEMA}".vente where client = 2`);
    await q(`update "${SCHEMA}".vente set n = 10 where client = 1 and n = 2`);
    r = await run({ requete: REQ });
    assert.deepStrictEqual([r.ecrites, r.retirees], [2, 1], "une ligne modifiée, une ajoutée, une retirée");
    v = (await q(`select cle, total from "${SCHEMA}".vue order by cle`)).rows;
    assert.deepStrictEqual(v.map((x) => [x.cle, x.total]), [[1, 13], [3, 1]]);

    await q(`update "${SCHEMA}".vente set n = 20 where client = 3`);
    await q(`update "${SCHEMA}".vente set n = 0 where client = 1`);
    r = await run({ requete: REQ, cles: "3" });
    assert.deepStrictEqual([r.lignes, r.ecrites, r.retirees], [1, 1, 0], "seulement la clé demandée, sans rien retirer");
    v = (await q(`select cle, total from "${SCHEMA}".vue order by cle`)).rows;
    assert.deepStrictEqual(v.map((x) => [x.cle, x.total]), [[1, 13], [3, 20]], "les autres clés ne bougent pas");

    /* requête qui se limite elle-même avec $1 (gros volumes) */
    const REQ1 = "select c.id as cle, sum(v.n)::int as total, max(v.le) as dernier from client c join vente v on v.client = c.id where ($1::text[] is null or c.id::text = any($1)) group by c.id";
    await q(`update "${SCHEMA}".vente set n = 7 where client = 1`);
    await q(`update "${SCHEMA}".vente set n = 30 where client = 3`);
    r = await run({ requete: REQ1, cles: ["3"] });
    assert.deepStrictEqual([r.lignes, r.ecrites, r.retirees], [1, 1, 0], "$1 : seules les clés demandées sont relues");
    v = (await q(`select cle, total from "${SCHEMA}".vue order by cle`)).rows;
    assert.deepStrictEqual(v.map((x) => [x.cle, x.total]), [[1, 13], [3, 30]], "$1 : les autres lignes ne bougent pas");
    r = await run({ requete: REQ1 });
    assert.deepStrictEqual([r.lignes, r.ecrites], [2, 1], "$1 à null : tout est recalculé");
    r = await run({ requete: "-- commentaire : total par client\n/* bloc */ " + REQ1 });
    assert.strictEqual(r.lignes, 2, "commentaires SQL acceptés");
    await assert.rejects(() => run({ requete: "-- x\n delete from vue" }), /SELECT/, "un commentaire ne cache pas une écriture");
    r = await bloc.run({ table: "vue", cle: "cle", requete: REQ1, cles: [] }, {}, api);
    assert.strictEqual(r.rien, true, "liste vide : rien à faire");

    await assert.rejects(() => run({ requete: "delete from vue" }), /SELECT/, "une requête qui écrit est refusée");
    await assert.rejects(() => run({ requete: "select 1 as cle; drop table vue" }), /SELECT/);
    await assert.rejects(() => run({ requete: "select nextval('vente_id_seq')::int as cle" }), /read-only|lecture seule/i, "la requête tourne en lecture seule");
    await assert.rejects(() => run({ requete: "select 1 as autre" }), /colonne « cle »/);
    await assert.rejects(() => run({ table: "absente", requete: REQ }), /introuvable/);
    await assert.rejects(() => bloc.run({ table: "sans_unique", cle: "cle", requete: REQ }, {}, api), /doit être unique/);
    await assert.rejects(() => bloc.run({ table: "vue", cle: "cle", requete: REQ }, {}, { ...api, user: { role_id: 40 } }), /administrateurs/);

    /* autre tenant : pas de lecture hors de son schéma */
    tenant = "client_b";
    await assert.rejects(() => run({ requete: `select id as cle from "${SCHEMA}".client` }), /son tenant|tenant racine/);
    tenant = SCHEMA;
    console.log("table de lecture OK : calcul, écritures minimales, retraits, clés ciblées, requête limitée par $1, lecture seule, refus");
  } finally {
    await q(`drop schema if exists "${SCHEMA}" cascade`).catch(() => {});
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
