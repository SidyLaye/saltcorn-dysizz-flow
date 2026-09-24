/* ZIP minimal (sans dépendance) : écrire une archive (deflate) et lire ses fichiers.
   Suffit pour les .zip, .xlsx, .docx, .odt… */
"use strict";
const zlib = require("zlib");

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

/* fichiers : [{ nom, contenu: Buffer|string }] → Buffer */
const writeZip = (files, { store = false } = {}) => {
  const parts = [], central = [];
  let offset = 0;
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(String(f.nom).replace(/^\/+/, ""), "utf8");
    const raw = Buffer.isBuffer(f.contenu) ? f.contenu : Buffer.from(String(f.contenu ?? ""), "utf8");
    const comp = store ? raw : zlib.deflateRawSync(raw, { level: 6 });
    const method = store ? 0 : 8, crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10); ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
};

/* Buffer → [{ nom, contenu: Buffer }] */
const readZip = (buf, { max = 5000, maxSize = 200 * 1024 * 1024 } = {}) => {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("ce n'est pas une archive ZIP");
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = [];
  let total = 0;
  for (let i = 0; i < n && i < max; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const nom = buf.slice(p + 46, p + 46 + nl).toString("utf8");
    p += 46 + nl + el + cl;
    if (nom.endsWith("/")) continue;
    total += usize;
    if (total > maxSize) throw new Error("archive trop grosse une fois décompressée (bombe ZIP ?)");
    const lnl = buf.readUInt16LE(lo + 26), lel = buf.readUInt16LE(lo + 28);
    const data = buf.slice(lo + 30 + lnl + lel, lo + 30 + lnl + lel + csize);
    out.push({ nom, contenu: method === 8 ? zlib.inflateRawSync(data) : data });
  }
  return out;
};

module.exports = { writeZip, readZip, crc32 };
