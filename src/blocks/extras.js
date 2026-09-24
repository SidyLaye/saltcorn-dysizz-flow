/* Blocs complémentaires : données (SQL en lecture, groupements), API (GraphQL,
   téléchargement, webhooks signés, pages web), messageries (Slack, Discord,
   Teams, ntfy, SMS), IA (extraction, traduction, embeddings) et contrôle
   (aiguillage, idempotence, disjoncteur). */
"use strict";
const crypto = require("crypto");
const { asList, getPath, sanitize } = require("../engine");
const { plain, safeUrl } = require("../core");

const need = async (api, name) => { const v = await api.secret(name); if (!v) throw Object.assign(new Error(`secret ${name} introuvable (variable d'environnement ou coffre)`), { permanent: true }); return v; };
const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch (e) { return t; }
};
const kv = () => require("./controle").kv;

/* ---------------- Données ---------------- */
const donnees = [
  {
    name: "dzf_table_obtenir", label: "Table : obtenir une ligne", category: "Données", icon: "fas fa-crosshairs", output: "ligne",
    description: "Lit une seule ligne par son id ou par un filtre (la première trouvée). Renvoie null si rien.",
    params: [{ name: "table", label: "Table", type: "table", required: true }, { name: "id", label: "Id (sinon filtre)" }, { name: "filtre", label: "Filtre (JSON)", type: "json" }],
    run: async (p, ctx, api) => {
      const t = api.Table.findOne({ name: p.table });
      if (!t) throw Object.assign(new Error(`table « ${p.table} » introuvable`), { permanent: true });
      if (api.user && api.user.role_id > t.min_role_read) throw new Error("lecture refusée pour ton rôle");
      return sanitize((await t.getRow(p.id ? { id: +p.id } : p.filtre || {})) || null);
    },
  },
  {
    name: "dzf_table_grouper", label: "Table : regrouper (statistiques)", category: "Données", icon: "fas fa-table", output: "groupes",
    description: "Compte ou additionne par groupe directement dans la base (rapide même sur des millions de lignes) : ex. dépenses par catégorie, mails par expéditeur.",
    params: [{ name: "table", label: "Table", type: "table", required: true }, { name: "par", label: "Regrouper par (champ)", required: true },
      { name: "stat", label: "Calcul", type: "select", options: ["compter", "somme", "moyenne", "min", "max"], default: "compter" }, { name: "champ", label: "Champ calculé (sauf compter)" },
      { name: "filtre", label: "Filtre (JSON)", type: "json" }],
    run: async (p, ctx, api) => {
      const t = api.Table.findOne({ name: p.table });
      if (!t) throw Object.assign(new Error(`table « ${p.table} » introuvable`), { permanent: true });
      if (api.user && api.user.role_id > t.min_role_read) throw new Error("lecture refusée pour ton rôle");
      const agg = { compter: "Count", somme: "Sum", moyenne: "Avg", min: "Min", max: "Max" }[p.stat || "compter"];
      const rows = await t.aggregationQuery({ valeur: { field: p.stat === "compter" || !p.champ ? "id" : p.champ, aggregate: agg } }, { where: p.filtre || {}, groupBy: p.par });
      return (rows || []).map((r) => ({ groupe: r[p.par], valeur: Number(r.valeur) })).sort((a, b) => b.valeur - a.valeur);
    },
  },
  {
    name: "dzf_sql_lecture", label: "SQL : requête en lecture seule", category: "Données", icon: "fas fa-terminal", output: "lignes", timeout: 60,
    description: "Exécute une requête SELECT sur la base du tenant (jointures, fenêtres, CTE…). Refuse tout ce qui écrit, limite le temps d'exécution. Réservé aux admins. Paramètres : $1, $2…",
    params: [{ name: "requete", label: "Requête SQL", type: "code", required: true, raw: true, default: "select statut, count(*) as n from taches group by statut" },
      { name: "parametres", label: "Paramètres (JSON liste)", type: "json", help: '["{{id}}"] pour $1' }, { name: "limite", label: "Lignes max", type: "int", default: 1000 }, { name: "delai_s", label: "Temps max (secondes)", type: "int", default: 15 }],
    run: async (p, ctx, api) => {
      if (api.user && api.user.role_id !== 1) throw Object.assign(new Error("réservé aux administrateurs"), { permanent: true });
      const sql = String(p.requete).trim().replace(/;\s*$/, "");
      if (!/^(select|with)\b/i.test(sql) || /;/.test(sql) || /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|do)\b/i.test(sql.replace(/'[^']*'/g, ""))) throw Object.assign(new Error("seulement une requête SELECT (ou WITH … SELECT), sans point-virgule"), { permanent: true });
      const db = require("@saltcorn/data/db");
      const params = Array.isArray(p.parametres) ? p.parametres : [];
      if (db.isSQLite) return sanitize((await db.query(`${sql} limit ${+p.limite || 1000}`, params)).rows);
      const client = await db.getClient();
      try {
        await client.query("begin read only");
        await client.query(`set local statement_timeout = ${Math.max(1, Math.min(120, +p.delai_s || 15)) * 1000}`);
        await client.query(`set local search_path to "${db.getTenantSchema()}"`);
        const r = await client.query(`select * from (${sql}) as q limit ${Math.max(1, Math.min(100000, +p.limite || 1000))}`, params);
        await client.query("commit");
        return sanitize(r.rows);
      } catch (e) { await client.query("rollback").catch(() => {}); throw e; } finally { client.release(); }
    },
  },
];

/* ---------------- Réseau / API ---------------- */
const reseau = [
  {
    name: "dzf_graphql", label: "API : requête GraphQL", category: "Réseau", icon: "fas fa-project-diagram", output: "graphql", timeout: 60,
    description: "Envoie une requête GraphQL (GitHub, Shopify, Hasura, Strapi…) avec ses variables et un jeton lu dans les secrets.",
    params: [{ name: "url", label: "Adresse", required: true }, { name: "requete", label: "Requête", type: "code", required: true, raw: true }, { name: "variables", label: "Variables (JSON)", type: "json" },
      { name: "secret_jeton", label: "Nom du secret du jeton (Bearer)" }],
    run: async (p, ctx, api) => {
      const j = await post(p.url, { query: p.requete, variables: p.variables || {} }, p.secret_jeton ? { Authorization: `Bearer ${await need(api, p.secret_jeton)}` } : {});
      if (j.errors && j.errors.length) throw new Error(j.errors.map((e) => e.message).join(" · ").slice(0, 400));
      return j.data;
    },
  },
  {
    name: "dzf_telecharger", label: "API : télécharger un fichier", category: "Réseau", icon: "fas fa-cloud-download-alt", output: "fichier", timeout: 180,
    description: "Télécharge un fichier (PDF, image, export…) depuis une adresse et l'enregistre dans les fichiers Saltcorn (local ou S3). Taille limitée.",
    params: [{ name: "url", label: "Adresse", required: true }, { name: "nom", label: "Nom du fichier (facultatif)" }, { name: "dossier", label: "Dossier", default: "/telechargements" },
      { name: "max_mo", label: "Taille max (Mo)", type: "int", default: 25 }, { name: "secret_jeton", label: "Nom du secret du jeton (facultatif)" }],
    run: async (p, ctx, api) => {
      const r = await fetch(p.url, { headers: p.secret_jeton ? { Authorization: `Bearer ${await need(api, p.secret_jeton)}` } : {} });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const len = +r.headers.get("content-length") || 0;
      const max = (+p.max_mo || 25) * 1048576;
      if (len > max) throw Object.assign(new Error(`fichier trop gros (${Math.round(len / 1048576)} Mo)`), { permanent: true });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > max) throw Object.assign(new Error("fichier trop gros"), { permanent: true });
      const name = String(p.nom || decodeURIComponent(new URL(r.url).pathname.split("/").pop() || "fichier")).replace(/[^\w.\-]+/g, "_").slice(0, 120);
      const File = require("@saltcorn/data/models/file");
      const f = await File.from_contents(name, (r.headers.get("content-type") || "application/octet-stream").split(";")[0], buf, api.user ? api.user.id : null, 1, p.dossier || "/");
      return { chemin: f.path_to_serve || f.location, nom: name, octets: buf.length, type: r.headers.get("content-type") };
    },
  },
  {
    name: "dzf_webhook_verifier", label: "API : vérifier la signature d'un webhook", category: "Réseau", icon: "fas fa-stamp", output: "signature",
    description: "Vérifie qu'un webhook vient bien de l'expéditeur (GitHub, Stripe, Meta/WhatsApp, Shopify…) grâce à sa signature HMAC, en temps constant.",
    params: [{ name: "corps", label: "Corps brut reçu", required: true, help: "Ex. {{corps_brut}} (fourni par les points d'API dysizz-flow)" }, { name: "signature", label: "Signature reçue", required: true, help: "Ex. {{entetes.x-hub-signature-256}}" },
      { name: "secret", label: "Nom du secret partagé", required: true }, { name: "algo", label: "Algorithme", type: "select", options: ["sha256", "sha1", "sha512"], default: "sha256" },
      { name: "format", label: "Format", type: "select", options: ["hex (avec ou sans « sha256= »)", "base64", "stripe (t=…,v1=…)"], default: "hex (avec ou sans « sha256= »)" }],
    run: async (p, ctx, api) => {
      const key = await need(api, p.secret);
      const body = typeof p.corps === "string" ? p.corps : JSON.stringify(p.corps);
      let expected, got = String(p.signature || "");
      if (p.format.startsWith("stripe")) {
        const parts = Object.fromEntries(got.split(",").map((x) => x.split("=")));
        expected = crypto.createHmac("sha256", key).update(`${parts.t}.${body}`).digest("hex");
        got = parts.v1 || "";
        if (Math.abs(Date.now() / 1000 - +parts.t) > 300) return { valide: false, raison: "trop ancien" };
      } else {
        expected = crypto.createHmac(p.algo, key).update(body).digest(p.format === "base64" ? "base64" : "hex");
        got = got.replace(/^sha\d+=/, "");
      }
      const ok = expected.length === got.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
      return { valide: ok, raison: ok ? "" : "signature différente" };
    },
  },
  {
    name: "dzf_page_web", label: "Web : lire une page", category: "Réseau", icon: "fas fa-file-alt", output: "page", timeout: 60,
    description: "Récupère une page web et en extrait le titre, la description, le texte, les liens, les images et les méta Open Graph. Respecte les sites : un seul appel, pas d'exploration.",
    params: [{ name: "url", label: "Adresse", required: true }, { name: "max_texte", label: "Longueur max du texte", type: "int", default: 20000 }, { name: "liens", label: "Garder les liens", type: "bool", default: true }],
    run: async (p) => {
      const r = await fetch(p.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; dysizz-flow)", Accept: "text/html" }, redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = (await r.text()).slice(0, 3e6);
      const meta = (n) => { const m = new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i").exec(html) || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${n}["']`, "i").exec(html); return m ? plain(m[1]) : ""; };
      const base = r.url;
      const abs = (u) => { try { return new URL(u, base).href; } catch (e) { return ""; } };
      const links = p.liens === false ? [] : [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].slice(0, 500).map((m) => ({ url: safeUrl(abs(m[1])), texte: plain(m[2], 120) })).filter((l) => l.url);
      return {
        url: base, statut: r.status, titre: plain(((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]) || "", 300),
        description: meta("description") || meta("og:description"), image: safeUrl(abs(meta("og:image"))), langue: ((/<html[^>]+lang=["']([^"']+)/i.exec(html) || [])[1]) || "",
        texte: plain(html.replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " "), +p.max_texte || 20000), liens: links,
      };
    },
  },
];

/* ---------------- Messagerie ---------------- */
const messagerie = [
  {
    name: "dzf_slack", label: "Slack : envoyer un message", category: "Messagerie", icon: "fab fa-slack", output: "slack",
    description: "Envoie un message dans un canal Slack via un webhook entrant (l'adresse du webhook est un secret).",
    params: [{ name: "secret_webhook", label: "Nom du secret du webhook", default: "SLACK_WEBHOOK_URL" }, { name: "texte", label: "Texte (Markdown Slack)", type: "text", required: true }],
    run: async (p, ctx, api) => { await post(await need(api, p.secret_webhook), { text: String(p.texte).slice(0, 39000) }); return true; },
  },
  {
    name: "dzf_discord", label: "Discord : envoyer un message", category: "Messagerie", icon: "fab fa-discord", output: "discord",
    description: "Envoie un message dans un salon Discord via un webhook.",
    params: [{ name: "secret_webhook", label: "Nom du secret du webhook", default: "DISCORD_WEBHOOK_URL" }, { name: "texte", label: "Texte", type: "text", required: true }, { name: "nom", label: "Nom affiché", default: "dysizz" }],
    run: async (p, ctx, api) => { await post(await need(api, p.secret_webhook), { content: String(p.texte).slice(0, 2000), username: p.nom || "dysizz" }); return true; },
  },
  {
    name: "dzf_teams", label: "Teams : envoyer un message", category: "Messagerie", icon: "fab fa-microsoft", output: "teams",
    description: "Envoie un message dans un canal Microsoft Teams (workflow « Post to a channel when a webhook request is received »).",
    params: [{ name: "secret_webhook", label: "Nom du secret du webhook", default: "TEAMS_WEBHOOK_URL" }, { name: "titre", label: "Titre" }, { name: "texte", label: "Texte", type: "text", required: true }],
    run: async (p, ctx, api) => {
      await post(await need(api, p.secret_webhook), { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard", version: "1.4", body: [...(p.titre ? [{ type: "TextBlock", size: "Medium", weight: "Bolder", text: p.titre }] : []), { type: "TextBlock", text: String(p.texte), wrap: true }] } }] });
      return true;
    },
  },
  {
    name: "dzf_ntfy", label: "Push mobile (ntfy)", category: "Messagerie", icon: "fas fa-mobile-alt", output: "push",
    description: "Notification instantanée sur ton téléphone avec ntfy (appli gratuite Android/iOS, serveur public ou auto-hébergé). Priorité, étiquettes et lien au clic.",
    params: [{ name: "serveur", label: "Serveur", default: "https://ntfy.sh" }, { name: "sujet", label: "Sujet (topic)", required: true, help: "Choisis un nom long et difficile à deviner" },
      { name: "titre", label: "Titre" }, { name: "texte", label: "Texte", type: "text", required: true }, { name: "priorite", label: "Priorité", type: "select", options: ["min", "low", "default", "high", "urgent"], default: "default" },
      { name: "etiquettes", label: "Étiquettes (emoji ntfy)", help: "Ex. warning,computer" }, { name: "lien", label: "Lien au clic" }, { name: "secret_jeton", label: "Nom du secret du jeton (serveur privé)" }],
    run: async (p, ctx, api) => {
      const h = { Priority: p.priorite || "default" };
      if (p.titre) h.Title = encodeURIComponent(p.titre).length === p.titre.length ? p.titre : `=?UTF-8?B?${Buffer.from(p.titre).toString("base64")}?=`;
      if (p.etiquettes) h.Tags = p.etiquettes;
      if (p.lien) h.Click = p.lien;
      if (p.secret_jeton) h.Authorization = `Bearer ${await need(api, p.secret_jeton)}`;
      const r = await fetch(`${String(p.serveur).replace(/\/$/, "")}/${encodeURIComponent(p.sujet)}`, { method: "POST", headers: h, body: String(p.texte).slice(0, 4000) });
      if (!r.ok) throw new Error(`ntfy : HTTP ${r.status}`);
      return (await r.json().catch(() => ({}))).id || true;
    },
  },
  {
    name: "dzf_sms", label: "SMS : envoyer (Twilio)", category: "Messagerie", icon: "fas fa-sms", output: "sms",
    description: "Envoie un SMS avec Twilio (compte et numéro d'envoi à créer chez Twilio).",
    params: [{ name: "secret_sid", label: "Nom du secret du Account SID", default: "TWILIO_SID" }, { name: "secret_jeton", label: "Nom du secret de l'Auth Token", default: "TWILIO_TOKEN" },
      { name: "de", label: "Numéro d'envoi (Twilio)", required: true }, { name: "a", label: "Destinataire (+33…)", required: true }, { name: "texte", label: "Texte", type: "text", required: true }],
    run: async (p, ctx, api) => {
      const sid = await need(api, p.secret_sid), tok = await need(api, p.secret_jeton);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: p.de, To: p.a, Body: String(p.texte).slice(0, 1600) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
      return j.sid;
    },
  },
];

/* ---------------- IA ---------------- */
const CONN = [
  { name: "url_base", label: "Adresse de l'API (compatible OpenAI)", default: "http://ollama:11434/v1" },
  { name: "modele", label: "Modèle", default: "llama3.1", required: true },
  { name: "variable_cle", label: "Nom du secret de la clé (si besoin)" },
];
const chat = async (p, api, messages, json) => {
  const headers = { "Content-Type": "application/json" };
  if (p.variable_cle) headers.Authorization = `Bearer ${await need(api, p.variable_cle)}`;
  const j = await post(`${String(p.url_base).replace(/\/$/, "")}/chat/completions`, { model: p.modele, messages, temperature: 0, ...(json ? { response_format: { type: "json_object" } } : {}) }, headers);
  const txt = (((j.choices || [])[0] || {}).message || {}).content || "";
  if (!json) return txt.trim();
  try { return JSON.parse(txt.replace(/^```(json)?|```$/g, "").trim()); } catch (e) { throw new Error("le modèle n'a pas renvoyé du JSON valide"); }
};
const ia = [
  {
    name: "dzf_ia_extraire", label: "IA : extraire des informations", category: "IA", icon: "fas fa-highlighter", output: "extrait", timeout: 180,
    description: "Transforme un texte libre (mail, facture, CV, annonce) en données structurées : tu donnes les champs voulus, l'IA les remplit (null si absent).",
    params: [...CONN, { name: "texte", label: "Texte", required: true, type: "text" },
      { name: "champs", label: "Champs à extraire", required: true, help: "Ex. montant (nombre), date (AAAA-MM-JJ), fournisseur, numero_facture" }],
    run: async (p, ctx, api) => chat(p, api, [{ role: "system", content: `Extrais du texte ces champs et réponds uniquement en JSON avec exactement ces clés : ${p.champs}. Mets null si l'information n'est pas dans le texte. N'invente rien.` }, { role: "user", content: String(p.texte).slice(0, 24000) }], true),
  },
  {
    name: "dzf_ia_traduire", label: "IA : traduire", category: "IA", icon: "fas fa-language", output: "traduction", timeout: 180,
    description: "Traduit un texte dans la langue voulue en gardant la mise en forme.",
    params: [...CONN, { name: "texte", label: "Texte", required: true, type: "text" }, { name: "langue", label: "Vers la langue", default: "français" }],
    run: async (p, ctx, api) => chat(p, api, [{ role: "system", content: `Traduis en ${p.langue}. Garde la mise en forme. Réponds seulement avec la traduction.` }, { role: "user", content: String(p.texte).slice(0, 24000) }], false),
  },
  {
    name: "dzf_ia_vecteur", label: "IA : vecteur (embedding)", category: "IA", icon: "fas fa-vector-square", output: "vecteur", timeout: 120,
    description: "Calcule le vecteur d'un texte (ou d'une liste de textes) pour la recherche par le sens. Ex. nomic-embed-text avec Ollama.",
    params: [{ name: "url_base", label: "Adresse de l'API", default: "http://ollama:11434/v1" }, { name: "modele", label: "Modèle", default: "nomic-embed-text" },
      { name: "variable_cle", label: "Nom du secret de la clé (si besoin)" }, { name: "texte", label: "Texte ou liste", required: true }],
    run: async (p, ctx, api) => {
      const headers = p.variable_cle ? { Authorization: `Bearer ${await need(api, p.variable_cle)}` } : {};
      const input = Array.isArray(p.texte) ? p.texte.map(String) : String(p.texte);
      const j = await post(`${String(p.url_base).replace(/\/$/, "")}/embeddings`, { model: p.modele, input }, headers);
      const v = (j.data || []).map((d) => d.embedding);
      return Array.isArray(p.texte) ? v : v[0];
    },
  },
  {
    name: "dzf_similarite", label: "IA : plus proches par le sens", category: "IA", icon: "fas fa-compass", output: "proches",
    description: "Compare un vecteur à une liste d'éléments qui ont chacun un vecteur (similarité cosinus) et renvoie les N plus proches. Base d'une recherche intelligente.",
    params: [{ name: "vecteur", label: "Vecteur cherché", required: true }, { name: "liste", label: "Éléments", required: true }, { name: "champ_vecteur", label: "Champ du vecteur", default: "vecteur" },
      { name: "n", label: "Combien", type: "int", default: 5 }, { name: "seuil", label: "Score minimum (0 à 1)", type: "number", default: 0 }],
    run: async (p) => {
      const q = typeof p.vecteur === "string" ? JSON.parse(p.vecteur) : p.vecteur;
      const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x) * Math.sqrt(y) || 1); };
      return asList(p.liste).map((it) => { let v = getPath(it, p.champ_vecteur); if (typeof v === "string") v = JSON.parse(v); return { ...it, score: v ? +cos(q, v).toFixed(4) : 0 }; })
        .filter((x) => x.score >= (+p.seuil || 0)).sort((a, b) => b.score - a.score).slice(0, +p.n || 5).map(({ [p.champ_vecteur]: _v, ...rest }) => rest);
    },
  },
];

/* ---------------- Contrôle ---------------- */
const controle = [
  {
    name: "dzf_aiguiller", label: "Aiguiller (choisir un chemin)", category: "Contrôle", icon: "fas fa-code-branch", output: "chemin",
    description: "Renvoie le nom du chemin selon la valeur d'un champ (ex. priorité urgente → « alerte », normale → « liste »). À utiliser dans « étape suivante » : chemin.",
    params: [{ name: "valeur", label: "Valeur testée", required: true, help: "Ex. {{priorite}}" }, { name: "cas", label: "Cas (JSON)", type: "json", required: true, default: '{"urgente":"alerte","haute":"alerte"}' },
      { name: "defaut", label: "Sinon", default: "suite" }],
    run: async (p) => (p.cas && Object.prototype.hasOwnProperty.call(p.cas, String(p.valeur)) ? p.cas[String(p.valeur)] : p.defaut || ""),
  },
  {
    name: "dzf_idempotence", label: "Déjà traité ?", category: "Contrôle", icon: "fas fa-redo-alt", output: "deja_traite",
    description: "Dit si une clé a déjà été vue récemment, puis la note. Pour ne jamais traiter deux fois le même événement (webhook reçu en double, relance…).",
    params: [{ name: "cle", label: "Clé", required: true, help: "Ex. {{id_evenement}}" }, { name: "duree_h", label: "Mémoire (heures)", type: "int", default: 72 }],
    run: async (p) => {
      const k = `dzf:vu:${crypto.createHash("sha1").update(String(p.cle)).digest("hex")}`;
      const seen = await kv().get(k);
      if (!seen) await kv().set(k, Date.now(), (+p.duree_h || 72) * 3600);
      return !!seen;
    },
  },
  {
    name: "dzf_disjoncteur", label: "Disjoncteur", category: "Contrôle", icon: "fas fa-power-off", output: "circuit",
    description: "Protège un service fragile : après N échecs, on arrête de l'appeler pendant un moment au lieu d'insister. « vérifier » avant l'appel (sortie .passe = on peut appeler, .coupe = on attend), « signaler » après.",
    params: [{ name: "action", label: "Action", type: "select", options: ["vérifier", "signaler un échec", "signaler un succès"], default: "vérifier" }, { name: "nom", label: "Service", required: true, help: "Ex. api-france-travail" },
      { name: "seuil", label: "Échecs avant coupure", type: "int", default: 5 }, { name: "pause_min", label: "Coupure (minutes)", type: "int", default: 15 }],
    run: async (p) => {
      const k = `dzf:disj:${p.nom}`;
      const st = (await kv().get(k)) || { echecs: 0, jusqu_a: 0 };
      /* passe = on peut appeler le service ; coupe = on le laisse tranquille pour l'instant */
      if (p.action === "signaler un succès") { await kv().set(k, { echecs: 0, jusqu_a: 0 }, 86400); return { passe: true, coupe: false }; }
      if (p.action === "signaler un échec") {
        st.echecs++;
        if (st.echecs >= (+p.seuil || 5)) { st.jusqu_a = Date.now() + (+p.pause_min || 15) * 60e3; st.echecs = 0; }
        await kv().set(k, st, 86400);
        const passe = Date.now() >= st.jusqu_a;
        return { passe, coupe: !passe, echecs: st.echecs };
      }
      const passe = Date.now() >= (st.jusqu_a || 0);
      return { passe, coupe: !passe, reprise: passe ? null : new Date(st.jusqu_a).toISOString() };
    },
  },
];

module.exports = [...donnees, ...reseau, ...messagerie, ...ia, ...controle];
