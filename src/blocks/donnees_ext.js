/* Données externes : autre base PostgreSQL, moteurs de recherche et bases
   vectorielles (Elasticsearch/OpenSearch, Meilisearch, Qdrant), analytique
   (ClickHouse, InfluxDB), et outils no-code (Supabase, Airtable, Notion,
   Google Sheets, Baserow/NocoDB). */
"use strict";
const crypto = require("crypto");
const { asList } = require("../engine");

const perm = (m) => Object.assign(new Error(m), { permanent: true });
const need = async (api, name) => { const v = await api.secret(name); if (!v) throw perm(`secret ${name} introuvable (variable d'environnement ou coffre)`); return v; };
const J = (v, d) => { if (v === undefined || v === null || v === "") return d; if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { throw perm("JSON invalide"); } } return v; };
const call = async (url, { method = "GET", headers = {}, body, name, raw }) => {
  const r = await fetch(url, { method, headers: { ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
  if (!r.ok) throw Object.assign(new Error(`${name} : HTTP ${r.status} ${typeof j === "object" && j ? JSON.stringify(j.error || j.message || j).slice(0, 250) : String(t).slice(0, 250)}`), { permanent: [400, 401, 403, 404, 422].includes(r.status) });
  return j;
};

/* pools PostgreSQL gardés par secret (la connexion coûte cher) */
const POOLS = new Map();
const pgPool = async (api, secret) => {
  const url = await need(api, secret);
  const k = crypto.createHash("sha256").update(url).digest("hex");
  if (!POOLS.has(k)) {
    let pg; try { pg = require.main.require("pg"); } catch (e) { pg = require("pg"); }
    POOLS.set(k, new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30000, statement_timeout: 60000 }));
  }
  return POOLS.get(k);
};

/* Google : jeton d'accès à partir du JSON d'un compte de service (signature RS256) */
const TOKENS = new Map();
const googleToken = async (api, secret, scope) => {
  const sa = J(await need(api, secret));
  const k = sa.client_email + scope, c = TOKENS.get(k);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const jwt = `${unsigned}.${crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url")}`;
  const j = await call("https://oauth2.googleapis.com/token", { method: "POST", raw: true, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`, name: "Google" });
  TOKENS.set(k, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
};

module.exports = [
  {
    name: "dzf_postgres_externe", label: "Base PostgreSQL externe", category: "Données externes", icon: "fas fa-database", output: "pg", timeout: 120,
    description: "Interroge une autre base PostgreSQL (ERP, site, entrepôt…) avec une requête paramétrée ($1, $2…). En lecture seule par défaut. L'adresse de connexion reste dans le coffre.",
    params: [{ name: "connexion", label: "Secret de connexion", required: true, default: "PG_EXTERNE", help: "Secret « postgres://utilisateur:mdp@hote:5432/base »" },
      { name: "requete", label: "Requête SQL", type: "code", required: true, default: "select id, nom from clients where ville = $1 limit 100" }, { name: "valeurs", label: "Valeurs de $1, $2…", type: "json", default: "[]", help: 'Ex. ["{{ville}}"]' },
      { name: "ecriture", label: "Autoriser l'écriture (insert, update, delete)", type: "bool", default: false }],
    run: async (p, ctx, api) => {
      const pool = await pgPool(api, p.connexion);
      const client = await pool.connect();
      try {
        if (!p.ecriture) await client.query("begin read only");
        const r = await client.query(String(p.requete), J(p.valeurs, []));
        if (!p.ecriture) await client.query("commit");
        return r.command === "SELECT" ? r.rows : { commande: r.command, lignes: r.rowCount, resultat: r.rows };
      } catch (e) { if (!p.ecriture) await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },
  },
  {
    name: "dzf_recherche_moteur", label: "Moteur de recherche (Meilisearch, Elasticsearch)", category: "Données externes", icon: "fas fa-search-plus", output: "recherche", timeout: 60,
    description: "Indexe des documents et fais une recherche instantanée tolérante aux fautes : Meilisearch, Typesense-like, ou Elasticsearch / OpenSearch.",
    params: [{ name: "moteur", label: "Moteur", type: "select", options: ["Meilisearch", "Elasticsearch / OpenSearch"], default: "Meilisearch" }, { name: "adresse", label: "Adresse", default: "http://meilisearch:7700" }, { name: "cle", label: "Secret de la clé", default: "MEILI_KEY", help: "Elasticsearch : « ApiKey … » ou « utilisateur:mdp »" },
      { name: "index", label: "Index", required: true }, { name: "action", label: "Action", type: "select", options: ["chercher", "indexer des documents", "supprimer un document"], default: "chercher" },
      { name: "texte", label: "Recherche", showIf: { action: "chercher" } }, { name: "filtre", label: "Filtre", showIf: { action: "chercher" }, help: "Meili : ville = Paris · ES : requête JSON complète" }, { name: "n", label: "Résultats", type: "int", default: 20, showIf: { action: "chercher" } },
      { name: "documents", label: "Documents", type: "json", showIf: { action: "indexer des documents" }, help: "Liste d'objets avec un champ id" }, { name: "id", label: "Id", showIf: { action: "supprimer un document" } }],
    run: async (p, ctx, api) => {
      const B = String(p.adresse).replace(/\/$/, ""), k = await api.secret(p.cle), ix = encodeURIComponent(p.index);
      if (p.moteur === "Meilisearch") {
        const h = k ? { Authorization: `Bearer ${k}` } : {};
        const g = (u, o = {}) => call(B + u, { ...o, headers: h, name: "Meilisearch" });
        if (p.action === "chercher") { const j = await g(`/indexes/${ix}/search`, { method: "POST", body: { q: p.texte || "", limit: +p.n || 20, ...(p.filtre ? { filter: p.filtre } : {}) } }); return { total: j.estimatedTotalHits, ms: j.processingTimeMs, resultats: j.hits }; }
        if (p.action === "indexer des documents") { const j = await g(`/indexes/${ix}/documents`, { method: "POST", body: asList(J(p.documents, [])) }); return { tache: j.taskUid, etat: j.status }; }
        return g(`/indexes/${ix}/documents/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      }
      const h = k ? { Authorization: /^ApiKey |^Basic |^Bearer /.test(k) ? k : `Basic ${Buffer.from(k).toString("base64")}` } : {};
      const g = (u, o = {}) => call(B + u, { ...o, headers: h, name: "Elasticsearch" });
      if (p.action === "chercher") { const q = p.filtre ? J(p.filtre) : { query: { multi_match: { query: p.texte || "", fuzziness: "AUTO" } }, size: +p.n || 20 }; const j = await g(`/${ix}/_search`, { method: "POST", body: q }); return { total: j.hits.total.value ?? j.hits.total, resultats: j.hits.hits.map((x) => ({ id: x._id, score: x._score, ...x._source })) }; }
      if (p.action === "indexer des documents") { const nd = asList(J(p.documents, [])).map((d) => `${JSON.stringify({ index: { _index: p.index, ...(d.id !== undefined ? { _id: String(d.id) } : {}) } })}\n${JSON.stringify(d)}\n`).join(""); const j = await g("/_bulk", { method: "POST", raw: true, headers: { "Content-Type": "application/x-ndjson" }, body: nd }); return { erreurs: j.errors, n: j.items.length }; }
      return g(`/${ix}/_doc/${encodeURIComponent(p.id)}`, { method: "DELETE" });
    },
  },
  {
    name: "dzf_qdrant", label: "Base vectorielle Qdrant", category: "Données externes", icon: "fas fa-project-diagram", output: "qdrant", timeout: 60,
    description: "Range des vecteurs (avec leurs infos) et retrouve les plus proches par le sens, à grande échelle. Complète « IA : vecteur » pour une recherche intelligente sur des millions d'éléments.",
    params: [{ name: "adresse", label: "Adresse", default: "http://qdrant:6333" }, { name: "cle", label: "Secret de la clé (si besoin)", default: "QDRANT_KEY" }, { name: "collection", label: "Collection", required: true },
      { name: "action", label: "Action", type: "select", options: ["chercher", "ranger des points", "créer la collection", "supprimer des points"], default: "chercher" },
      { name: "vecteur", label: "Vecteur cherché", showIf: { action: "chercher" } }, { name: "n", label: "Résultats", type: "int", default: 5, showIf: { action: "chercher" } }, { name: "filtre", label: "Filtre (JSON Qdrant)", type: "json", showIf: { action: "chercher" } },
      { name: "points", label: "Points", type: "json", showIf: { action: "ranger des points" }, help: 'Liste {id, vecteur, …infos}. Ex. {{morceaux}}' }, { name: "champ_vecteur", label: "Champ du vecteur", default: "vecteur", showIf: { action: "ranger des points" } },
      { name: "dimension", label: "Dimension", type: "int", default: 768, showIf: { action: "créer la collection" } }, { name: "ids", label: "Ids", type: "json", showIf: { action: "supprimer des points" } }],
    run: async (p, ctx, api) => {
      const k = await api.secret(p.cle), B = `${String(p.adresse).replace(/\/$/, "")}/collections/${encodeURIComponent(p.collection)}`;
      const g = (u, o = {}) => call(B + u, { ...o, headers: k ? { "api-key": k } : {}, name: "Qdrant" });
      if (p.action === "créer la collection") return (await g("", { method: "PUT", body: { vectors: { size: +p.dimension || 768, distance: "Cosine" } } })).result;
      if (p.action === "supprimer des points") return (await g("/points/delete?wait=true", { method: "POST", body: { points: asList(J(p.ids, [])) } })).result;
      if (p.action === "ranger des points") {
        const pts = asList(J(p.points, [])).map((x, i) => { const { [p.champ_vecteur || "vecteur"]: v, id, ...payload } = x; const vec = typeof v === "string" ? JSON.parse(v) : v; const pid = Number.isInteger(+id) && id !== "" && id !== undefined ? +id : crypto.createHash("md5").update(String(id ?? i)).digest("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"); return { id: pid, vector: vec, payload: { ...payload, id_origine: id } }; });
        for (let i = 0; i < pts.length; i += 256) await g("/points?wait=true", { method: "PUT", body: { points: pts.slice(i, i + 256) } });
        return { ranges: pts.length };
      }
      const v = typeof p.vecteur === "string" ? JSON.parse(p.vecteur) : p.vecteur;
      return (await g("/points/search", { method: "POST", body: { vector: v, limit: +p.n || 5, with_payload: true, ...(p.filtre ? { filter: p.filtre } : {}) } })).result.map((x) => ({ score: x.score, ...x.payload }));
    },
  },
  {
    name: "dzf_clickhouse", label: "ClickHouse", category: "Données externes", icon: "fas fa-bolt", output: "clickhouse", timeout: 120,
    description: "Requêtes analytiques ultra-rapides sur des milliards de lignes (journaux, événements, métriques), et insertion en masse.",
    params: [{ name: "adresse", label: "Adresse HTTP", default: "http://clickhouse:8123" }, { name: "identifiants", label: "Secret « utilisateur:mdp »", default: "CLICKHOUSE" }, { name: "base", label: "Base", default: "default" },
      { name: "action", label: "Action", type: "select", options: ["requête", "insérer des lignes"], default: "requête" }, { name: "requete", label: "Requête", type: "code", showIf: { action: "requête" }, default: "select count() from system.tables" },
      { name: "table", label: "Table", showIf: { action: "insérer des lignes" } }, { name: "lignes", label: "Lignes", type: "json", showIf: { action: "insérer des lignes" } }],
    run: async (p, ctx, api) => {
      const id = await api.secret(p.identifiants);
      const h = id ? { Authorization: `Basic ${Buffer.from(id).toString("base64")}` } : {};
      const B = `${String(p.adresse).replace(/\/$/, "")}/?database=${encodeURIComponent(p.base || "default")}`;
      if (p.action === "insérer des lignes") {
        if (!/^[\w.]+$/.test(p.table || "")) throw perm("nom de table invalide");
        const rows = asList(J(p.lignes, []));
        await call(`${B}&query=${encodeURIComponent(`INSERT INTO ${p.table} FORMAT JSONEachRow`)}`, { method: "POST", raw: true, headers: h, body: rows.map((r) => JSON.stringify(r)).join("\n"), name: "ClickHouse" });
        return { inseres: rows.length };
      }
      const j = await call(`${B}&default_format=JSON`, { method: "POST", raw: true, headers: h, body: String(p.requete), name: "ClickHouse" });
      return j && j.data ? j.data : j;
    },
  },
  {
    name: "dzf_influxdb", label: "InfluxDB (séries temporelles)", category: "Données externes", icon: "fas fa-chart-area", output: "influx", timeout: 60,
    description: "Écrit des mesures (température, consommation, capteurs, métriques) et les relit en SQL (InfluxDB 3) ou Flux (InfluxDB 2).",
    params: [{ name: "adresse", label: "Adresse", default: "http://influxdb:8086" }, { name: "jeton", label: "Secret du jeton", default: "INFLUX_TOKEN" }, { name: "org", label: "Organisation (v2)" }, { name: "bucket", label: "Bucket / base", required: true },
      { name: "action", label: "Action", type: "select", options: ["écrire", "lire (Flux, v2)", "lire (SQL, v3)"], default: "écrire" },
      { name: "mesure", label: "Mesure", showIf: { action: "écrire" }, help: "Ex. temperature" }, { name: "etiquettes", label: "Étiquettes (JSON)", type: "json", showIf: { action: "écrire" }, help: '{"piece":"salon"}' }, { name: "valeurs", label: "Valeurs (JSON)", type: "json", showIf: { action: "écrire" }, help: '{"valeur": {{temp}}}' },
      { name: "requete", label: "Requête", type: "code", help: 'Flux : from(bucket:"x") |> range(start:-1h)' }],
    run: async (p, ctx, api) => {
      const B = String(p.adresse).replace(/\/$/, ""), h = { Authorization: `Token ${await need(api, p.jeton)}` };
      const escK = (s) => String(s).replace(/([,= ])/g, "\\$1");
      if (p.action === "écrire") {
        const tags = Object.entries(J(p.etiquettes, {})).map(([k, v]) => `,${escK(k)}=${escK(v)}`).join("");
        const fields = Object.entries(J(p.valeurs, {})).map(([k, v]) => `${escK(k)}=${typeof v === "number" ? v : typeof v === "boolean" ? v : `"${String(v).replace(/"/g, '\\"')}"`}`).join(",");
        if (!fields) throw perm("indique au moins une valeur");
        await call(`${B}/api/v2/write?${p.org ? `org=${encodeURIComponent(p.org)}&` : ""}bucket=${encodeURIComponent(p.bucket)}&precision=ms`, { method: "POST", raw: true, headers: { ...h, "Content-Type": "text/plain" }, body: `${escK(p.mesure)}${tags} ${fields} ${Date.now()}`, name: "InfluxDB" });
        return { ecrit: true };
      }
      if (p.action === "lire (SQL, v3)") return call(`${B}/api/v3/query_sql`, { method: "POST", headers: h, body: { db: p.bucket, q: p.requete, format: "json" }, name: "InfluxDB" });
      const r = await fetch(`${B}/api/v2/query?org=${encodeURIComponent(p.org || "")}`, { method: "POST", headers: { ...h, "Content-Type": "application/vnd.flux", Accept: "application/csv" }, body: p.requete });
      if (!r.ok) throw new Error(`InfluxDB : HTTP ${r.status}`);
      const lines = (await r.text()).split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
      const head = (lines.shift() || "").split(",");
      return lines.filter((l) => l !== head.join(",")).map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v !== "" && !isNaN(v) ? +v : v]).filter(([k]) => k && k !== "result" && k !== "table")));
    },
  },
  {
    name: "dzf_supabase", label: "Supabase", category: "Données externes", icon: "fas fa-bolt", output: "supabase", timeout: 60,
    description: "Lire, ajouter, modifier ou supprimer des lignes d'une table Supabase (API REST), ou appeler une fonction.",
    params: [{ name: "adresse", label: "Adresse du projet", required: true, help: "https://xxxx.supabase.co" }, { name: "cle", label: "Secret de la clé", default: "SUPABASE_KEY" }, { name: "table", label: "Table ou fonction", required: true },
      { name: "action", label: "Action", type: "select", options: ["lire", "ajouter", "modifier", "supprimer", "appeler une fonction"], default: "lire" },
      { name: "filtre", label: "Filtre", help: "Syntaxe PostgREST : statut=eq.ouvert&age=gt.18" }, { name: "colonnes", label: "Colonnes", default: "*" }, { name: "donnees", label: "Données (JSON)", type: "json" }, { name: "n", label: "Lignes max", type: "int", default: 100 }],
    run: async (p, ctx, api) => {
      const k = await need(api, p.cle), B = `${String(p.adresse).replace(/\/$/, "")}/rest/v1`, h = { apikey: k, Authorization: `Bearer ${k}`, Prefer: "return=representation" };
      const f = p.filtre ? `&${String(p.filtre).replace(/^[?&]/, "")}` : "";
      const t = encodeURIComponent(p.table);
      if (p.action === "lire") return call(`${B}/${t}?select=${encodeURIComponent(p.colonnes || "*")}&limit=${+p.n || 100}${f}`, { headers: h, name: "Supabase" });
      if (p.action === "ajouter") return call(`${B}/${t}`, { method: "POST", headers: h, body: J(p.donnees), name: "Supabase" });
      if (p.action === "appeler une fonction") return call(`${B}/rpc/${t}`, { method: "POST", headers: h, body: J(p.donnees, {}), name: "Supabase" });
      if (!f) throw perm("un filtre est obligatoire pour modifier ou supprimer");
      return call(`${B}/${t}?${f.slice(1)}`, { method: p.action === "modifier" ? "PATCH" : "DELETE", headers: h, body: p.action === "modifier" ? J(p.donnees) : undefined, name: "Supabase" });
    },
  },
  {
    name: "dzf_airtable", label: "Airtable", category: "Données externes", icon: "fas fa-th", output: "airtable", timeout: 60,
    description: "Lire (avec formule de filtre), ajouter ou modifier des enregistrements d'une base Airtable.",
    params: [{ name: "jeton", label: "Secret du jeton", default: "AIRTABLE_TOKEN" }, { name: "base", label: "Id de la base", required: true, help: "app…" }, { name: "table", label: "Table", required: true },
      { name: "action", label: "Action", type: "select", options: ["lire", "ajouter", "modifier"], default: "lire" }, { name: "formule", label: "Formule de filtre", showIf: { action: "lire" }, help: "Ex. {Statut}='À faire'" }, { name: "donnees", label: "Enregistrements (JSON)", type: "json", help: "Liste d'objets champs (ajouter) ou {id, …champs} (modifier)" }],
    run: async (p, ctx, api) => {
      const h = { Authorization: `Bearer ${await need(api, p.jeton)}` }, B = `https://api.airtable.com/v0/${encodeURIComponent(p.base)}/${encodeURIComponent(p.table)}`;
      if (p.action === "lire") { const out = []; let off; do { const j = await call(`${B}?pageSize=100${p.formule ? `&filterByFormula=${encodeURIComponent(p.formule)}` : ""}${off ? `&offset=${off}` : ""}`, { headers: h, name: "Airtable" }); out.push(...j.records.map((r) => ({ id: r.id, ...r.fields }))); off = j.offset; } while (off && out.length < 5000); return out; }
      const list = asList(J(p.donnees, []));
      const out = [];
      for (let i = 0; i < list.length; i += 10) {
        const chunk = list.slice(i, i + 10).map((r) => (p.action === "modifier" ? { id: r.id, fields: Object.fromEntries(Object.entries(r).filter(([k]) => k !== "id")) } : { fields: r }));
        const j = await call(B, { method: p.action === "modifier" ? "PATCH" : "POST", headers: h, body: { records: chunk, typecast: true }, name: "Airtable" });
        out.push(...j.records.map((r) => ({ id: r.id, ...r.fields })));
      }
      return out;
    },
  },
  {
    name: "dzf_notion", label: "Notion", category: "Données externes", icon: "fas fa-sticky-note", output: "notion", timeout: 60,
    description: "Lire une base Notion (en lignes simples), y ajouter une page, ou ajouter du texte à une page.",
    params: [{ name: "jeton", label: "Secret du jeton d'intégration", default: "NOTION_TOKEN" }, { name: "action", label: "Action", type: "select", options: ["lire une base", "ajouter à une base", "ajouter du texte à une page"], default: "lire une base" },
      { name: "id", label: "Id de la base ou de la page", required: true }, { name: "proprietes", label: "Propriétés (JSON simple)", type: "json", showIf: { action: "ajouter à une base" }, help: '{"Nom":"Acheter du pain","Statut":"À faire","Date":"2026-10-01"}' }, { name: "texte", label: "Texte", type: "text", showIf: { action: "ajouter du texte à une page" } }],
    run: async (p, ctx, api) => {
      const h = { Authorization: `Bearer ${await need(api, p.jeton)}`, "Notion-Version": "2022-06-28" };
      const g = (u, o = {}) => call(`https://api.notion.com/v1${u}`, { ...o, headers: h, name: "Notion" });
      const flat = (pr) => { switch (pr.type) { case "title": case "rich_text": return pr[pr.type].map((t) => t.plain_text).join(""); case "select": case "status": return pr[pr.type] && pr[pr.type].name; case "multi_select": return pr.multi_select.map((x) => x.name); case "date": return pr.date && pr.date.start; case "people": return pr.people.map((x) => x.name); case "formula": return pr.formula[pr.formula.type]; case "relation": return pr.relation.map((x) => x.id); case "rollup": return pr.rollup[pr.rollup.type]; default: return pr[pr.type]; } };
      if (p.action === "lire une base") { const out = []; let cur; do { const j = await g(`/databases/${p.id}/query`, { method: "POST", body: { page_size: 100, ...(cur ? { start_cursor: cur } : {}) } }); out.push(...j.results.map((r) => ({ id: r.id, url: r.url, ...Object.fromEntries(Object.entries(r.properties).map(([k, v]) => [k, flat(v)])) }))); cur = j.has_more ? j.next_cursor : null; } while (cur && out.length < 5000); return out; }
      if (p.action === "ajouter du texte à une page") { await g(`/blocks/${p.id}/children`, { method: "PATCH", body: { children: String(p.texte || "").split(/\n\s*\n/).map((t) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: t.slice(0, 2000) } }] } })) } }); return { ajoute: true }; }
      const db = await g(`/databases/${p.id}`);
      const props = {};
      for (const [k, v] of Object.entries(J(p.proprietes, {}))) {
        const t = db.properties[k] && db.properties[k].type;
        if (!t) continue;
        props[k] = t === "title" ? { title: [{ text: { content: String(v) } }] } : t === "rich_text" ? { rich_text: [{ text: { content: String(v) } }] } : t === "select" ? { select: { name: String(v) } } : t === "status" ? { status: { name: String(v) } } : t === "multi_select" ? { multi_select: [].concat(v).map((n) => ({ name: String(n) })) } : t === "date" ? { date: { start: String(v) } } : t === "number" ? { number: +v } : t === "checkbox" ? { checkbox: !!v } : t === "url" ? { url: String(v) } : t === "email" ? { email: String(v) } : { [t]: v };
      }
      const j = await g("/pages", { method: "POST", body: { parent: { database_id: p.id }, properties: props } });
      return { id: j.id, url: j.url };
    },
  },
  {
    name: "dzf_google_sheets", label: "Google Sheets", category: "Données externes", icon: "fas fa-file-excel", output: "sheets", timeout: 60,
    description: "Lire une feuille Google (en objets, la 1re ligne donne les noms), ajouter des lignes à la fin, ou écrire dans une plage. Avec un compte de service (partage la feuille avec son e-mail).",
    params: [{ name: "compte", label: "Secret du compte de service (JSON)", default: "GOOGLE_SA" }, { name: "classeur", label: "Id du classeur", required: true, help: "Dans l'URL : /spreadsheets/d/<id>/" },
      { name: "action", label: "Action", type: "select", options: ["lire", "ajouter des lignes", "écrire une plage"], default: "lire" }, { name: "plage", label: "Feuille ou plage", default: "Feuille 1", help: "Ex. Feuille 1 ou Feuille 1!A1:D20" },
      { name: "lignes", label: "Lignes (JSON)", type: "json", help: "Liste d'objets (colonnes selon l'en-tête) ou liste de listes" }],
    run: async (p, ctx, api) => {
      const tok = await googleToken(api, p.compte, "https://www.googleapis.com/auth/spreadsheets");
      const h = { Authorization: `Bearer ${tok}` }, B = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(p.classeur)}/values`, R = encodeURIComponent(p.plage || "A:ZZ");
      if (p.action === "lire") { const j = await call(`${B}/${R}`, { headers: h, name: "Google Sheets" }); const [head = [], ...rows] = j.values || []; return rows.map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? null]))); }
      let rows = asList(J(p.lignes, []));
      if (rows.length && !Array.isArray(rows[0])) {
        const sheet = String(p.plage || "").split("!")[0];
        const head = ((await call(`${B}/${encodeURIComponent(sheet + "!1:1")}`, { headers: h, name: "Google Sheets" })).values || [[]])[0];
        rows = rows.map((r) => head.map((k) => (r[k] === undefined || r[k] === null ? "" : typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k])));
      }
      if (p.action === "ajouter des lignes") { const j = await call(`${B}/${R}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", headers: h, body: { values: rows }, name: "Google Sheets" }); return { plage: j.updates.updatedRange, lignes: j.updates.updatedRows }; }
      const j = await call(`${B}/${R}?valueInputOption=USER_ENTERED`, { method: "PUT", headers: h, body: { values: rows }, name: "Google Sheets" });
      return { plage: j.updatedRange, cellules: j.updatedCells };
    },
  },
  {
    name: "dzf_baserow_nocodb", label: "Baserow / NocoDB", category: "Données externes", icon: "fas fa-border-all", output: "lignes_ext", timeout: 60,
    description: "Lire, ajouter ou modifier des lignes dans Baserow ou NocoDB (les « Airtable » libres, hébergeables chez toi).",
    params: [{ name: "outil", label: "Outil", type: "select", options: ["Baserow", "NocoDB"], default: "Baserow" }, { name: "adresse", label: "Adresse", default: "https://api.baserow.io" }, { name: "jeton", label: "Secret du jeton", default: "BASEROW_TOKEN" },
      { name: "table", label: "Id de la table", required: true }, { name: "action", label: "Action", type: "select", options: ["lire", "ajouter", "modifier"], default: "lire" }, { name: "donnees", label: "Lignes (JSON)", type: "json" }],
    run: async (p, ctx, api) => {
      const k = await need(api, p.jeton), B = String(p.adresse).replace(/\/$/, ""), rows = asList(J(p.donnees, []));
      if (p.outil === "Baserow") {
        const h = { Authorization: `Token ${k}` }, T = `${B}/api/database/rows/table/${encodeURIComponent(p.table)}`;
        if (p.action === "lire") return (await call(`${T}/?user_field_names=true&size=200`, { headers: h, name: "Baserow" })).results;
        if (p.action === "ajouter") return (await call(`${T}/batch/?user_field_names=true`, { method: "POST", headers: h, body: { items: rows }, name: "Baserow" })).items;
        return (await call(`${T}/batch/?user_field_names=true`, { method: "PATCH", headers: h, body: { items: rows }, name: "Baserow" })).items;
      }
      const h = { "xc-token": k }, T = `${B}/api/v2/tables/${encodeURIComponent(p.table)}/records`;
      if (p.action === "lire") return (await call(`${T}?limit=200`, { headers: h, name: "NocoDB" })).list;
      return call(T, { method: p.action === "ajouter" ? "POST" : "PATCH", headers: h, body: rows, name: "NocoDB" });
    },
  },
];
