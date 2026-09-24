/* Fichiers binaires dans un workflow : on les passe d'un bloc à l'autre sous la
   forme { nom, type, base64 } ou par le chemin d'un fichier Saltcorn. */
"use strict";

const MAX = 50 * 1024 * 1024;

/* charge un fichier : chemin Saltcorn, URL http(s), objet {base64}, data: URI ou texte */
const charger = async (src, { max = MAX, texte = true } = {}) => {
  if (src && typeof src === "object" && !Buffer.isBuffer(src)) {
    if (src.base64 !== undefined) return { nom: src.nom || "fichier", type: src.type || "application/octet-stream", buf: Buffer.from(String(src.base64), "base64") };
    if (src.chemin) return charger(src.chemin, { max, texte });
  }
  if (Buffer.isBuffer(src)) return { nom: "fichier", type: "application/octet-stream", buf: src };
  const s = String(src ?? "");
  const m = s.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (m) return { nom: "fichier", type: m[1] || "application/octet-stream", buf: m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3])) };
  if (/^https?:\/\//i.test(s)) {
    const r = await fetch(s, { headers: { "User-Agent": "dysizz-flow/2" } });
    if (!r.ok) throw new Error(`téléchargement : HTTP ${r.status}`);
    const len = +r.headers.get("content-length") || 0;
    if (len > max) throw Object.assign(new Error("fichier trop gros"), { permanent: true });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > max) throw Object.assign(new Error("fichier trop gros"), { permanent: true });
    return { nom: decodeURIComponent(new URL(r.url).pathname.split("/").pop() || "fichier"), type: (r.headers.get("content-type") || "application/octet-stream").split(";")[0], buf };
  }
  try {
    const File = require("@saltcorn/data/models/file");
    const f = s && !s.includes("\n") && s.length < 400 ? await File.findOne(s.replace(/^\/files\/serve\//, "")) : null;
    if (f) {
      if (f.size_kb && f.size_kb * 1024 > max) throw Object.assign(new Error("fichier trop gros"), { permanent: true });
      return { nom: f.filename, type: f.mimetype || "application/octet-stream", buf: await f.get_contents() };
    }
  } catch (e) { if (e.permanent) throw e; }
  if (!texte) throw Object.assign(new Error(`fichier « ${s.slice(0, 80)} » introuvable`), { permanent: true });
  return { nom: "texte.txt", type: "text/plain", buf: Buffer.from(s, "utf8") };
};

const propre = (n) => String(n || "fichier").replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "fichier";

/* enregistre dans les fichiers Saltcorn, renvoie { chemin, nom, octets, type } */
const enregistrer = async (api, nom, type, buf, { dossier = "/", role = 1 } = {}) => {
  const File = require("@saltcorn/data/models/file");
  const n = propre(nom);
  const f = await File.from_contents(n, type || "application/octet-stream", buf, api.user ? api.user.id : null, +role || 1, dossier || "/");
  return { chemin: f.path_to_serve || f.location, nom: n, octets: buf.length, type };
};

/* sortie : fichier Saltcorn ou base64 selon le choix de l'utilisateur */
const sortie = async (api, p, nom, type, buf) =>
  p.sortie_fichier === "base64 (dans le workflow)" ? { nom: propre(nom), type, octets: buf.length, base64: buf.toString("base64") } : enregistrer(api, nom, type, buf, { dossier: p.dossier, role: p.role_lecture });

const PARAMS_SORTIE = [
  { name: "sortie_fichier", label: "Résultat", type: "select", options: ["fichier Saltcorn", "base64 (dans le workflow)"], default: "fichier Saltcorn" },
  { name: "dossier", label: "Dossier (fichier Saltcorn)", default: "/", showIf: { sortie_fichier: "fichier Saltcorn" } },
  { name: "role_lecture", label: "Lisible par le rôle (1 = admin)", type: "int", default: 1, showIf: { sortie_fichier: "fichier Saltcorn" } },
];

const MIME = { txt: "text/plain", csv: "text/csv", json: "application/json", html: "text/html", xml: "application/xml", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", zip: "application/zip", md: "text/markdown", mp3: "audio/mpeg", mp4: "video/mp4", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", glb: "model/gltf-binary", gltf: "model/gltf+json" };
const mimeDe = (nom) => MIME[String(nom).split(".").pop().toLowerCase()] || "application/octet-stream";

module.exports = { charger, enregistrer, sortie, propre, PARAMS_SORTIE, mimeDe, MAX };
