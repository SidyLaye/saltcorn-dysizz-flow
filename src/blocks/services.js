/* Blocs « Services » : API publiques utiles et fichiers Saltcorn. */
"use strict";
const { plain, safeUrl } = require("../core");

module.exports = [
  {
    name: "dzf_france_travail", label: "France Travail : offres d'emploi", category: "Services", icon: "fas fa-user-tie", output: "offres", timeout: 90,
    description: "Cherche des offres avec l'API gratuite « Offres d'emploi v2 » (créer une appli sur francetravail.io). Renvoie une liste propre {ref, titre, entreprise, lieu, contrat, salaire, date, url, description}.",
    params: [
      { name: "variable_id", label: "Variable d'env. de l'identifiant", default: "FT_CLIENT_ID" }, { name: "variable_secret", label: "Variable d'env. de la clé", default: "FT_CLIENT_SECRET" },
      { name: "mots_cles", label: "Mots-clés", help: "Ex. devops,kubernetes" }, { name: "departement", label: "Département(s)", help: "Ex. 75 ou 75,92 — vide = France" },
      { name: "commune", label: "Code commune INSEE" }, { name: "rayon_km", label: "Rayon (km)", type: "int" }, { name: "contrat", label: "Contrat (CDI, CDD, MIS…)" },
      { name: "alternance", label: "Alternance seulement", type: "bool" }, { name: "depuis_jours", label: "Publiées depuis (jours)", type: "int", default: 7 },
    ],
    run: async (p, ctx, api) => {
      const id = api.env(p.variable_id), secret = api.env(p.variable_secret);
      if (!id || !secret) throw new Error(`variables ${p.variable_id} / ${p.variable_secret} absentes du serveur`);
      const tr = await fetch("https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret, scope: "api_offresdemploiv2 o2dsoffre" }) });
      const tj = await tr.json().catch(() => ({}));
      if (!tj.access_token) throw new Error(`jeton refusé (${tr.status}) ${tj.error_description || ""}`);
      const q = new URLSearchParams({ range: "0-149", sort: "1", publieeDepuis: String(p.depuis_jours || 7) });
      if (p.mots_cles) q.set("motsCles", p.mots_cles);
      if (p.departement) q.set("departement", p.departement);
      if (p.commune) { q.set("commune", p.commune); if (p.rayon_km) q.set("distance", String(p.rayon_km)); }
      if (p.contrat) q.set("typeContrat", p.contrat);
      if (p.alternance) q.set("natureContrat", "E2,FS");
      const r = await fetch(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${q}`, { headers: { Authorization: `Bearer ${tj.access_token}`, Accept: "application/json" } });
      if (r.status === 204) return [];
      const j = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 206) throw new Error(`recherche refusée (${r.status}) ${j.message || ""}`);
      return (j.resultats || []).map((o) => ({
        ref: String(o.id), titre: plain(o.intitule, 300), entreprise: plain((o.entreprise || {}).nom || "", 200), lieu: plain((o.lieuTravail || {}).libelle || "", 200),
        contrat: plain(o.typeContratLibelle || o.typeContrat || "", 120), salaire: plain((o.salaire || {}).libelle || "", 200), experience: plain(o.experienceLibelle || "", 200),
        date: o.dateCreation || null, url: safeUrl((o.origineOffre || {}).urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`),
        description: plain(o.description || "", 8000), source: "France Travail",
      }));
    },
  },
  {
    name: "dzf_fichier_ecrire", label: "Fichier : enregistrer", category: "Services", icon: "fas fa-save", output: "fichier",
    description: "Enregistre un texte (CSV, JSON, rapport…) comme fichier Saltcorn (local ou S3 selon tes réglages). Renvoie son chemin.",
    params: [{ name: "nom", label: "Nom du fichier", required: true, help: "Ex. export-{{date}}.csv" }, { name: "contenu", label: "Contenu", type: "text", required: true },
      { name: "type", label: "Type", type: "select", options: ["text/csv", "application/json", "text/plain", "text/html", "text/markdown"], default: "text/csv" },
      { name: "dossier", label: "Dossier", default: "/exports" }, { name: "role_lecture", label: "Lisible par le rôle (1 = admin)", type: "int", default: 1 }],
    run: async (p, ctx, api) => {
      const File = require("@saltcorn/data/models/file");
      const safe = String(p.nom).replace(/[^\w.\-]+/g, "_").slice(0, 120);
      const f = await File.from_contents(safe, p.type, Buffer.from(typeof p.contenu === "string" ? p.contenu : JSON.stringify(p.contenu, null, 1)), api.user ? api.user.id : null, +p.role_lecture || 1, p.dossier || "/");
      return f.path_to_serve || f.location || safe;
    },
  },
  {
    name: "dzf_fichier_lire", label: "Fichier : lire", category: "Services", icon: "fas fa-file-alt", output: "contenu",
    description: "Lit le contenu texte d'un fichier Saltcorn (ex. un CSV déposé dans un formulaire).",
    params: [{ name: "fichier", label: "Fichier", required: true, help: "Chemin ou valeur d'un champ Fichier, ex. {{piece}}" }, { name: "max_ko", label: "Taille max (Ko)", type: "int", default: 5000 }],
    run: async (p) => {
      const File = require("@saltcorn/data/models/file");
      const f = await File.findOne(String(p.fichier));
      if (!f) throw new Error("fichier introuvable");
      if (f.size_kb && f.size_kb > (+p.max_ko || 5000)) throw new Error(`fichier trop gros (${f.size_kb} Ko)`);
      return (await f.get_contents()).toString("utf8");
    },
  },
];
