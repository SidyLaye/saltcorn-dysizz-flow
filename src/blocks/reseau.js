/* Blocs « Réseau » : appeler une API, lire des flux RSS / YouTube. */
"use strict";
const { asList, pool } = require("../engine");
const { parseFeed, resolveYoutube, youtubeFeed, httpGet } = require("../lib/feeds");

const secret = (api, name) => { const v = api.env(name); if (name && !v) throw new Error(`variable d'environnement ${name} absente du serveur`); return v; };

const request = async (p, api) => {
  const headers = { Accept: "application/json, text/plain, */*", ...(p.entetes || {}) };
  if (p.auth === "Bearer (variable d'env)") headers.Authorization = `Bearer ${secret(api, p.variable_secret)}`;
  if (p.auth === "Basic (variable d'env user:motdepasse)") headers.Authorization = `Basic ${Buffer.from(secret(api, p.variable_secret)).toString("base64")}`;
  if (p.auth === "En-tête perso (variable d'env)") headers[p.nom_entete || "X-API-Key"] = secret(api, p.variable_secret);
  let body;
  if (p.corps !== undefined && p.corps !== "" && !["GET", "HEAD"].includes(p.methode)) {
    if (p.type_corps === "formulaire") { body = new URLSearchParams(p.corps).toString(); headers["Content-Type"] = "application/x-www-form-urlencoded"; }
    else if (p.type_corps === "texte") { body = typeof p.corps === "string" ? p.corps : JSON.stringify(p.corps); headers["Content-Type"] = headers["Content-Type"] || "text/plain"; }
    else { body = typeof p.corps === "string" ? p.corps : JSON.stringify(p.corps); headers["Content-Type"] = "application/json"; }
  }
  const r = await fetch(p.url, { method: p.methode || "GET", headers, body, redirect: "follow" });
  const txt = await r.text();
  let data = txt;
  if (p.reponse !== "texte") { try { data = JSON.parse(txt); } catch (e) { data = txt; } }
  return { status: r.status, ok: r.ok, data, entetes: Object.fromEntries([...r.headers.entries()].filter(([k]) => /^(content-type|location|retry-after|x-ratelimit)/i.test(k))) };
};

module.exports = [
  {
    name: "dzf_http", label: "HTTP : appeler une API", category: "Réseau", icon: "fas fa-globe", output: "http", timeout: 60,
    description: "Appelle n'importe quelle API (GET, POST…). Le secret (jeton, clé) se lit dans une variable d'environnement, jamais dans la base. Réessaie tout seul si l'API répond 429 ou 5xx.",
    params: [
      { name: "methode", label: "Méthode", type: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"], default: "GET" },
      { name: "url", label: "Adresse", required: true, help: "Ex. https://api.exemple.com/items?q={{recherche}}" },
      { name: "entetes", label: "En-têtes (JSON)", type: "json" },
      { name: "corps", label: "Corps (JSON ou texte)", type: "json" },
      { name: "type_corps", label: "Type du corps", type: "select", options: ["json", "formulaire", "texte"], default: "json" },
      { name: "auth", label: "Authentification", type: "select", options: ["aucune", "Bearer (variable d'env)", "Basic (variable d'env user:motdepasse)", "En-tête perso (variable d'env)"], default: "aucune" },
      { name: "variable_secret", label: "Variable d'environnement du secret", help: "Ex. MON_API_TOKEN" },
      { name: "nom_entete", label: "Nom de l'en-tête perso", default: "X-API-Key" },
      { name: "reponse", label: "Réponse", type: "select", options: ["json", "texte"], default: "json" },
      { name: "essais", label: "Essais max", type: "int", default: 3 },
      { name: "erreur_si_pas_ok", label: "Erreur si le code n'est pas 2xx", type: "bool", default: true },
    ],
    run: async (p, ctx, api) => {
      let last;
      for (let i = 1; i <= Math.max(1, +p.essais || 1); i++) {
        last = await request(p, api).catch((e) => ({ status: 0, ok: false, data: e.message }));
        if (last.ok || (last.status && last.status < 500 && last.status !== 429)) break;
        const wait = Math.min(30, Number(last.entetes && last.entetes["retry-after"]) || 2 ** i);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
      if (!last.ok && p.erreur_si_pas_ok !== false) throw new Error(`HTTP ${last.status} ${typeof last.data === "string" ? last.data.slice(0, 200) : JSON.stringify(last.data).slice(0, 200)}`);
      return last;
    },
  },
  {
    name: "dzf_rss", label: "Lire des flux RSS / Atom / YouTube", category: "Réseau", icon: "fas fa-rss", output: "articles", timeout: 120,
    description: "Lit un ou plusieurs flux en parallèle (limité), nettoie le HTML, et renvoie une liste d'éléments {titre, url, date, resume, image, auteur, video_id, source}. Les sources en erreur sont listées à part, sans bloquer les autres.",
    params: [
      { name: "sources", label: "Sources", required: true, help: "Une adresse, ou une liste (ex. {{lignes}} d'une table de sources)" },
      { name: "champ_url", label: "Champ de l'adresse dans chaque source", default: "url" },
      { name: "champ_chaine", label: "Champ de la chaîne YouTube (@nom ou UC…)", default: "chaine" },
      { name: "max_par_source", label: "Éléments max par source", type: "int", default: 30 },
      { name: "en_parallele", label: "Sources lues en même temps", type: "int", default: 4 },
    ],
    run: async (p, ctx, api) => {
      const sources = asList(p.sources).map((s) => (typeof s === "string" ? { url: s } : s));
      const erreurs = [];
      const lists = await pool(sources, +p.en_parallele || 4, async (s) => {
        try {
          let url = s[p.champ_url || "url"];
          const ch = s[p.champ_chaine || "chaine"] || s.youtube_id;
          if (!url && ch) url = youtubeFeed(s.youtube_id || (await resolveYoutube(ch)));
          if (!url) throw new Error("pas d'adresse");
          return parseFeed(await httpGet(url)).slice(0, +p.max_par_source || 30).map((it) => ({ ...it, source: s.id ?? url, source_nom: s.nom || "" }));
        } catch (e) { erreurs.push({ source: s.id ?? s.url, nom: s.nom || s.url, erreur: e.message }); return []; }
      });
      /* les éléments dans <sortie>, les sources en erreur dans <sortie>_erreurs */
      return { __merge: { [api.out]: lists.flat(), [`${api.out}_erreurs`]: erreurs } };
    },
  },
  {
    name: "dzf_youtube_chaine", label: "YouTube : identifiant de chaîne", category: "Réseau", icon: "fab fa-youtube", output: "chaine_id",
    description: "Trouve l'identifiant UC… d'une chaîne à partir de son @nom ou de son lien.",
    params: [{ name: "chaine", label: "Chaîne", required: true, help: "@nom ou lien" }],
    run: async (p) => resolveYoutube(p.chaine),
  },
];
