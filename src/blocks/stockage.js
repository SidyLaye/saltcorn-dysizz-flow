/* Stockage : S3 (AWS, OVH, Scaleway, MinIO, R2…), archives ZIP, WebDAV
   (Nextcloud, kDrive…), IPFS, et conversions base64. */
"use strict";
const crypto = require("crypto");
const s3 = require("../lib/s3");
const { writeZip, readZip } = require("../lib/zip");
const { charger, sortie, PARAMS_SORTIE, mimeDe, propre } = require("../lib/fichiers");

const need = async (api, name) => { const v = await api.secret(name); if (!v) throw Object.assign(new Error(`secret ${name} introuvable (variable d'environnement ou coffre)`), { permanent: true }); return v; };
const perm = (m) => Object.assign(new Error(m), { permanent: true });

const S3P = [
  { name: "point", label: "Adresse du service S3", default: "https://s3.gra.io.cloud.ovh.net", help: "AWS : https://s3.eu-west-3.amazonaws.com · OVH : https://s3.gra.io.cloud.ovh.net · Scaleway : https://s3.fr-par.scw.cloud · MinIO : https://minio.mondomaine.fr" },
  { name: "region", label: "Région", default: "gra", help: "Ex. eu-west-3, gra, fr-par, auto (R2)" },
  { name: "seau", label: "Bucket (seau)", required: true },
  { name: "cles", label: "Secret des clés", default: "S3_CLES", help: "Nom d'un secret du coffre contenant « CLÉ_D_ACCÈS:CLÉ_SECRÈTE »" },
  { name: "style", label: "Adresse du bucket", type: "select", options: ["chemin", "domaine"], default: "chemin", help: "« chemin » marche partout (MinIO, OVH…). « domaine » : bucket.s3…" },
];
const cfgS3 = async (p, api) => {
  const raw = await need(api, p.cles || "S3_CLES");
  const i = raw.indexOf(":");
  if (i < 1) throw perm(`le secret ${p.cles} doit être « CLÉ_D_ACCÈS:CLÉ_SECRÈTE »`);
  return { endpoint: p.point, region: p.region || "us-east-1", bucket: p.seau, access: raw.slice(0, i).trim(), secret: raw.slice(i + 1).trim(), style: p.style };
};

const WEBDAV = [
  { name: "adresse", label: "Adresse WebDAV", required: true, help: "Nextcloud : https://cloud.exemple.fr/remote.php/dav/files/UTILISATEUR/" },
  { name: "identifiants", label: "Secret des identifiants", default: "WEBDAV", help: "Secret du coffre « utilisateur:mot_de_passe » (mot de passe d'application conseillé)" },
];
const davAuth = async (p, api) => "Basic " + Buffer.from(await need(api, p.identifiants || "WEBDAV")).toString("base64");
const davUrl = (base, chemin) => String(base).replace(/\/?$/, "/") + String(chemin || "").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");

module.exports = [
  /* ---------------- S3 ---------------- */
  {
    name: "dzf_s3_lister", label: "S3 : lister un dossier", category: "Stockage", icon: "fas fa-bucket", output: "s3_liste", timeout: 60,
    description: "Liste les fichiers d'un bucket S3 (AWS, OVH, Scaleway, MinIO, Cloudflare R2…) sous un préfixe, avec taille et date.",
    params: [...S3P, { name: "prefixe", label: "Dossier (préfixe)", default: "", help: "Ex. factures/2026/" }, { name: "max", label: "Nombre max", type: "int", default: 1000 }],
    run: async (p, ctx, api) => s3.list(await cfgS3(p, api), p.prefixe || "", Math.min(10000, +p.max || 1000)),
  },
  {
    name: "dzf_s3_envoyer", label: "S3 : envoyer un fichier", category: "Stockage", icon: "fas fa-cloud-upload-alt", output: "s3_envoi", timeout: 300,
    description: "Dépose un fichier dans un bucket S3. Source : un fichier Saltcorn, une URL, un base64 venu d'un autre bloc ou du texte.",
    params: [...S3P, { name: "source", label: "Fichier à envoyer", required: true, help: "Ex. {{facture.chemin}}, https://…, {{archive}} ou du texte" }, { name: "cle", label: "Nom dans le bucket", help: "Ex. factures/{{numero}}.pdf — vide = nom d'origine" },
      { name: "public", label: "Lisible par tous (public-read)", type: "bool", default: false }],
    run: async (p, ctx, api) => {
      const cfg = await cfgS3(p, api);
      const f = await charger(p.source);
      const key = String(p.cle || f.nom).replace(/^\/+/, "");
      const type = f.type && f.type !== "application/octet-stream" ? f.type : mimeDe(key);
      const r = await s3.request(cfg, "PUT", key, { body: f.buf, headers: { "content-type": type, ...(p.public ? { "x-amz-acl": "public-read" } : {}) } });
      return { cle: key, octets: f.buf.length, type, etag: String(r.headers.get("etag") || "").replace(/"/g, ""), url: s3.target(cfg, key).toString() };
    },
  },
  {
    name: "dzf_s3_lire", label: "S3 : récupérer un fichier", category: "Stockage", icon: "fas fa-cloud-download-alt", output: "s3_fichier", timeout: 300,
    description: "Télécharge un fichier d'un bucket S3 : en fichier Saltcorn, en base64 pour le bloc suivant, ou en texte.",
    params: [...S3P, { name: "cle", label: "Nom dans le bucket", required: true }, { name: "en_texte", label: "Lire comme texte (CSV, JSON…)", type: "bool", default: false }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      const cfg = await cfgS3(p, api);
      const r = await s3.request(cfg, "GET", p.cle);
      const buf = Buffer.from(await r.arrayBuffer());
      const type = (r.headers.get("content-type") || mimeDe(p.cle)).split(";")[0];
      if (p.en_texte) { const t = buf.toString("utf8"); if (/json/.test(type) || /\.json$/i.test(p.cle)) { try { return JSON.parse(t); } catch (e) { /* texte */ } } return t; }
      return sortie(api, p, String(p.cle).split("/").pop(), type, buf);
    },
  },
  {
    name: "dzf_s3_supprimer", label: "S3 : supprimer un fichier", category: "Stockage", icon: "fas fa-trash-alt", output: "s3_suppression",
    description: "Supprime un fichier d'un bucket S3 (sans erreur s'il n'existe déjà plus).",
    params: [...S3P, { name: "cle", label: "Nom dans le bucket", required: true }],
    run: async (p, ctx, api) => { await s3.request(await cfgS3(p, api), "DELETE", p.cle); return { supprime: p.cle }; },
  },
  {
    name: "dzf_s3_lien", label: "S3 : lien temporaire", category: "Stockage", icon: "fas fa-link", output: "s3_lien",
    description: "Fabrique un lien signé valable un temps limité : pour télécharger un fichier privé, ou pour qu'un navigateur dépose un fichier directement dans le bucket.",
    params: [...S3P, { name: "cle", label: "Nom dans le bucket", required: true }, { name: "usage", label: "Pour", type: "select", options: ["télécharger", "déposer"], default: "télécharger" }, { name: "duree", label: "Valable (minutes)", type: "int", default: 60 }],
    run: async (p, ctx, api) => ({ url: s3.presign(await cfgS3(p, api), p.usage === "déposer" ? "PUT" : "GET", p.cle, (+p.duree || 60) * 60), expire: new Date(Date.now() + (+p.duree || 60) * 60000).toISOString() }),
  },
  {
    name: "dzf_s3_copier", label: "S3 : copier / déplacer", category: "Stockage", icon: "fas fa-copy", output: "s3_copie", timeout: 120,
    description: "Copie un fichier à l'intérieur du bucket (ou d'un bucket à l'autre sur le même service), et le supprime à l'origine si « déplacer ».",
    params: [...S3P, { name: "de", label: "Depuis (nom)", required: true }, { name: "vers", label: "Vers (nom)", required: true }, { name: "seau_source", label: "Bucket source (si différent)" }, { name: "deplacer", label: "Déplacer (supprimer l'original)", type: "bool", default: false }],
    run: async (p, ctx, api) => {
      const cfg = await cfgS3(p, api);
      const src = `/${p.seau_source || p.seau}/${String(p.de).replace(/^\/+/, "")}`.split("/").map(encodeURIComponent).join("/");
      await s3.request(cfg, "PUT", p.vers, { headers: { "x-amz-copy-source": src } });
      if (p.deplacer) await s3.request({ ...cfg, bucket: p.seau_source || p.seau }, "DELETE", p.de);
      return { de: p.de, vers: p.vers, deplace: !!p.deplacer };
    },
  },

  /* ---------------- ZIP ---------------- */
  {
    name: "dzf_zip", label: "ZIP : créer une archive", category: "Stockage", icon: "fas fa-file-archive", output: "archive", timeout: 300,
    description: "Met plusieurs fichiers dans un .zip. Chaque élément : un chemin de fichier Saltcorn, une URL, {nom, base64} ou {nom, contenu} (texte).",
    params: [{ name: "fichiers", label: "Fichiers (liste)", type: "json", required: true, help: 'Ex. {{factures}} ou [{"nom":"lisez-moi.txt","contenu":"Bonjour"}, "https://…/logo.png"]' },
      { name: "nom", label: "Nom de l'archive", default: "archive.zip" }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      let list = p.fichiers;
      if (typeof list === "string") { try { list = JSON.parse(list); } catch (e) { list = [list]; } }
      if (!Array.isArray(list)) list = [list];
      if (list.length > 2000) throw perm("trop de fichiers (2000 max)");
      const files = [], seen = new Set();
      for (const it of list) {
        let nom, buf;
        if (it && typeof it === "object" && it.contenu !== undefined && it.base64 === undefined) { nom = it.nom || "fichier.txt"; buf = Buffer.from(typeof it.contenu === "string" ? it.contenu : JSON.stringify(it.contenu, null, 1)); }
        else { const f = await charger(it, { texte: false }); nom = (it && it.nom) || f.nom; buf = f.buf; }
        nom = String(nom).replace(/\.\.+\//g, "").replace(/^\/+/, "");
        let n = nom, i = 1;
        while (seen.has(n)) n = nom.replace(/(\.[^.]*)?$/, (x) => `-${i++}${x || ""}`);
        seen.add(n);
        files.push({ nom: n, contenu: buf });
      }
      const nom = /\.zip$/i.test(p.nom || "") ? p.nom : `${p.nom || "archive"}.zip`;
      return sortie(api, p, nom, "application/zip", writeZip(files));
    },
  },
  {
    name: "dzf_dezipper", label: "ZIP : ouvrir une archive", category: "Stockage", icon: "fas fa-box-open", output: "contenu_zip", timeout: 300,
    description: "Ouvre un .zip et rend la liste de ses fichiers (texte lisible directement, sinon base64 ou fichiers Saltcorn). Protégé contre les « bombes ZIP ».",
    params: [{ name: "archive", label: "Archive", required: true, help: "Chemin Saltcorn, URL ou {{archive}}" }, { name: "filtre", label: "Garder seulement (motif)", help: "Ex. .csv ou factures/" },
      { name: "max_mo", label: "Taille max décompressée (Mo)", type: "int", default: 200 }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      const f = await charger(p.archive, { texte: false });
      const items = readZip(f.buf, { maxSize: Math.min(2000, +p.max_mo || 200) * 1024 * 1024 }).filter((x) => !p.filtre || x.nom.includes(p.filtre));
      const TXT = /\.(txt|csv|json|md|xml|html?|ya?ml|ini|log|svg|js|css|tsv)$/i;
      const out = [];
      for (const x of items) {
        const base = { nom: x.nom, octets: x.contenu.length };
        if (TXT.test(x.nom) && x.contenu.length < 2e6) out.push({ ...base, texte: x.contenu.toString("utf8") });
        else out.push({ ...base, ...(await sortie(api, p, x.nom.split("/").pop(), mimeDe(x.nom), x.contenu)) });
      }
      return out;
    },
  },

  /* ---------------- WebDAV ---------------- */
  {
    name: "dzf_webdav", label: "WebDAV : fichiers (Nextcloud, kDrive…)", category: "Stockage", icon: "fas fa-folder-open", output: "webdav", timeout: 300,
    description: "Lister, lire, envoyer, supprimer ou créer un dossier sur un stockage WebDAV : Nextcloud, ownCloud, Infomaniak kDrive, Synology, Box…",
    params: [...WEBDAV, { name: "action", label: "Action", type: "select", options: ["lister", "lire", "envoyer", "supprimer", "créer un dossier"], default: "lister" },
      { name: "chemin", label: "Chemin", default: "", help: "Ex. Documents/Factures/2026.pdf" }, { name: "source", label: "Fichier à envoyer", showIf: { action: "envoyer" }, help: "Chemin Saltcorn, URL, {{archive}} ou texte" }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      const Authorization = await davAuth(p, api);
      const url = davUrl(p.adresse, p.chemin);
      const go = async (method, opt = {}) => {
        const r = await fetch(url, { method, ...opt, headers: { Authorization, ...(opt.headers || {}) } });
        if (!r.ok && r.status !== 207) throw Object.assign(new Error(`WebDAV : HTTP ${r.status}`), { permanent: [401, 403, 404].includes(r.status) });
        return r;
      };
      if (p.action === "lister") {
        const t = await (await go("PROPFIND", { headers: { Depth: "1", "Content-Type": "application/xml" }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/><d:resourcetype/><d:getcontenttype/></d:prop></d:propfind>' })).text();
        const base = decodeURIComponent(new URL(url).pathname).replace(/\/$/, "");
        return (t.match(/<(\w+:)?response[\s>][\s\S]*?<\/(\w+:)?response>/g) || []).map((b) => {
          const g = (tag) => { const m = b.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`)); return m ? m[1] : ""; };
          const href = decodeURIComponent(g("href"));
          return { nom: href.replace(/\/$/, "").split("/").pop(), chemin: href, dossier: /collection/.test(g("resourcetype")), octets: +g("getcontentlength") || 0, modifie: g("getlastmodified"), type: g("getcontenttype") };
        }).filter((x) => x.chemin.replace(/\/$/, "") !== base);
      }
      if (p.action === "lire") { const r = await go("GET"); return sortie(api, p, String(p.chemin).split("/").pop(), (r.headers.get("content-type") || mimeDe(p.chemin)).split(";")[0], Buffer.from(await r.arrayBuffer())); }
      if (p.action === "envoyer") { const f = await charger(p.source); await go("PUT", { body: f.buf, headers: { "Content-Type": f.type } }); return { envoye: p.chemin, octets: f.buf.length }; }
      if (p.action === "supprimer") { await go("DELETE"); return { supprime: p.chemin }; }
      await go("MKCOL"); return { cree: p.chemin };
    },
  },

  /* ---------------- IPFS ---------------- */
  {
    name: "dzf_ipfs", label: "IPFS : publier ou lire", category: "Stockage", icon: "fas fa-cubes", output: "ipfs", timeout: 180,
    description: "Publie un fichier sur IPFS (stockage décentralisé, adresse = empreinte du contenu) via Pinata, Filebase ou ton propre nœud Kubo, ou lit un fichier par son CID.",
    params: [{ name: "action", label: "Action", type: "select", options: ["publier", "lire"], default: "publier" },
      { name: "service", label: "Service", type: "select", options: ["Pinata", "nœud Kubo (API)"], default: "Pinata", showIf: { action: "publier" } },
      { name: "cle", label: "Secret (jeton Pinata ou « utilisateur:mdp » du nœud)", default: "PINATA_JWT", showIf: { action: "publier" } },
      { name: "noeud", label: "Adresse de l'API du nœud Kubo", default: "http://ipfs:5001", showIf: { service: "nœud Kubo (API)" } },
      { name: "source", label: "Fichier à publier", showIf: { action: "publier" } }, { name: "nom", label: "Nom", showIf: { action: "publier" } },
      { name: "cid", label: "CID à lire", showIf: { action: "lire" } }, { name: "passerelle", label: "Passerelle de lecture", default: "https://ipfs.io/ipfs/", showIf: { action: "lire" } }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      if (p.action === "lire") {
        const cid = String(p.cid || "").replace(/^ipfs:\/\//, "").trim();
        if (!/^[a-zA-Z0-9]{20,}(\/.*)?$/.test(cid)) throw perm("CID invalide");
        const r = await fetch(String(p.passerelle || "https://ipfs.io/ipfs/").replace(/\/?$/, "/") + cid);
        if (!r.ok) throw new Error(`IPFS : HTTP ${r.status}`);
        const type = (r.headers.get("content-type") || "application/octet-stream").split(";")[0];
        const buf = Buffer.from(await r.arrayBuffer());
        if (/json|text/.test(type) && buf.length < 2e6) { const t = buf.toString("utf8"); try { return JSON.parse(t); } catch (e) { return t; } }
        return sortie(api, p, cid.split("/").pop(), type, buf);
      }
      const f = await charger(p.source);
      const nom = propre(p.nom || f.nom);
      const fd = new FormData();
      fd.append("file", new Blob([f.buf], { type: f.type }), nom);
      let cid;
      if (p.service === "Pinata") {
        const r = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", { method: "POST", headers: { Authorization: `Bearer ${await need(api, p.cle || "PINATA_JWT")}` }, body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`Pinata : HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
        cid = j.IpfsHash;
      } else {
        const sec = await api.secret(p.cle);
        const r = await fetch(String(p.noeud).replace(/\/$/, "") + "/api/v0/add?pin=true&cid-version=1", { method: "POST", body: fd, headers: sec ? { Authorization: "Basic " + Buffer.from(sec).toString("base64") } : {} });
        if (!r.ok) throw new Error(`IPFS : HTTP ${r.status}`);
        cid = (await r.json()).Hash;
      }
      return { cid, url: `ipfs://${cid}`, passerelle: `https://ipfs.io/ipfs/${cid}`, octets: f.buf.length };
    },
  },

  /* ---------------- conversions ---------------- */
  {
    name: "dzf_base64", label: "Fichier : base64, empreinte, taille", category: "Stockage", icon: "fas fa-exchange-alt", output: "conversion",
    description: "Transforme un fichier ou un texte : en base64 / depuis base64, data: URI, ou calcule son empreinte (SHA-256, MD5…) pour vérifier qu'il n'a pas changé.",
    params: [{ name: "source", label: "Fichier ou texte", required: true }, { name: "operation", label: "Opération", type: "select", options: ["vers base64", "depuis base64 (texte)", "depuis base64 (fichier)", "data: URI", "empreinte"], default: "vers base64" },
      { name: "algo", label: "Algorithme", type: "select", options: ["sha256", "sha512", "sha1", "md5"], default: "sha256", showIf: { operation: "empreinte" } }, { name: "nom", label: "Nom du fichier", default: "fichier.bin", showIf: { operation: "depuis base64 (fichier)" } }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      if (p.operation.startsWith("depuis base64")) {
        const buf = Buffer.from(String(p.source && p.source.base64 !== undefined ? p.source.base64 : p.source).replace(/^data:[^,]*,/, ""), "base64");
        return p.operation.endsWith("(texte)") ? buf.toString("utf8") : sortie(api, p, p.nom, mimeDe(p.nom), buf);
      }
      const f = await charger(p.source);
      if (p.operation === "empreinte") return { algo: p.algo, hex: crypto.createHash(p.algo).update(f.buf).digest("hex"), octets: f.buf.length };
      if (p.operation === "data: URI") return `data:${f.type};base64,${f.buf.toString("base64")}`;
      return { nom: f.nom, type: f.type, octets: f.buf.length, base64: f.buf.toString("base64") };
    },
  },
];
