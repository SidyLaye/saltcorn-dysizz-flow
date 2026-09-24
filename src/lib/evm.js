/* Outils Ethereum et compatibles (Polygon, Base, BNB…) : keccak, encodage ABI,
   RLP, signature de transactions EIP-1559 et de messages. Cryptographie :
   @noble/curves et @noble/hashes (bibliothèques auditées, incluses au build). */
"use strict";
const { secp256k1 } = require("@noble/curves/secp256k1");
const { keccak_256 } = require("@noble/hashes/sha3");

const hex = (b) => Buffer.from(b).toString("hex");
const unhex = (h) => Buffer.from(String(h).replace(/^0x/, "").padStart(String(h).replace(/^0x/, "").length + (String(h).replace(/^0x/, "").length % 2), "0"), "hex");
const keccak = (x) => Buffer.from(keccak_256(typeof x === "string" ? Buffer.from(x, "utf8") : x));
const pad32 = (b) => Buffer.concat([Buffer.alloc(Math.max(0, 32 - b.length)), b]);
const big = (v) => (typeof v === "bigint" ? v : BigInt(String(v).trim() || "0"));
const toHexQ = (v) => "0x" + big(v).toString(16);

const checksum = (addr) => {
  const a = String(addr).toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(a)) throw Object.assign(new Error(`adresse invalide : ${addr}`), { permanent: true });
  const h = hex(keccak(a));
  return "0x" + [...a].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
};
const addrOfPub = (pub) => checksum(hex(keccak(Buffer.from(pub).slice(1)).slice(12)));
const addrOfKey = (pk) => addrOfPub(secp256k1.getPublicKey(unhex(pk), false));

/* unités : 1.5 ETH ↔ wei */
const toUnits = (v, dec = 18) => { const [i, f = ""] = String(v).trim().split("."); return BigInt(i || "0") * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0"); };
const fromUnits = (v, dec = 18) => { const b = big(v), neg = b < 0n, a = neg ? -b : b, d = 10n ** BigInt(dec); const f = (a % d).toString().padStart(dec, "0").replace(/0+$/, ""); return (neg ? "-" : "") + (a / d).toString() + (f ? "." + f : ""); };

/* ---------- ABI ---------- */
/* "transfer(address,uint256)" ou "balanceOf(address) returns (uint256)" */
const splitRaw = (s) => { const out = []; let d = 0, cur = ""; for (const c of s) { if (c === "(") d++; if (c === ")") d--; if (c === "," && !d) { out.push(cur.trim()); cur = ""; } else cur += c; } if (cur.trim()) out.push(cur.trim()); return out; };
const param = (x, i) => { const w = x.split(/\s+/); const type = w[0]; const indexed = w.includes("indexed"); const rest = w.slice(1).filter((y) => y !== "indexed" && y !== "memory" && y !== "calldata"); return { type: type === "uint" ? "uint256" : type === "int" ? "int256" : type, indexed, name: rest[0] || `arg${i}` }; };
const parseSig = (sig) => {
  const m = String(sig).replace(/^function\s+|^event\s+/, "").match(/^\s*(\w+)\s*\(([^)]*)\)\s*(?:(?:returns|:)\s*\(?([^)]*)\)?)?/);
  if (!m) throw Object.assign(new Error(`signature invalide : ${sig}`), { permanent: true });
  const ins = splitRaw(m[2]).map(param), outs = m[3] ? splitRaw(m[3]).map(param) : [];
  return { name: m[1], inputs: ins.map((x) => x.type), indexed: ins.map((x) => x.indexed), names: ins.map((x) => x.name), outputs: outs.map((x) => x.type), outNames: outs.map((x) => x.name), canon: `${m[1]}(${ins.map((x) => x.type).join(",")})` };
};
const selector = (canon) => keccak(canon).slice(0, 4);
const isDyn = (t) => t === "string" || t === "bytes" || /\[\]$/.test(t);

const encOne = (t, v) => {
  if (t === "address") return pad32(unhex(checksum(v)));
  if (t === "bool") return pad32(Buffer.from([v === true || v === "true" || v === 1 || v === "1" ? 1 : 0]));
  if (/^uint\d*$/.test(t)) return pad32(unhex(big(v).toString(16)));
  if (/^int\d*$/.test(t)) { let b = big(v); if (b < 0n) b = (1n << 256n) + b; return pad32(unhex(b.toString(16))); }
  if (/^bytes\d+$/.test(t)) { const b = unhex(v); return Buffer.concat([b, Buffer.alloc(32 - b.length)]); }
  throw Object.assign(new Error(`type ABI non géré : ${t}`), { permanent: true });
};
const encode = (types, vals) => {
  const heads = [], tails = [];
  let tailLen = 0;
  const headLen = types.length * 32;
  types.forEach((t, i) => {
    const v = vals[i];
    if (!isDyn(t)) { heads.push(encOne(t, v)); return; }
    heads.push(pad32(unhex((headLen + tailLen).toString(16))));
    let tail;
    if (t === "string" || t === "bytes") { const b = t === "string" ? Buffer.from(String(v), "utf8") : unhex(v); tail = Buffer.concat([pad32(unhex(b.length.toString(16))), b, Buffer.alloc((32 - (b.length % 32)) % 32)]); }
    else { const arr = Array.isArray(v) ? v : JSON.parse(v); const inner = t.slice(0, -2); tail = Buffer.concat([pad32(unhex(arr.length.toString(16))), encode(arr.map(() => inner), arr)]); }
    tails.push(tail); tailLen += tail.length;
  });
  return Buffer.concat([...heads, ...tails]);
};
const decOne = (t, w) => {
  if (t === "address") return checksum(hex(w.slice(12)));
  if (t === "bool") return w[31] === 1;
  if (/^uint\d*$/.test(t)) return BigInt("0x" + (hex(w) || "0")).toString();
  if (/^int\d*$/.test(t)) { let b = BigInt("0x" + hex(w)); if (b >= 1n << 255n) b -= 1n << 256n; return b.toString(); }
  if (/^bytes\d+$/.test(t)) return "0x" + hex(w.slice(0, +t.slice(5)));
  return "0x" + hex(w);
};
const decode = (types, data) => {
  const b = Buffer.isBuffer(data) ? data : unhex(data);
  return types.map((t, i) => {
    const w = b.slice(i * 32, i * 32 + 32);
    if (!isDyn(t)) return decOne(t, w);
    const off = Number(BigInt("0x" + hex(w)));
    const len = Number(BigInt("0x" + hex(b.slice(off, off + 32))));
    if (t === "string") return b.slice(off + 32, off + 32 + len).toString("utf8");
    if (t === "bytes") return "0x" + hex(b.slice(off + 32, off + 32 + len));
    return decode(Array(len).fill(t.slice(0, -2)), b.slice(off + 32));
  });
};
const callData = (sig, args = []) => { const s = parseSig(sig); return "0x" + hex(Buffer.concat([selector(s.canon), encode(s.inputs, args)])); };

/* décode un événement (log) selon sa signature */
const decodeLog = (sig, log) => {
  const s = parseSig(sig);
  const out = {};
  let ti = 1;
  const data = decode(s.inputs.filter((_, i) => !s.indexed[i]), log.data || "0x");
  let di = 0;
  s.inputs.forEach((t, i) => { out[s.names[i]] = s.indexed[i] ? (isDyn(t) ? log.topics[ti++] : decOne(t, unhex(log.topics[ti++]))) : data[di++]; });
  return out;
};

/* ---------- RLP ---------- */
const rlp = (x) => {
  if (Array.isArray(x)) { const body = Buffer.concat(x.map(rlp)); return Buffer.concat([lenPrefix(body.length, 0xc0), body]); }
  const b = Buffer.isBuffer(x) ? x : x === null || x === undefined || x === 0n || x === 0 || x === "0" || x === "" ? Buffer.alloc(0) : typeof x === "string" && x.startsWith("0x") ? unhex(x) : unhex(big(x).toString(16));
  if (b.length === 1 && b[0] < 0x80) return b;
  return Buffer.concat([lenPrefix(b.length, 0x80), b]);
};
const lenPrefix = (n, off) => { if (n < 56) return Buffer.from([off + n]); const l = unhex(n.toString(16)); return Buffer.concat([Buffer.from([off + 55 + l.length]), l]); };
const strip = (h) => { const b = unhex(h); let i = 0; while (i < b.length && b[i] === 0) i++; return b.slice(i); };

/* signe une transaction EIP-1559 (type 2) ; renvoie le brut 0x02… et son hash */
const signTx1559 = (tx, pk) => {
  const fields = [big(tx.chainId), big(tx.nonce), big(tx.maxPriorityFeePerGas), big(tx.maxFeePerGas), big(tx.gas), tx.to ? unhex(checksum(tx.to)) : Buffer.alloc(0), big(tx.value || 0), tx.data ? unhex(tx.data) : Buffer.alloc(0), []];
  const unsigned = Buffer.concat([Buffer.from([2]), rlp(fields)]);
  const sig = secp256k1.sign(keccak(unsigned), unhex(pk), { lowS: true });
  const raw = Buffer.concat([Buffer.from([2]), rlp([...fields, BigInt(sig.recovery), strip(sig.r.toString(16)), strip(sig.s.toString(16))])]);
  return { raw: "0x" + hex(raw), hash: "0x" + hex(keccak(raw)) };
};

/* messages « personal_sign » (EIP-191) : signer et retrouver l'adresse */
const msgHash = (m) => { const b = typeof m === "string" && !/^0x[0-9a-f]*$/i.test(m) ? Buffer.from(m, "utf8") : unhex(m); return keccak(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${b.length}`), b])); };
const signMessage = (m, pk) => { const s = secp256k1.sign(msgHash(m), unhex(pk), { lowS: true }); return "0x" + hex(pad32(unhex(s.r.toString(16)))) + hex(pad32(unhex(s.s.toString(16)))) + (27 + s.recovery).toString(16); };
const recoverMessage = (m, sig) => {
  const b = unhex(sig);
  if (b.length !== 65) throw Object.assign(new Error("signature invalide (65 octets attendus)"), { permanent: true });
  let v = b[64]; if (v >= 27) v -= 27;
  const s = new secp256k1.Signature(BigInt("0x" + hex(b.slice(0, 32))), BigInt("0x" + hex(b.slice(32, 64)))).addRecoveryBit(v);
  return addrOfPub(s.recoverPublicKey(msgHash(m)).toRawBytes(false));
};
const newKey = () => { const pk = "0x" + hex(secp256k1.utils.randomPrivateKey()); return { cle: pk, adresse: addrOfKey(pk) }; };

module.exports = { keccak, checksum, addrOfKey, toUnits, fromUnits, parseSig, selector, encode, decode, callData, decodeLog, rlp, signTx1559, signMessage, recoverMessage, newKey, toHexQ, hex, unhex };
