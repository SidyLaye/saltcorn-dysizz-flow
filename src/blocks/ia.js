/* Blocs « IA » : n'importe quel modèle compatible OpenAI (Ollama, LiteLLM,
   OpenAI, Mistral…). Par défaut ton Ollama local : rien ne sort du serveur. */
"use strict";
const { asList } = require("../engine");

const CONN = [
  { name: "url_base", label: "Adresse de l'API (compatible OpenAI)", default: "http://ollama:11434/v1", help: "Ollama : http://ollama:11434/v1 · LiteLLM : http://litellm:4000/v1 · OpenAI : https://api.openai.com/v1" },
  { name: "modele", label: "Modèle", default: "llama3.1", required: true },
  { name: "variable_cle", label: "Variable d'environnement de la clé (si besoin)", help: "Ex. OPENAI_API_KEY. Vide pour Ollama" },
];

const chat = async (p, api, messages, json) => {
  const headers = { "Content-Type": "application/json" };
  if (p.variable_cle) { const k = api.env(p.variable_cle); if (!k) throw new Error(`variable ${p.variable_cle} absente`); headers.Authorization = `Bearer ${k}`; }
  const r = await fetch(`${String(p.url_base).replace(/\/$/, "")}/chat/completions`, {
    method: "POST", headers,
    body: JSON.stringify({ model: p.modele, messages, temperature: p.temperature ?? 0.2, ...(json ? { response_format: { type: "json_object" } } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || `HTTP ${r.status}`);
  const txt = (((j.choices || [])[0] || {}).message || {}).content || "";
  if (!json) return txt.trim();
  try { return JSON.parse(txt.replace(/^```(json)?|```$/g, "").trim()); } catch (e) { throw new Error("le modèle n'a pas renvoyé du JSON valide"); }
};

module.exports = [
  {
    name: "dzf_ia_texte", label: "IA : générer un texte", category: "IA", icon: "fas fa-robot", output: "ia", timeout: 180,
    description: "Envoie une consigne à un modèle et récupère sa réponse (texte ou JSON).",
    params: [...CONN,
      { name: "systeme", label: "Rôle du modèle", type: "text", default: "Tu réponds en français, simplement et brièvement." },
      { name: "prompt", label: "Consigne", type: "text", required: true, help: "Peut contenir des {{variables}}" },
      { name: "format", label: "Format de réponse", type: "select", options: ["texte", "JSON"], default: "texte" },
      { name: "temperature", label: "Créativité (0 à 1)", type: "number", default: 0.2 }],
    run: async (p, ctx, api) => chat(p, api, [{ role: "system", content: p.systeme || "" }, { role: "user", content: String(p.prompt) }], p.format === "JSON"),
  },
  {
    name: "dzf_ia_classer", label: "IA : classer dans une catégorie", category: "IA", icon: "fas fa-tags", output: "categorie", timeout: 120,
    description: "Range un texte (ou chaque élément d'une liste) dans une des catégories données. La réponse est toujours une des catégories.",
    params: [...CONN, { name: "texte", label: "Texte, ou liste", required: true, help: "Ex. {{sujet}} ou {{mails}}" },
      { name: "champ", label: "Champ à lire dans chaque élément (si liste)", default: "titre" },
      { name: "categories", label: "Catégories", required: true, help: "Séparées par des virgules. Ex. urgent, à lire, pub" },
      { name: "champ_resultat", label: "Champ ajouté à chaque élément (si liste)", default: "categorie" }],
    run: async (p, ctx, api) => {
      const cats = String(p.categories).split(",").map((s) => s.trim()).filter(Boolean);
      const one = async (t) => {
        const r = await chat({ ...p, temperature: 0 }, api, [{ role: "system", content: `Classe le texte dans UNE seule catégorie parmi : ${cats.join(" | ")}. Réponds en JSON {"categorie":"…"}.` }, { role: "user", content: String(t).slice(0, 6000) }], true);
        const c = String((r && r.categorie) || "").trim();
        return cats.find((x) => x.toLowerCase() === c.toLowerCase()) || cats[cats.length - 1];
      };
      if (Array.isArray(p.texte)) { const out = []; for (const it of asList(p.texte)) out.push({ ...it, [p.champ_resultat || "categorie"]: await one(it[p.champ] ?? JSON.stringify(it)) }); return out; }
      return one(p.texte);
    },
  },
  {
    name: "dzf_ia_resumer", label: "IA : résumer", category: "IA", icon: "fas fa-compress-alt", output: "resume", timeout: 180,
    description: "Résume un texte ou une liste (ex. les titres du jour) en quelques phrases ou puces.",
    params: [...CONN, { name: "contenu", label: "Texte ou liste", required: true }, { name: "champ", label: "Champ à lire (si liste)", default: "titre" },
      { name: "consigne", label: "Consigne", default: "Fais un résumé en 5 puces maximum, en français simple." }],
    run: async (p, ctx, api) => {
      const txt = Array.isArray(p.contenu) ? p.contenu.map((x) => `- ${typeof x === "object" ? x[p.champ] ?? JSON.stringify(x) : x}`).join("\n") : String(p.contenu);
      return chat(p, api, [{ role: "system", content: p.consigne }, { role: "user", content: txt.slice(0, 24000) }], false);
    },
  },
];
