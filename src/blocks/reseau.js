/* Blocs « Réseau » : appeler une API, lire des flux RSS / YouTube. */
"use strict";
const { asList, pool } = require("../engine");
const { resolveYoutube, youtubeFeed, httpGet, pageImage, readFeed } = require("../lib/feeds");

const secret = async (api, name) => { const v = await api.secret(name); if (name && !v) throw Object.assign(new Error(`secret ${name} introuvable (variable d'environnement ou coffre)`), { permanent: true }); return v; };

const request = async (p, api) => {
  const headers = { Accept: "application/json, text/plain, */*", ...(p.entetes || {}) };
  if (p.auth === "Bearer (secret)") headers.Authorization = `Bearer ${await secret(api, p.variable_secret)}`;
  if (p.auth === "Basic (secret user:motdepasse)") headers.Authorization = `Basic ${Buffer.from(await secret(api, p.variable_secret)).toString("base64")}`;
  if (p.auth === "En-tête perso (secret)") headers[p.nom_entete || "X-API-Key"] = await secret(api, p.variable_secret);
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
      { name: "auth", label: "Authentification", type: "select", options: ["aucune", "Bearer (secret)", "Basic (secret user:motdepasse)", "En-tête perso (secret)"], default: "aucune" },
      { name: "variable_secret", label: "Nom du secret (variable d'env. ou coffre)", help: "Ex. MON_API_TOKEN" },
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
    name: "dzf_images_articles", label: "Articles : trouver une image", category: "Réseau", icon: "far fa-image", output: "articles", timeout: 120,
    description: "Pour chaque élément sans image (ex. articles d'un flux RSS), lit sa page et prend l'image de partage (og:image, twitter:image…). En parallèle, avec une limite, sans bloquer si une page ne répond pas.",
    params: [
      { name: "liste", label: "Éléments", required: true, help: "Ex. {{nouveaux}}" },
      { name: "champ_url", label: "Champ du lien", default: "url" }, { name: "champ_image", label: "Champ de l'image", default: "image" },
      { name: "max", label: "Pages lues au maximum", type: "int", default: 40, help: "Les autres gardent leur image vide" },
      { name: "en_parallele", label: "En même temps", type: "int", default: 6 }, { name: "delai_s", label: "Abandon d'une page après (s)", type: "int", default: 8 },
    ],
    run: async (p) => {
      const list = asList(p.liste).map((x) => ({ ...x }));
      const todo = list.filter((x) => x && !x[p.champ_image || "image"] && /^https?:/i.test(String(x[p.champ_url || "url"] || ""))).slice(0, Math.max(0, +p.max || 40));
      await pool(todo, Math.min(16, +p.en_parallele || 6), async (x) => {
        const u = x[p.champ_url || "url"];
        try { x[p.champ_image || "image"] = pageImage(await httpGet(u, { timeout: (+p.delai_s || 8) * 1000, headers: { Accept: "text/html,*/*;q=0.5" } }), u); } catch (e) { /* page muette : pas d'image */ }
      });
      return list;
    },
  },
  {
    name: "dzf_rss", label: "Lire des flux RSS / Atom / YouTube", category: "Réseau", icon: "fas fa-rss", output: "articles", timeout: 120,
    description: "Lit un ou plusieurs flux en parallèle (limité), nettoie le HTML, et renvoie une liste d'éléments {titre, url, date, resume, image, auteur, video_id, type, source}. Les sources en erreur sont listées à part, sans bloquer les autres.",
    params: [
      { name: "sources", label: "Sources", required: true, help: "Une adresse, ou une liste (ex. {{lignes}} d'une table de sources)" },
      { name: "champ_url", label: "Champ de l'adresse dans chaque source", default: "url" },
      { name: "champ_chaine", label: "Champ de la chaîne YouTube (@nom ou UC…)", default: "chaine" },
      { name: "champs_source", label: "Champs de la source recopiés dans chaque élément", help: "Ex. theme,langue → item.source_theme, item.source_langue" },
      { name: "max_par_source", label: "Éléments max par source", type: "int", default: 30 },
      { name: "en_parallele", label: "Sources lues en même temps", type: "int", default: 4 },
    ],
    run: async (p, ctx, api) => {
      const sources = asList(p.sources).map((s) => (typeof s === "string" ? { url: s } : s));
      const erreurs = [], chaines = [];
      const copy = String(p.champs_source || "").split(",").map((x) => x.trim()).filter(Boolean);
      const lists = await pool(sources, +p.en_parallele || 4, async (s) => {
        try {
          let url = s[p.champ_url || "url"];
          const ch = s[p.champ_chaine || "chaine"] || s.youtube_id;
          if (!url && ch) {
            let id = s.youtube_id;
            if (!id) { id = await resolveYoutube(ch); chaines.push({ source: s.id, youtube_id: id }); }
            url = youtubeFeed(id);
          }
          if (!url) throw new Error("pas d'adresse");
          const lu = await readFeed(url);
          if (lu.trouve) chaines.push({ source: s.id, flux: lu.url });
          return lu.items.slice(0, +p.max_par_source || 30).map((it) => ({ ...it, type: it.video_id ? "vidéo" : "article", source: s.id ?? url, source_nom: s.nom || "", ...Object.fromEntries(copy.map((c) => [`source_${c}`, s[c]])) }));
        } catch (e) { erreurs.push({ source: s.id ?? s.url, nom: s.nom || s.url, erreur: e.message }); return []; }
      });
      /* <sortie> : les éléments ; <sortie>_erreurs : les sources en erreur ;
         <sortie>_chaines : les identifiants YouTube trouvés (à enregistrer pour ne plus les chercher) */
      return { __merge: { [api.out]: lists.flat(), [`${api.out}_erreurs`]: erreurs, [`${api.out}_chaines`]: chaines } };
    },
  },
  {
    name: "dzf_youtube_chaine", label: "YouTube : identifiant de chaîne", category: "Réseau", icon: "fab fa-youtube", output: "chaine_id",
    description: "Trouve l'identifiant UC… d'une chaîne à partir de son @nom ou de son lien.",
    params: [{ name: "chaine", label: "Chaîne", required: true, help: "@nom ou lien" }],
    run: async (p) => resolveYoutube(p.chaine),
  },
];
