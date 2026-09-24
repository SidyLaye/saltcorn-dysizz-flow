/* IA avancée : images, voix (transcription et synthèse), vision et OCR, agent
   qui utilise des outils (tes workflows, tes tables), questions sur tes
   documents (RAG), découpage de textes, traduction DeepL / LibreTranslate.
   Toujours via des API compatibles OpenAI : Ollama, LocalAI, Groq, Mistral… */
"use strict";
const { getPath, asList } = require("../engine");
const { charger, sortie, PARAMS_SORTIE } = require("../lib/fichiers");

const perm = (m) => Object.assign(new Error(m), { permanent: true });
const CONN = (url = "http://ollama:11434/v1", modele = "llama3.1") => [
  { name: "url_base", label: "Adresse de l'API (compatible OpenAI)", default: url, help: "Ollama : http://ollama:11434/v1 · OpenAI : https://api.openai.com/v1 · Groq : https://api.groq.com/openai/v1 · Mistral : https://api.mistral.ai/v1" },
  { name: "modele", label: "Modèle", default: modele, required: true },
  { name: "variable_cle", label: "Nom du secret de la clé (si besoin)", help: "Ex. OPENAI_API_KEY. Vide pour Ollama" },
];
const auth = async (p, api) => { if (!p.variable_cle) return {}; const k = await api.secret(p.variable_cle); if (!k) throw perm(`secret ${p.variable_cle} introuvable`); return { Authorization: `Bearer ${k}` }; };
const base = (p) => String(p.url_base).replace(/\/$/, "");
const postJ = async (url, body, headers) => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || `HTTP ${r.status}`);
  return j;
};
const chat = async (p, api, messages, extra = {}) => (await postJ(`${base(p)}/chat/completions`, { model: p.modele, messages, temperature: p.temperature ?? 0.2, ...extra }, await auth(p, api))).choices[0].message;
const embed = async (p, api, input) => (await postJ(`${String(p.url_vecteurs || p.url_base).replace(/\/$/, "")}/embeddings`, { model: p.modele_vecteurs || "nomic-embed-text", input }, await auth(p, api))).data.map((d) => d.embedding);
const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x) * Math.sqrt(y) || 1); };
const imgUri = async (src) => { const f = await charger(src, { texte: false, max: 20e6 }); return `data:${f.type.startsWith("image/") ? f.type : "image/jpeg"};base64,${f.buf.toString("base64")}`; };

/* découpe un texte en morceaux d'environ `taille` caractères, sur les paragraphes puis les phrases */
const decouper = (t, taille = 1200, recouvrement = 150) => {
  const parts = String(t || "").split(/\n\s*\n/).flatMap((p) => (p.length > taille ? p.match(/[^.!?\n]+[.!?]*\s*/g) || [p] : [p]));
  const out = []; let cur = "";
  for (const s of parts) {
    if ((cur + "\n\n" + s).length > taille && cur) { out.push(cur.trim()); cur = cur.slice(-recouvrement) + " " + s; }
    else cur = cur ? cur + "\n\n" + s : s;
    while (cur.length > taille * 1.5) { out.push(cur.slice(0, taille).trim()); cur = cur.slice(taille - recouvrement); }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

module.exports = [
  {
    name: "dzf_ia_image", label: "IA : créer une image", category: "IA", icon: "fas fa-palette", output: "image", timeout: 300,
    description: "Crée une image à partir d'une description (illustration d'article, visuel de post, avatar…). API compatible OpenAI : OpenAI, LocalAI, Together…",
    params: [...CONN("https://api.openai.com/v1", "gpt-image-1"), { name: "description", label: "Description de l'image", type: "text", required: true }, { name: "taille", label: "Taille", type: "select", options: ["1024x1024", "1536x1024", "1024x1536", "512x512"], default: "1024x1024" },
      { name: "nom", label: "Nom du fichier", default: "image.png" }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      const j = await postJ(`${base(p)}/images/generations`, { model: p.modele, prompt: String(p.description), size: p.taille, n: 1 }, await auth(p, api));
      const d = (j.data || [])[0] || {};
      const buf = d.b64_json ? Buffer.from(d.b64_json, "base64") : d.url ? (await charger(d.url, { texte: false })).buf : null;
      if (!buf) throw new Error("pas d'image reçue");
      return sortie(api, p, p.nom || "image.png", "image/png", buf);
    },
  },
  {
    name: "dzf_ia_transcrire", label: "IA : transcrire un audio ou une vidéo", category: "IA", icon: "fas fa-microphone-alt", output: "transcription", timeout: 600,
    description: "Transforme une réunion, un message vocal ou une vidéo en texte (Whisper). Local avec speaches/LocalAI, ou Groq / OpenAI.",
    params: [...CONN("https://api.groq.com/openai/v1", "whisper-large-v3"), { name: "fichier", label: "Fichier audio/vidéo", required: true, help: "mp3, m4a, wav, ogg, webm, mp4 (25 Mo max chez la plupart)" },
      { name: "langue", label: "Langue", default: "fr" }, { name: "horodatage", label: "Avec les temps de chaque phrase", type: "bool", default: false }],
    run: async (p, ctx, api) => {
      const f = await charger(p.fichier, { texte: false, max: 100e6 });
      const fd = new FormData();
      fd.append("file", new Blob([f.buf], { type: f.type }), f.nom);
      fd.append("model", p.modele);
      if (p.langue) fd.append("language", p.langue);
      fd.append("response_format", p.horodatage ? "verbose_json" : "json");
      const r = await fetch(`${base(p)}/audio/transcriptions`, { method: "POST", headers: await auth(p, api), body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || `HTTP ${r.status}`);
      return p.horodatage ? { texte: j.text, segments: (j.segments || []).map((s) => ({ debut: s.start, fin: s.end, texte: s.text })) } : j.text;
    },
  },
  {
    name: "dzf_ia_voix", label: "IA : lire un texte à voix haute", category: "IA", icon: "fas fa-volume-up", output: "audio", timeout: 300,
    description: "Transforme un texte en fichier audio (mp3) : résumé du matin en podcast, message vocal, accessibilité. Local avec Kokoro/speaches, ou OpenAI.",
    params: [...CONN("http://speaches:8000/v1", "tts-1"), { name: "texte", label: "Texte", type: "text", required: true }, { name: "voix", label: "Voix", default: "alloy" }, { name: "vitesse", label: "Vitesse", type: "number", default: 1 },
      { name: "nom", label: "Nom du fichier", default: "audio.mp3" }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      const r = await fetch(`${base(p)}/audio/speech`, { method: "POST", headers: { "Content-Type": "application/json", ...(await auth(p, api)) }, body: JSON.stringify({ model: p.modele, input: String(p.texte).slice(0, 4096), voice: p.voix || "alloy", speed: +p.vitesse || 1, response_format: "mp3" }) });
      if (!r.ok) throw new Error(`synthèse vocale : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return sortie(api, p, p.nom || "audio.mp3", "audio/mpeg", Buffer.from(await r.arrayBuffer()));
    },
  },
  {
    name: "dzf_ia_vision", label: "IA : comprendre une image (vision, OCR)", category: "IA", icon: "fas fa-eye", output: "vision", timeout: 300,
    description: "Décrit une photo, lit le texte d'un ticket ou d'une facture scannée (OCR), ou en sort des champs en JSON (montant, date, fournisseur…). Modèles : llava, qwen2.5vl (Ollama), gpt-4o-mini…",
    params: [...CONN("http://ollama:11434/v1", "qwen2.5vl"), { name: "image", label: "Image", required: true, help: "Chemin Saltcorn, URL ou {{photo}}" },
      { name: "mode", label: "Je veux", type: "select", options: ["une description", "le texte (OCR)", "des champs (JSON)", "réponse à ma question"], default: "une description" },
      { name: "champs", label: "Champs à extraire", showIf: { mode: "des champs (JSON)" }, default: "fournisseur, date, montant_ttc, tva", help: "Séparés par des virgules" }, { name: "question", label: "Question", showIf: { mode: "réponse à ma question" } }],
    run: async (p, ctx, api) => {
      const consigne = { "une description": "Décris cette image en français, en 2 à 4 phrases.", "le texte (OCR)": "Recopie tout le texte visible sur l'image, fidèlement, en gardant les retours à la ligne. Rien d'autre.", "des champs (JSON)": `Lis l'image et réponds en JSON avec exactement ces clés : ${p.champs}. Mets null si absent. Nombres sans unité, dates AAAA-MM-JJ.`, "réponse à ma question": String(p.question || "") }[p.mode];
      const m = await chat({ ...p, temperature: 0 }, api, [{ role: "user", content: [{ type: "text", text: consigne }, { type: "image_url", image_url: { url: await imgUri(p.image) } }] }], p.mode === "des champs (JSON)" ? { response_format: { type: "json_object" } } : {});
      const t = String(m.content || "").trim();
      if (p.mode !== "des champs (JSON)") return t;
      try { return JSON.parse(t.replace(/^```(json)?|```$/g, "").trim()); } catch (e) { throw new Error("le modèle n'a pas renvoyé du JSON valide"); }
    },
  },
  {
    name: "dzf_ia_agent", label: "IA : agent avec outils", category: "IA", icon: "fas fa-user-astronaut", output: "agent", timeout: 600,
    description: "Un assistant qui raisonne et agit : il peut chercher dans tes tables, lire une page web, et lancer tes workflows (créer une tâche, envoyer un mail…) jusqu'à avoir répondu. Tu choisis ses outils.",
    params: [...CONN("http://ollama:11434/v1", "qwen2.5"), { name: "consigne", label: "Demande", type: "text", required: true, help: "Ex. {{message}} reçu sur Telegram" },
      { name: "systeme", label: "Rôle", type: "text", default: "Tu es l'assistant personnel de l'utilisateur. Tu réponds en français, brièvement. Utilise les outils quand c'est utile, n'invente rien." },
      { name: "tables", label: "Tables consultables (lecture seule)", help: "Séparées par des virgules. Ex. taches, contacts" },
      { name: "workflows", label: "Workflows qu'il peut lancer", help: "Noms séparés par des virgules. Il reçoit leurs paramètres en JSON." },
      { name: "web", label: "Peut lire des pages web", type: "bool", default: false }, { name: "etapes_max", label: "Étapes max", type: "int", default: 6 }],
    run: async (p, ctx, api) => {
      const Trigger = require("@saltcorn/data/models/trigger");
      const tables = String(p.tables || "").split(",").map((s) => s.trim()).filter(Boolean);
      const wfs = String(p.workflows || "").split(",").map((s) => s.trim()).filter(Boolean);
      const tools = [];
      const impl = {};
      if (tables.length) {
        tools.push({ type: "function", function: { name: "chercher_table", description: `Cherche des lignes dans une table. Tables : ${tables.join(", ")}`, parameters: { type: "object", properties: { table: { type: "string", enum: tables }, filtre: { type: "object", description: "égalités champ: valeur (facultatif)" }, texte: { type: "string", description: "mot à chercher dans les champs texte (facultatif)" } }, required: ["table"] } } });
        impl.chercher_table = async ({ table, filtre, texte }) => {
          if (!tables.includes(table)) return "table non autorisée";
          const t = api.Table.findOne({ name: table });
          if (!t) return "table introuvable";
          if (api.user && api.user.role_id > t.min_role_read) return "lecture refusée";
          const names = new Set(t.getFields().map((f) => f.name));
          const where = Object.fromEntries(Object.entries(filtre || {}).filter(([k]) => names.has(k)));
          let rows = await t.getRows(where, { limit: 200, orderBy: "id", orderDesc: true });
          if (texte) { const q = String(texte).toLowerCase(); rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)); }
          return JSON.stringify(rows.slice(0, 20)).slice(0, 8000);
        };
      }
      for (const w of wfs) {
        const fn = "wf_" + w.replace(/[^\w]/g, "_").slice(0, 50);
        tools.push({ type: "function", function: { name: fn, description: `Lance le workflow « ${w} »${Trigger.findOne({ name: w })?.description ? ` : ${Trigger.findOne({ name: w }).description}` : ""}`, parameters: { type: "object", properties: {}, additionalProperties: true } } });
        impl[fn] = async (args) => { const t = Trigger.findOne({ name: w }); if (!t) return "workflow introuvable"; const r = await t.runWithoutRow({ row: args || {}, user: api.user, req: api.req }); return JSON.stringify(r ?? "fait").slice(0, 4000); };
      }
      if (p.web) {
        tools.push({ type: "function", function: { name: "lire_page", description: "Lit le texte d'une page web", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } });
        impl.lire_page = async ({ url }) => { if (!/^https?:\/\//.test(url)) return "URL invalide"; const r = await fetch(url, { headers: { "User-Agent": "dysizz-flow/2" } }); return require("../core").plain(await r.text()).slice(0, 8000); };
      }
      const messages = [{ role: "system", content: p.systeme || "" }, { role: "user", content: String(p.consigne) }];
      const trace = [];
      for (let i = 0; i < Math.min(15, +p.etapes_max || 6); i++) {
        const m = await chat(p, api, messages, tools.length ? { tools } : {});
        messages.push(m);
        if (!m.tool_calls || !m.tool_calls.length) return { reponse: String(m.content || "").trim(), etapes: trace };
        for (const c of m.tool_calls) {
          let args = {}; try { args = JSON.parse(c.function.arguments || "{}"); } catch (e) { /* vide */ }
          let res; try { res = impl[c.function.name] ? await impl[c.function.name](args) : "outil inconnu"; } catch (e) { res = `erreur : ${e.message}`; }
          trace.push({ outil: c.function.name, arguments: args, resultat: String(res).slice(0, 300) });
          messages.push({ role: "tool", tool_call_id: c.id, name: c.function.name, content: String(res) });
        }
      }
      return { reponse: "Je n'ai pas fini dans le nombre d'étapes permis.", etapes: trace };
    },
  },
  {
    name: "dzf_ia_decouper", label: "IA : découper un texte en morceaux", category: "IA", icon: "fas fa-cut", output: "morceaux",
    description: "Coupe un long texte (PDF, page, livre) en morceaux qui se chevauchent un peu, pour les ranger avec leur vecteur et les retrouver ensuite par le sens.",
    params: [{ name: "texte", label: "Texte", required: true }, { name: "taille", label: "Taille d'un morceau (caractères)", type: "int", default: 1200 }, { name: "recouvrement", label: "Chevauchement", type: "int", default: 150 }, { name: "source", label: "Source (copiée dans chaque morceau)", help: "Ex. {{fichier.nom}}" }],
    run: async (p) => decouper(p.texte, Math.max(200, +p.taille || 1200), Math.max(0, +p.recouvrement || 0)).map((t, i) => ({ n: i + 1, texte: t, source: p.source || "" })),
  },
  {
    name: "dzf_ia_rag", label: "IA : répondre avec mes documents", category: "IA", icon: "fas fa-book-reader", output: "reponse", timeout: 300,
    description: "Pose une question : l'IA cherche les passages les plus proches dans ta table de morceaux (texte + vecteur) et répond en citant ses sources. Ton « ChatGPT » sur tes propres documents.",
    params: [...CONN(), { name: "modele_vecteurs", label: "Modèle de vecteurs", default: "nomic-embed-text" }, { name: "question", label: "Question", required: true },
      { name: "table", label: "Table des morceaux", type: "table", required: true }, { name: "champ_texte", label: "Champ texte", default: "texte" }, { name: "champ_vecteur", label: "Champ vecteur", default: "vecteur" }, { name: "champ_source", label: "Champ source", default: "source" },
      { name: "filtre", label: "Filtre (JSON)", type: "json" }, { name: "n", label: "Passages utilisés", type: "int", default: 5 }],
    run: async (p, ctx, api) => {
      const t = api.Table.findOne({ name: p.table });
      if (!t) throw perm(`table « ${p.table} » introuvable`);
      if (api.user && api.user.role_id > t.min_role_read) throw perm("lecture refusée pour ton rôle");
      const [q] = await embed(p, api, [String(p.question)]);
      const rows = await t.getRows(p.filtre || {}, { limit: 20000 });
      const best = rows.map((r) => { let v = r[p.champ_vecteur]; if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { v = null; } } return { r, s: Array.isArray(v) ? cos(q, v) : 0 }; }).sort((a, b) => b.s - a.s).slice(0, Math.min(20, +p.n || 5));
      const ctxTxt = best.map((b, i) => `[${i + 1}] (${b.r[p.champ_source] || "?"}) ${String(b.r[p.champ_texte] || "").slice(0, 2500)}`).join("\n\n");
      const m = await chat(p, api, [{ role: "system", content: "Réponds en français à partir des extraits fournis uniquement. Cite les numéros [1], [2]… Si la réponse n'y est pas, dis-le." }, { role: "user", content: `Extraits :\n${ctxTxt}\n\nQuestion : ${p.question}` }]);
      return { reponse: String(m.content || "").trim(), sources: best.map((b, i) => ({ n: i + 1, source: b.r[p.champ_source] || "", score: +b.s.toFixed(3), id: b.r.id })) };
    },
  },
  {
    name: "dzf_traduire", label: "Traduire (DeepL ou LibreTranslate)", category: "IA", icon: "fas fa-language", output: "traduction", timeout: 120,
    description: "Traduction de qualité sans modèle d'IA : DeepL (clé gratuite 500 000 caractères/mois) ou LibreTranslate (libre, hébergeable chez toi). Texte ou liste.",
    params: [{ name: "service", label: "Service", type: "select", options: ["DeepL", "LibreTranslate"], default: "LibreTranslate" }, { name: "texte", label: "Texte ou liste", required: true }, { name: "champ", label: "Champ à traduire (si liste)", default: "titre" },
      { name: "vers", label: "Vers la langue", default: "fr" }, { name: "cle", label: "Secret de la clé", default: "DEEPL_KEY" }, { name: "adresse", label: "Adresse LibreTranslate", default: "http://libretranslate:5000", showIf: { service: "LibreTranslate" } }],
    run: async (p, ctx, api) => {
      const isList = Array.isArray(p.texte);
      const src = isList ? asList(p.texte).map((it) => String(getPath(it, p.champ) ?? "")) : [String(p.texte)];
      let out;
      if (p.service === "DeepL") {
        const k = await api.secret(p.cle); if (!k) throw perm(`secret ${p.cle} introuvable`);
        const j = await postJ(k.endsWith(":fx") ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate", { text: src, target_lang: String(p.vers).toUpperCase() }, { Authorization: `DeepL-Auth-Key ${k}` });
        out = j.translations.map((t) => t.text);
      } else {
        const k = await api.secret(p.cle);
        out = [];
        for (const s of src) out.push((await postJ(`${String(p.adresse).replace(/\/$/, "")}/translate`, { q: s, source: "auto", target: p.vers, format: "text", ...(k ? { api_key: k } : {}) }, {})).translatedText);
      }
      return isList ? asList(p.texte).map((it, i) => ({ ...it, [`${p.champ}_${p.vers}`]: out[i] })) : out[0];
    },
  },
];
module.exports.decouper = decouper;
