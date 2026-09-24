/* PDF sans dépendance.
   - ecrirePdf : fabrique un PDF A4 à partir de blocs simples (titres, paragraphes,
     listes, tableaux, images JPEG/PNG, sauts de page), accents français compris.
   - lireTextePdf : extraction de texte basique (PDF « texte », pas les scans). */
"use strict";
const zlib = require("zlib");

/* WinAnsi : les caractères utiles au français et à l'euro */
const WIN = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "œ": 0x9c, "Œ": 0x8c, "Ÿ": 0x9f };
const winBytes = (s) => Buffer.from([...String(s)].map((c) => { const k = c.codePointAt(0); if (WIN[c]) return WIN[c]; if (k < 256) return k; return 0x3f; }));
const pdfStr = (s) => "(" + winBytes(s).toString("latin1").replace(/[\\()]/g, (c) => "\\" + c).replace(/\r/g, "\\r") + ")";

/* largeurs Helvetica (1/1000) pour couper les lignes proprement */
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const width = (s, size, bold) => [...String(s)].reduce((w, c) => { const k = c.codePointAt(0); const base = k >= 32 && k < 127 ? HW[k - 32] : /[àâäéèêëîïôöùûüç]/i.test(c) ? 556 : 600; return w + base * (bold ? 1.05 : 1); }, 0) * size / 1000;
const wrap = (text, size, bold, max) => {
  const out = [];
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      if (!w) continue;
      const t = line ? line + " " + w : w;
      if (width(t, size, bold) <= max) line = t;
      else { if (line) out.push(line); line = w; while (width(line, size, bold) > max && line.length > 1) { let i = line.length; while (i > 1 && width(line.slice(0, i), size, bold) > max) i--; out.push(line.slice(0, i)); line = line.slice(i); } }
    }
    out.push(line);
  }
  return out;
};

/* image → objet XObject : JPEG tel quel, PNG décodé (sans entrelacement) */
const imageObj = (buf) => {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2, w = 0, h = 0, comp = 3;
    while (i < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; const len = buf.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); comp = buf[i + 9]; break; } i += 2 + len; }
    return { w, h, dict: `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /${comp === 1 ? "DeviceGray" : comp === 4 ? "DeviceCMYK" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode`, data: buf };
  }
  if (buf.readUInt32BE(0) === 0x89504e47) {
    let i = 8, w, h, bit, ct, inter; const idat = [];
    while (i < buf.length) { const len = buf.readUInt32BE(i), type = buf.toString("latin1", i + 4, i + 8), d = buf.slice(i + 8, i + 8 + len); if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bit = d[8]; ct = d[9]; inter = d[12]; } if (type === "IDAT") idat.push(d); i += 12 + len; }
    if (bit !== 8 || inter || ![0, 2, 6].includes(ct)) throw new Error("PNG non géré (8 bits, non entrelacé, gris/RVB/RVBA seulement)");
    const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch;
    const px = Buffer.alloc(h * stride); let prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)], line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = Buffer.alloc(stride);
      for (let x = 0; x < stride; x++) { const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0; let v = line[x];
        if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; } cur[x] = v & 255; }
      cur.copy(px, y * stride); prev = cur;
    }
    const col = ch === 1 ? 1 : 3, rgb = Buffer.alloc(w * h * col), alpha = ch === 4 ? Buffer.alloc(w * h) : null;
    for (let k = 0; k < w * h; k++) { for (let c = 0; c < col; c++) rgb[k * col + c] = px[k * ch + c]; if (alpha) alpha[k] = px[k * ch + 3]; }
    return { w, h, dict: `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /${col === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /FlateDecode`, data: zlib.deflateSync(rgb), alpha: alpha && zlib.deflateSync(alpha) };
  }
  throw new Error("image non gérée (JPEG ou PNG)");
};

const hexColor = (c, dflt = "0 0 0") => { const m = String(c || "").match(/^#?([0-9a-f]{6})$/i); if (!m) return dflt; const n = parseInt(m[1], 16); return `${((n >> 16) / 255).toFixed(3)} ${(((n >> 8) & 255) / 255).toFixed(3)} ${((n & 255) / 255).toFixed(3)}`; };

/* blocs : [{titre|t2|texte|liste|tableau|image|saut|ligne|petit}] ; opts : { titre, auteur, couleur, pied } */
const ecrirePdf = async (blocs, opts = {}, loadImage) => {
  const W = 595.28, H = 841.89, M = 56, CW = W - 2 * M;
  const pages = []; let ops = [], y = H - M;
  const images = [];
  const accent = hexColor(opts.couleur, "0.141 0.388 0.922");
  const newPage = () => { pages.push(ops); ops = []; y = H - M; };
  const need = (h) => { if (y - h < M + 20) newPage(); };
  const text = (s, x, size, bold, color = "0 0 0") => ops.push(`BT ${color} rg /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfStr(s)} Tj ET`);
  const para = (s, size = 10.5, bold = false, color, indent = 0, gap = 6) => { const lh = size * 1.4; for (const l of wrap(s, size, bold, CW - indent)) { need(lh); y -= lh; text(l, M + indent, size, bold, color); } y -= gap; };
  for (const b0 of blocs || []) {
    const b = typeof b0 === "string" ? { texte: b0 } : b0 || {};
    if (b.titre !== undefined) { y -= 6; para(b.titre, 20, true, accent, 0, 10); }
    else if (b.t2 !== undefined) { y -= 4; para(b.t2, 14, true, "0.15 0.15 0.15", 0, 6); }
    else if (b.texte !== undefined) para(b.texte, +b.taille || 10.5, !!b.gras, b.couleur ? hexColor(b.couleur) : undefined);
    else if (b.petit !== undefined) para(b.petit, 8.5, false, "0.4 0.4 0.4");
    else if (b.liste) { for (const it of b.liste) { const ls = wrap(String(it), 10.5, false, CW - 16); ls.forEach((l, i) => { need(14.7); y -= 14.7; if (!i) text("•", M + 4, 10.5, false, accent); text(l, M + 16, 10.5); }); } y -= 6; }
    else if (b.ligne) { need(10); y -= 5; ops.push(`0.85 0.85 0.85 RG 0.8 w ${M} ${y} m ${W - M} ${y} l S`); y -= 8; }
    else if (b.saut) newPage();
    else if (b.tableau) {
      const rows = b.tableau; if (!rows.length) continue;
      const cols = Math.max(...rows.map((r) => r.length)); const cw = CW / cols, size = +b.taille || 9, lh = size * 1.35;
      rows.forEach((r, ri) => {
        const cells = [...Array(cols)].map((_, ci) => wrap(r[ci] ?? "", size, ri === 0, cw - 8));
        const h = Math.max(...cells.map((c) => c.length)) * lh + 6;
        need(h);
        if (ri === 0) ops.push(`${accent} rg ${M} ${(y - h).toFixed(2)} ${CW} ${h.toFixed(2)} re f`);
        else if (ri % 2 === 0) ops.push(`0.96 0.97 0.98 rg ${M} ${(y - h).toFixed(2)} ${CW} ${h.toFixed(2)} re f`);
        const y0 = y;
        cells.forEach((c, ci) => { y = y0 - 3; c.forEach((l) => { y -= lh; const right = ri > 0 && /^-?[\d\s.,]+(%|€|\s?€)?$/.test(String(r[ci] ?? "")); text(l, right ? M + (ci + 1) * cw - 4 - width(l, size) : M + ci * cw + 4, size, ri === 0, ri === 0 ? "1 1 1" : "0.1 0.1 0.1"); }); });
        y = y0 - h;
      });
      y -= 10;
    } else if (b.image) {
      try {
        const buf = await loadImage(b.image);
        const img = imageObj(buf); const id = images.push(img);
        let w = Math.min(CW, +b.largeur || img.w * 0.75), h = (w * img.h) / img.w;
        if (h > H - 2 * M - 40) { h = H - 2 * M - 40; w = (h * img.w) / img.h; }
        need(h + 6); y -= h;
        const x = b.aligner === "gauche" ? M : b.aligner === "droite" ? W - M - w : M + (CW - w) / 2;
        ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${id} Do Q`);
        y -= 8;
        if (b.legende) para(b.legende, 8.5, false, "0.4 0.4 0.4");
      } catch (e) { para(`[image : ${e.message}]`, 8.5, false, "0.7 0 0"); }
    }
  }
  pages.push(ops);
  /* assemblage */
  const objs = [];
  const add = (s) => objs.push(s) - 1 + 1; /* numéros à partir de 1 */
  const catalog = add(null), pagesId = add(null), f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"), f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const imgIds = images.map((im) => { let smask = ""; if (im.alpha) { const a = add({ dict: `/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, data: im.alpha }); smask = ` /SMask ${a} 0 R`; } return add({ dict: im.dict + smask, data: im.data }); });
  const xo = imgIds.length ? `/XObject << ${imgIds.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(" ")} >>` : "";
  const kids = pages.map((o, i) => {
    const foot = opts.pied !== false ? `BT 0.55 0.55 0.55 rg /F1 8 Tf ${M} 30 Td ${pdfStr(`${opts.pied || opts.titre || ""}`)} Tj ET BT 0.55 0.55 0.55 rg /F1 8 Tf ${W - M - 30} 30 Td ${pdfStr(`${i + 1} / ${pages.length}`)} Tj ET` : "";
    const content = add({ dict: "/Filter /FlateDecode", data: zlib.deflateSync(Buffer.from([...o, foot].join("\n"), "latin1")) });
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> ${xo} >> /Contents ${content} 0 R >>`);
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const info = add(`<< /Producer (dysizz-flow) /Title ${pdfStr(opts.titre || "")} /Author ${pdfStr(opts.auteur || "")} /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`);
  const parts = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")]; const offs = []; let len = parts[0].length;
  objs.forEach((o, i) => {
    const head = Buffer.from(`${i + 1} 0 obj\n`, "latin1");
    const body = typeof o === "string" ? Buffer.from(o + "\n", "latin1") : Buffer.concat([Buffer.from(`<< ${o.dict} /Length ${o.data.length} >>\nstream\n`, "latin1"), o.data, Buffer.from("\nendstream\n", "latin1")]);
    const tail = Buffer.from("endobj\n", "latin1");
    offs.push(len); parts.push(head, body, tail); len += head.length + body.length + tail.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
};

/* Markdown simple → blocs */
const mdBlocs = (md) => {
  const out = []; let list = null, table = null;
  const flush = () => { if (list) { out.push({ liste: list }); list = null; } if (table) { out.push({ tableau: table }); table = null; } };
  const clean = (s) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  for (const raw of String(md || "").split(/\r?\n/)) {
    const l = raw.trimEnd();
    let m;
    if (/^\|.*\|$/.test(l.trim())) { if (/^\|[\s:|-]+\|$/.test(l.trim())) continue; if (list) flush(); (table = table || []).push(l.trim().slice(1, -1).split("|").map((c) => clean(c.trim()))); continue; }
    if ((m = l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)/))) { if (table) flush(); (list = list || []).push(clean(m[1])); continue; }
    flush();
    if ((m = l.match(/^#\s+(.*)/))) out.push({ titre: clean(m[1]) });
    else if ((m = l.match(/^#{2,6}\s+(.*)/))) out.push({ t2: clean(m[1]) });
    else if ((m = l.match(/^!\[([^\]]*)\]\(([^)]+)\)/))) out.push({ image: m[2], legende: m[1] });
    else if (/^(-{3,}|\*{3,})$/.test(l.trim())) out.push({ ligne: true });
    else if (/^<!--\s*saut\s*-->$/i.test(l.trim())) out.push({ saut: true });
    else if (l.trim()) { const last = out[out.length - 1]; if (last && last.texte !== undefined && !last._fin) last.texte += " " + clean(l.trim()); else out.push({ texte: clean(l.trim()) }); }
    else if (out.length) out[out.length - 1]._fin = true;
  }
  flush();
  return out.map(({ _fin, ...b }) => b);
};

/* ---------- lecture ---------- */
const unesc = (s) => s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[c] ?? String.fromCharCode(parseInt(c, 8))));
const lireTextePdf = (buf, max = 2e6) => {
  const s = buf.toString("latin1");
  const out = [];
  const re = /stream\r?\n/g; let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length, end = s.indexOf("endstream", start);
    if (end < 0) break;
    const dictStart = s.lastIndexOf("<<", m.index), dict = s.slice(dictStart, m.index);
    if (/\/Subtype\s*\/Image|\/Type\s*\/XObject|\/Length1|\/FontFile/.test(dict)) continue;
    let data = buf.slice(start, end);
    if (/FlateDecode/.test(dict)) { try { data = zlib.inflateSync(data); } catch (e) { try { data = zlib.inflateSync(data.slice(0, data.length - 2)); } catch (x) { continue; } } }
    const c = data.toString("latin1");
    if (!/T[Jj*']|Tf/.test(c)) continue;
    let line = "";
    for (const t of c.matchAll(/\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|(T\*|Td|TD|Tm|ET)/g)) {
      if (t[3]) { if (t[3] !== "Tm" || line) { out.push(line); line = ""; } continue; }
      if (t[2] !== undefined) line += unesc(t[2]);
      else for (const part of t[1].matchAll(/\(((?:\\.|[^\\)])*)\)|(-?\d+\.?\d*)/g)) { if (part[1] !== undefined) line += unesc(part[1]); else if (+part[2] < -200) line += " "; }
    }
    if (line) out.push(line);
    if (out.join("").length > max) break;
  }
  const bytes = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return Buffer.from(bytes, "latin1").toString("latin1").replace(/[\x80-\x9f]/g, (c) => Object.keys(WIN).find((k) => WIN[k] === c.charCodeAt(0)) || c);
};

module.exports = { ecrirePdf, mdBlocs, lireTextePdf, wrap, width };
