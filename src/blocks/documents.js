/* Documents : PDF (créer, lire, convertir avec Gotenberg), Excel, Word, QR codes,
   Markdown, extraction de texte de n'importe quel fichier (Apache Tika). */
"use strict";
const { charger, sortie, PARAMS_SORTIE } = require("../lib/fichiers");
const { ecrirePdf, mdBlocs, lireTextePdf } = require("../lib/pdf");
const { ecrireXlsx, lireXlsx, lireDocx, ecrireDocx } = require("../lib/xlsx");
const { readZip, writeZip } = require("../lib/zip");
const { getPath } = require("../engine");

const perm = (m) => Object.assign(new Error(m), { permanent: true });
const list = (v) => { if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return null; } } return v; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Markdown → HTML sûr (pas de HTML brut accepté) */
const mdHtml = (md) => {
  const inl = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
    .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img src="$2" alt="$1">').replace(/\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
  const out = []; let list = null, code = null, table = null, para = [];
  const flushP = () => { if (para.length) { out.push(`<p>${inl(para.join(" "))}</p>`); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.t}>${list.items.map((i) => `<li>${inl(i)}</li>`).join("")}</${list.t}>`); list = null; } };
  const flushT = () => { if (table) { out.push(`<table><thead><tr>${table[0].map((c) => `<th>${inl(c)}</th>`).join("")}</tr></thead><tbody>${table.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inl(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`); table = null; } };
  for (const l of String(md || "").split(/\r?\n/)) {
    if (code !== null) { if (/^```/.test(l)) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; } else code.push(l); continue; }
    if (/^```/.test(l)) { flushP(); flushL(); flushT(); code = []; continue; }
    let m;
    if (/^\|.*\|\s*$/.test(l)) { flushP(); flushL(); if (/^\|[\s:|-]+\|\s*$/.test(l)) continue; (table = table || []).push(l.trim().slice(1, -1).split("|").map((c) => c.trim())); continue; }
    flushT();
    if ((m = l.match(/^(#{1,6})\s+(.*)/))) { flushP(); flushL(); out.push(`<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`); }
    else if ((m = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)/))) { flushP(); const t = /\d/.test(m[1]) ? "ol" : "ul"; if (list && list.t !== t) flushL(); (list = list || { t, items: [] }).items.push(m[2]); }
    else if ((m = l.match(/^>\s?(.*)/))) { flushP(); flushL(); out.push(`<blockquote>${inl(m[1])}</blockquote>`); }
    else if (/^(-{3,}|\*{3,})\s*$/.test(l)) { flushP(); flushL(); out.push("<hr>"); }
    else if (!l.trim()) { flushP(); flushL(); }
    else para.push(l.trim());
  }
  flushP(); flushL(); flushT();
  if (code !== null) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  return out.join("\n");
};

const gotenberg = async (p, api, route, form) => {
  const base = String(p.gotenberg || process.env.GOTENBERG_URL || "http://gotenberg:3000").replace(/\/$/, "");
  const r = await fetch(base + route, { method: "POST", body: form });
  if (!r.ok) throw new Error(`Gotenberg : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
};
const tika = async (p, buf, type, accept = "text/plain") => {
  const base = String(p.tika || process.env.TIKA_URL || "http://tika:9998").replace(/\/$/, "");
  const r = await fetch(`${base}/tika`, { method: "PUT", body: buf, headers: { Accept: accept, "Content-Type": type || "application/octet-stream", ...(p.ocr_langue ? { "X-Tika-OCRLanguage": p.ocr_langue } : {}), ...(p.ocr === false ? { "X-Tika-PDFOcrStrategy": "no_ocr" } : {}) } });
  if (!r.ok) throw new Error(`Tika : HTTP ${r.status}`);
  return (await r.text()).trim();
};

/* EPC (virement SEPA) : QR lisible par les applis bancaires */
const epc = (p) => ["BCD", "002", "1", "SCT", p.bic || "", String(p.beneficiaire || "").slice(0, 70), String(p.iban || "").replace(/\s/g, ""), p.montant ? `EUR${Number(p.montant).toFixed(2)}` : "", "", "", String(p.reference || "").slice(0, 140)].join("\n");
/* PNG en niveaux de gris (lignes déjà préfixées par le filtre 0) */
const pngGris = (w, h, raw) => {
  const { crc32 } = require("../lib/zip");
  const zl = require("zlib");
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, "latin1"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zl.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
};
const wifiEsc = (s) => String(s || "").replace(/([\\;,:"])/g, "\\$1");

module.exports = [
  {
    name: "dzf_pdf_creer", label: "PDF : créer un document", category: "Documents", icon: "fas fa-file-pdf", output: "pdf", timeout: 120,
    description: "Fabrique un PDF propre (A4, titres, listes, tableaux, images, pied de page numéroté) à partir de Markdown ou d'une liste de blocs. Sans service externe. Idéal pour devis, factures, rapports, attestations.",
    params: [{ name: "format", label: "Écrit en", type: "select", options: ["Markdown", "blocs (JSON)"], default: "Markdown" },
      { name: "contenu", label: "Contenu", type: "text", required: true, default: "# Rapport du {{date}}\n\nBonjour {{nom}},\n\n| Élément | Valeur |\n|---|---|\n| Total | {{total}} € |", help: "Markdown : # titre, ## sous-titre, - liste, | tableau |, ![légende](image), --- ligne, <!-- saut --> nouvelle page. Blocs : [{\"titre\":…},{\"texte\":…},{\"tableau\":[[…]]},{\"image\":…}]" },
      { name: "titre", label: "Titre du document (propriétés, pied de page)" }, { name: "auteur", label: "Auteur" }, { name: "couleur", label: "Couleur d'accent", default: "#2563eb" },
      { name: "nom", label: "Nom du fichier", default: "document.pdf" }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      const blocs = p.format === "Markdown" ? mdBlocs(p.contenu) : list(p.contenu);
      if (!Array.isArray(blocs)) throw perm("les blocs doivent être une liste JSON");
      const buf = await ecrirePdf(blocs, { titre: p.titre, auteur: p.auteur, couleur: p.couleur }, async (src) => (await charger(src, { texte: false, max: 15e6 })).buf);
      return sortie(api, p, /\.pdf$/i.test(p.nom || "") ? p.nom : `${p.nom || "document"}.pdf`, "application/pdf", buf);
    },
  },
  {
    name: "dzf_pdf_convertir", label: "PDF : convertir (HTML, page web, Word, Excel…)", category: "Documents", icon: "fas fa-print", output: "pdf", timeout: 180,
    description: "Rendu PDF fidèle avec Gotenberg (conteneur Docker gratuit, Chrome + LibreOffice) : ton HTML/CSS, une page web, ou un fichier Office. Aussi : fusionner plusieurs PDF.",
    params: [{ name: "source_type", label: "À partir de", type: "select", options: ["HTML", "page web (URL)", "fichier Office (docx, xlsx, pptx, odt…)", "fusionner des PDF"], default: "HTML" },
      { name: "source", label: "HTML, URL, fichier ou liste de PDF", type: "text", required: true }, { name: "paysage", label: "Paysage", type: "bool", default: false },
      { name: "gotenberg", label: "Adresse Gotenberg", default: "http://gotenberg:3000", help: "Ajoute au compose : image gotenberg/gotenberg:8" }, { name: "nom", label: "Nom du fichier", default: "document.pdf" }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      const fd = new FormData();
      let route;
      if (p.source_type === "HTML") { route = "/forms/chromium/convert/html"; fd.append("files", new Blob([String(p.source)], { type: "text/html" }), "index.html"); }
      else if (p.source_type.startsWith("page web")) { if (!/^https?:\/\//.test(p.source)) throw perm("URL http(s) attendue"); route = "/forms/chromium/convert/url"; fd.append("url", p.source); }
      else if (p.source_type.startsWith("fichier")) { route = "/forms/libreoffice/convert"; const f = await charger(p.source, { texte: false }); fd.append("files", new Blob([f.buf], { type: f.type }), f.nom); }
      else { route = "/forms/pdfengines/merge"; const l = list(p.source); if (!Array.isArray(l)) throw perm("liste de PDF attendue"); let i = 0; for (const s of l) { const f = await charger(s, { texte: false }); fd.append("files", new Blob([f.buf], { type: "application/pdf" }), `${String(++i).padStart(3, "0")}.pdf`); } }
      if (p.paysage && route.includes("chromium")) fd.append("landscape", "true");
      if (p.paysage && route.includes("libreoffice")) fd.append("landscape", "true");
      return sortie(api, p, /\.pdf$/i.test(p.nom || "") ? p.nom : "document.pdf", "application/pdf", await gotenberg(p, api, route, fd));
    },
  },
  {
    name: "dzf_document_texte", label: "Documents : extraire le texte", category: "Documents", icon: "fas fa-file-alt", output: "texte", timeout: 180,
    description: "Récupère le texte d'un PDF, Word, Excel ou de n'importe quel fichier. Intégré pour PDF/Word/Excel simples ; Apache Tika pour tout le reste, y compris les scans (OCR).",
    params: [{ name: "fichier", label: "Fichier", required: true, help: "Chemin Saltcorn, URL ou {{fichier}}" }, { name: "moteur", label: "Moteur", type: "select", options: ["automatique", "intégré", "Apache Tika (+ OCR)"], default: "automatique" },
      { name: "tika", label: "Adresse Tika", default: "http://tika:9998", help: "Image apache/tika:latest-full pour l'OCR" }, { name: "ocr_langue", label: "Langue OCR", default: "fra+eng" }, { name: "max", label: "Caractères max", type: "int", default: 200000 }],
    run: async (p, ctx, api) => {
      const f = await charger(p.fichier, { texte: false });
      const ext = String(f.nom).split(".").pop().toLowerCase();
      let t = "";
      if (p.moteur !== "Apache Tika (+ OCR)") {
        try {
          if (ext === "pdf" || f.type === "application/pdf") t = lireTextePdf(f.buf);
          else if (ext === "docx") t = lireDocx(f.buf);
          else if (ext === "xlsx") t = lireXlsx(f.buf).feuilles.map((s) => `# ${s.nom}\n` + s.lignes.map((l) => l.map((v) => v ?? "").join("\t")).join("\n")).join("\n\n");
          else if (/^text\/|json|xml|csv/.test(f.type) || ["txt", "csv", "md", "json", "xml", "html"].includes(ext)) t = f.buf.toString("utf8");
        } catch (e) { if (p.moteur === "intégré") throw e; }
      }
      if ((!t || t.replace(/\s/g, "").length < 20) && p.moteur !== "intégré") t = await tika(p, f.buf, f.type);
      return String(t).slice(0, +p.max || 200000);
    },
  },
  {
    name: "dzf_excel_ecrire", label: "Excel : créer un fichier .xlsx", category: "Documents", icon: "fas fa-file-excel", output: "excel", timeout: 120,
    description: "Transforme une liste (ex. les lignes d'une table) en vrai fichier Excel : en-tête coloré, filtres, colonnes ajustées, dates et nombres reconnus. Plusieurs feuilles possibles.",
    params: [{ name: "donnees", label: "Données", type: "json", required: true, help: 'Ex. {{clients}} (liste d\'objets) ou {"Clients": {{clients}}, "Factures": {{factures}}} pour plusieurs feuilles' },
      { name: "colonnes", label: "Colonnes à garder (facultatif)", help: "Ex. nom, email, ville" }, { name: "nom", label: "Nom du fichier", default: "export.xlsx" }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      let d = list(p.donnees);
      if (!d) throw perm("données JSON invalides");
      if (Array.isArray(d)) d = { Feuille1: d };
      const cols = p.colonnes ? String(p.colonnes).split(",").map((s) => s.trim()).filter(Boolean) : null;
      if (cols) for (const k of Object.keys(d)) if (Array.isArray(d[k]) && d[k].length && !Array.isArray(d[k][0])) d[k] = d[k].map((r) => Object.fromEntries(cols.map((c) => [c, getPath(r, c)])));
      return sortie(api, p, /\.xlsx$/i.test(p.nom || "") ? p.nom : `${p.nom || "export"}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ecrireXlsx(d));
    },
  },
  {
    name: "dzf_excel_lire", label: "Excel : lire un fichier .xlsx", category: "Documents", icon: "fas fa-table", output: "lignes", timeout: 120,
    description: "Lit un fichier Excel et rend ses lignes comme une liste d'objets (la 1re ligne donne les noms), prête pour « Table : ajouter » ou « Pour chaque ».",
    params: [{ name: "fichier", label: "Fichier .xlsx", required: true }, { name: "feuille", label: "Feuille (nom ou numéro)", default: "1" }, { name: "entete", label: "La 1re ligne contient les noms", type: "bool", default: true }, { name: "max", label: "Lignes max", type: "int", default: 50000 }],
    run: async (p) => {
      const f = await charger(p.fichier, { texte: false });
      const { feuilles } = lireXlsx(f.buf, { maxLignes: +p.max || 50000 });
      const s = /^\d+$/.test(String(p.feuille || "1")) ? feuilles[+p.feuille - 1] : feuilles.find((x) => x.nom === p.feuille);
      if (!s) throw perm(`feuille « ${p.feuille} » introuvable (feuilles : ${feuilles.map((x) => x.nom).join(", ")})`);
      const rows = s.lignes.filter((l) => l.some((v) => v !== null && v !== ""));
      if (!p.entete) return rows;
      const keys = (rows[0] || []).map((k, i) => String(k ?? `col${i + 1}`).trim());
      return rows.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])));
    },
  },
  {
    name: "dzf_word", label: "Word : créer, lire ou remplir un modèle", category: "Documents", icon: "fas fa-file-word", output: "word", timeout: 120,
    description: "Crée un .docx depuis du texte (# titres, - listes, **gras**), lit le texte d'un .docx, ou remplit un modèle Word contenant des {{champs}} (contrats, courriers…) en gardant sa mise en page.",
    params: [{ name: "action", label: "Action", type: "select", options: ["créer", "lire", "remplir un modèle"], default: "créer" },
      { name: "contenu", label: "Texte", type: "text", showIf: { action: "créer" } }, { name: "fichier", label: "Fichier .docx (ou modèle)", help: "Chemin Saltcorn ou URL" },
      { name: "valeurs", label: "Valeurs du modèle", type: "json", raw: true, showIf: { action: "remplir un modèle" }, help: "Vide = tout le contexte. Ex. {\"nom\":\"{{client.nom}}\"}" }, { name: "nom", label: "Nom du fichier", default: "document.docx" }, ...PARAMS_SORTIE],
    run: async (p, ctx, api) => {
      const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const nom = /\.docx$/i.test(p.nom || "") ? p.nom : "document.docx";
      if (p.action === "créer") return sortie(api, p, nom, DOCX, ecrireDocx(p.contenu));
      const f = await charger(p.fichier, { texte: false });
      if (p.action === "lire") return lireDocx(f.buf);
      let vals = p.valeurs ? list(p.valeurs) : ctx;
      if (p.valeurs && vals) vals = require("../engine").deep(vals, ctx);
      const x = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const files = readZip(f.buf).map((e) => {
        if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(e.nom)) return e;
        let xml = e.contenu.toString("utf8");
        /* Word coupe souvent {{champ}} en plusieurs morceaux : on recolle le texte des paragraphes concernés */
        xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
          const text = [...para.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
          if (!/\{\{[^}]+\}\}/.test(text)) return para;
          let first = true;
          return para.replace(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g, () => { if (!first) return "<w:t></w:t>"; first = false; return `<w:t xml:space="preserve">${text}</w:t>`; });
        });
        xml = xml.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => x(getPath(vals, k)).replace(/\n/g, "</w:t><w:br/><w:t xml:space=\"preserve\">"));
        return { nom: e.nom, contenu: Buffer.from(xml, "utf8") };
      });
      return sortie(api, p, nom, DOCX, writeZip(files));
    },
  },
  {
    name: "dzf_qr", label: "QR code", category: "Documents", icon: "fas fa-qrcode", output: "qr",
    description: "Génère un QR code : lien, texte, Wi-Fi (se connecter en scannant), carte de visite, ou virement SEPA prêt à payer depuis une appli bancaire. Rend une image SVG utilisable partout (mail, PDF, page).",
    params: [{ name: "type", label: "Type", type: "select", options: ["lien ou texte", "Wi-Fi", "carte de visite", "virement SEPA"], default: "lien ou texte" },
      { name: "texte", label: "Lien ou texte", showIf: { type: "lien ou texte" } },
      { name: "ssid", label: "Nom du Wi-Fi", showIf: { type: "Wi-Fi" } }, { name: "mdp_wifi", label: "Secret du mot de passe Wi-Fi", showIf: { type: "Wi-Fi" } },
      { name: "nom_contact", label: "Nom", showIf: { type: "carte de visite" } }, { name: "tel", label: "Téléphone", showIf: { type: "carte de visite" } }, { name: "email", label: "E-mail", showIf: { type: "carte de visite" } }, { name: "societe", label: "Société", showIf: { type: "carte de visite" } },
      { name: "beneficiaire", label: "Bénéficiaire", showIf: { type: "virement SEPA" } }, { name: "iban", label: "IBAN", showIf: { type: "virement SEPA" } }, { name: "bic", label: "BIC", showIf: { type: "virement SEPA" } }, { name: "montant", label: "Montant (€)", showIf: { type: "virement SEPA" } }, { name: "reference", label: "Référence", showIf: { type: "virement SEPA" } },
      { name: "taille", label: "Taille (px)", type: "int", default: 256 }, { name: "correction", label: "Robustesse", type: "select", options: ["M", "L", "Q", "H"], default: "M" }],
    run: async (p, ctx, api) => {
      const qrcode = require("qrcode-generator");
      let data;
      if (p.type === "Wi-Fi") data = `WIFI:T:WPA;S:${wifiEsc(p.ssid)};P:${wifiEsc(p.mdp_wifi ? await api.secret(p.mdp_wifi) : "")};;`;
      else if (p.type === "carte de visite") data = ["BEGIN:VCARD", "VERSION:3.0", `FN:${p.nom_contact || ""}`, p.societe ? `ORG:${p.societe}` : "", p.tel ? `TEL:${p.tel}` : "", p.email ? `EMAIL:${p.email}` : "", "END:VCARD"].filter(Boolean).join("\n");
      else if (p.type === "virement SEPA") data = epc(p);
      else data = String(p.texte ?? "");
      if (!data) throw perm("rien à encoder");
      qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
      const q = qrcode(0, p.correction || "M"); q.addData(data, "Byte"); q.make();
      const n = q.getModuleCount(), size = Math.max(64, Math.min(2048, +p.taille || 256)), cell = size / (n + 8);
      let path = "";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${((c + 4) * cell).toFixed(2)} ${((r + 4) * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
      /* PNG aussi (pour les PDF et les mails qui n'affichent pas le SVG) */
      const px = Math.max(1, Math.floor(size / (n + 8))), dim = (n + 8) * px, raw = Buffer.alloc(dim * (dim + 1), 255);
      for (let y = 0; y < dim; y++) { raw[y * (dim + 1)] = 0; const r = Math.floor(y / px) - 4; if (r < 0 || r >= n) continue; for (let xx = 0; xx < dim; xx++) { const c = Math.floor(xx / px) - 4; if (c >= 0 && c < n && q.isDark(r, c)) raw[y * (dim + 1) + 1 + xx] = 0; } }
      const png = pngGris(dim, dim, raw);
      return { svg, data_uri: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, png: { nom: "qr.png", type: "image/png", base64: png.toString("base64") }, png_data_uri: `data:image/png;base64,${png.toString("base64")}`, contenu: p.type === "Wi-Fi" ? "(Wi-Fi)" : data };
    },
  },
  {
    name: "dzf_markdown", label: "Markdown → HTML", category: "Documents", icon: "fab fa-markdown", output: "html",
    description: "Convertit du Markdown (titres, listes, tableaux, liens, code) en HTML propre et sûr, pour un mail, une page ou un PDF.",
    params: [{ name: "markdown", label: "Markdown", type: "text", required: true }, { name: "style", label: "Ajouter une mise en forme simple (pour les mails)", type: "bool", default: false }],
    run: async (p) => {
      const html = mdHtml(p.markdown);
      return p.style ? `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2937;max-width:680px"><style>table{border-collapse:collapse}td,th{border:1px solid #e5e7eb;padding:6px 10px}th{background:#f3f4f6}code{background:#f3f4f6;padding:1px 4px;border-radius:4px}pre{background:#111827;color:#e5e7eb;padding:12px;border-radius:8px;overflow:auto}blockquote{border-left:3px solid #d1d5db;margin:0;padding-left:12px;color:#4b5563}</style>${html}</div>` : html;
    },
  },
];
module.exports.mdHtml = mdHtml;
