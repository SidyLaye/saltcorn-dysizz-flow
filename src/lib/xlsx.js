/* Excel (.xlsx) et Word (.docx) sans dépendance : un .xlsx est un ZIP de XML. */
"use strict";
const { writeZip, readZip } = require("./zip");

const x = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const unx = (s) => String(s ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const col = (n) => { let s = ""; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colIdx = (s) => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
const EPOCH = Date.UTC(1899, 11, 30);
const isDate = (v) => v instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v));

/* feuilles : [{ nom, lignes: [[…]] }] ou { nom: [objets] } → Buffer .xlsx */
const ecrireXlsx = (feuilles) => {
  const list = Array.isArray(feuilles) ? feuilles : Object.entries(feuilles).map(([nom, lignes]) => ({ nom, lignes }));
  const sheets = list.map((f, i) => {
    let rows = f.lignes || [];
    if (rows.length && !Array.isArray(rows[0])) { const keys = [...new Set(rows.flatMap((r) => Object.keys(r || {})))]; rows = [keys, ...rows.map((r) => keys.map((k) => r[k]))]; }
    const widths = [];
    const xml = rows.map((r, ri) => `<row r="${ri + 1}">${(r || []).map((v, ci) => {
      const ref = `${col(ci)}${ri + 1}`, st = ri === 0 && f.entete !== false ? ' s="1"' : "";
      widths[ci] = Math.min(60, Math.max(widths[ci] || 8, String(v ?? "").length + 2));
      if (v === null || v === undefined || v === "") return "";
      if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      if (typeof v === "boolean") return `<c r="${ref}" t="b"${st}><v>${v ? 1 : 0}</v></c>`;
      if (isDate(v) && ri > 0) { const d = new Date(v); if (!isNaN(d)) return `<c r="${ref}" s="2"><v>${(d.getTime() - EPOCH) / 864e5}</v></c>`; }
      if (typeof v === "string" && v.startsWith("=")) return `<c r="${ref}"${st}><f>${x(v.slice(1))}</f></c>`;
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${x(typeof v === "object" ? JSON.stringify(v) : v)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const freeze = rows.length > 1 && f.entete !== false ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : "";
    const filter = rows.length > 1 && f.entete !== false && rows[0].length ? `<autoFilter ref="A1:${col(rows[0].length - 1)}${rows.length}"/>` : "";
    return { nom: String(f.nom || `Feuille${i + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31), xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${xml}</sheetData>${filter}</worksheet>` };
  });
  const files = [
    { nom: "[Content_Types].xml", contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { nom: "_rels/.rels", contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nom: "xl/workbook.xml", contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${x(s.nom)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { nom: "xl/_rels/workbook.xml.rels", contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nom: "xl/styles.xml", contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>` },
    ...sheets.map((s, i) => ({ nom: `xl/worksheets/sheet${i + 1}.xml`, contenu: s.xml })),
  ];
  return writeZip(files);
};

/* .xlsx → { feuilles: [{ nom, lignes: [[…]] }] } ; dates rendues en ISO */
const lireXlsx = (buf, { maxLignes = 100000 } = {}) => {
  const z = Object.fromEntries(readZip(buf).map((f) => [f.nom, f.contenu.toString("utf8")]));
  if (!z["xl/workbook.xml"]) throw Object.assign(new Error("ce n'est pas un fichier Excel .xlsx"), { permanent: true });
  const shared = [...(z["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unx([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const fmts = {}; for (const m of (z["xl/styles.xml"] || "").matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)) fmts[m[1]] = m[2];
  const xfs = [...((z["xl/styles.xml"] || "").match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || ["", ""])[1].matchAll(/<xf [^>]*?numFmtId="(\d+)"|<xf(?![^>]*numFmtId)[^>]*>/g)].map((m) => +(m[1] || 0));
  const dateStyle = (s) => { const id = xfs[+s]; return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (fmts[id] && /[dmy]/i.test(fmts[id].replace(/\[[^\]]*\]|"[^"]*"/g, ""))); };
  const attr = (tag, a) => (tag.match(new RegExp(`\\s${a}="([^"]*)"`)) || [])[1];
  const rels = Object.fromEntries([...(z["xl/_rels/workbook.xml.rels"] || "").matchAll(/<Relationship [^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")]));
  const feuilles = [...z["xl/workbook.xml"].matchAll(/<sheet [^>]*>/g)].map((t) => [null, attr(t[0], "name"), attr(t[0], "r:id")]).filter((m) => rels[m[2]]).map((m) => {
    const path = "xl/" + rels[m[2]].replace(/^\/?xl\//, "").replace(/^\//, "");
    const xml = z[path] || "";
    const lignes = [];
    for (const r of xml.matchAll(/<row [^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>|<row [^>]*?r="(\d+)"[^>]*\/>/g)) {
      if (lignes.length >= maxLignes) break;
      const ri = +(r[1] || r[3]) - 1, row = [];
      for (const c of (r[2] || "").matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = c[1], ref = (at.match(/r="([A-Z]+)\d+"/) || [])[1], t = (at.match(/t="(\w+)"/) || [])[1], s = (at.match(/s="(\d+)"/) || [])[1];
        const v = ((c[2] || "").match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = null;
        const fo = ((c[2] || "").match(/<f>([\s\S]*?)<\/f>/) || [])[1];
        if (v === undefined && fo) val = "=" + unx(fo);
        else if (t === "s") val = shared[+v];
        else if (t === "inlineStr") val = unx([...(c[2] || "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((y) => y[1]).join(""));
        else if (t === "b") val = v === "1";
        else if (t === "str" || t === "e") val = unx(v ?? "");
        else if (v !== undefined) { val = Number(v); if (s && dateStyle(s)) val = new Date(EPOCH + val * 864e5).toISOString().replace(/T00:00:00\.000Z$/, ""); }
        row[ref ? colIdx(ref) : row.length] = val;
      }
      lignes[ri] = [...row].map((v) => (v === undefined ? null : v));
    }
    return { nom: unx(m[1]), lignes: [...lignes].map((l) => l || []) };
  });
  return { feuilles };
};

/* .docx → texte (paragraphes, tableaux en lignes tabulées) */
const lireDocx = (buf) => {
  const z = Object.fromEntries(readZip(buf).filter((f) => /^word\/document\.xml$/.test(f.nom)).map((f) => [f.nom, f.contenu.toString("utf8")]));
  const d = z["word/document.xml"];
  if (!d) throw Object.assign(new Error("ce n'est pas un fichier Word .docx"), { permanent: true });
  return unx(d.replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:tc>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")).replace(/\t\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
};

/* texte / markdown simple → .docx (titres #, listes -, gras **…**) */
const ecrireDocx = (texte) => {
  const run = (s) => s.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((p) => (p.startsWith("**") ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${x(p.slice(2, -2))}</w:t></w:r>` : `<w:r><w:t xml:space="preserve">${x(p)}</w:t></w:r>`)).join("");
  const body = String(texte || "").split(/\r?\n/).map((l) => {
    let m;
    if ((m = l.match(/^(#{1,3})\s+(.*)/))) return `<w:p><w:pPr><w:pStyle w:val="Heading${m[1].length}"/></w:pPr>${run(m[2])}</w:p>`;
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="360" w:hanging="360"/></w:pPr><w:r><w:t xml:space="preserve">• </w:t></w:r>${run(m[1])}</w:p>`;
    return `<w:p>${run(l)}</w:p>`;
  }).join("");
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const st = (id, name, sz) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="2563EB"/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
  return writeZip([
    { nom: "[Content_Types].xml", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
    { nom: "_rels/.rels", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { nom: "word/_rels/document.xml.rels", contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { nom: "word/styles.xml", contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${st("Heading1", "heading 1", 36)}${st("Heading2", "heading 2", 28)}${st("Heading3", "heading 3", 24)}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style></w:styles>` },
    { nom: "word/document.xml", contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>` },
  ]);
};

module.exports = { ecrireXlsx, lireXlsx, lireDocx, ecrireDocx };
