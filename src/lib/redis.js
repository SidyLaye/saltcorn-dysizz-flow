/* Client Redis minimal (protocole RESP) sans dépendance : une connexion par
   processus, réutilisée, commandes en file. Suffisant pour cache, compteurs,
   limites de débit, files et verrous. Adresse : REDIS_URL=redis://:motdepasse@redis:6379/0 */
"use strict";
const net = require("net");

let conn = null;

const encode = (args) => `*${args.length}\r\n` + args.map((a) => { const s = String(a); return `$${Buffer.byteLength(s)}\r\n${s}\r\n`; }).join("");

/* lit une réponse RESP à partir de buf[i] ; renvoie [valeur, nouvel index] ou null si incomplet */
const parse = (buf, i = 0) => {
  if (i >= buf.length) return null;
  const type = String.fromCharCode(buf[i]);
  const end = buf.indexOf("\r\n", i);
  if (end < 0) return null;
  const line = buf.toString("utf8", i + 1, end);
  const next = end + 2;
  if (type === "+") return [line, next];
  if (type === "-") return [new Error(line), next];
  if (type === ":") return [Number(line), next];
  if (type === "$") {
    const n = Number(line);
    if (n < 0) return [null, next];
    if (buf.length < next + n + 2) return null;
    return [buf.toString("utf8", next, next + n), next + n + 2];
  }
  if (type === "*") {
    const n = Number(line);
    if (n < 0) return [null, next];
    const out = [];
    let j = next;
    for (let k = 0; k < n; k++) { const r = parse(buf, j); if (!r) return null; out.push(r[0]); j = r[1]; }
    return [out, j];
  }
  throw new Error("réponse Redis inattendue");
};

const connect = (url) => new Promise((resolve, reject) => {
  const u = new URL(url || process.env.REDIS_URL || "redis://redis:6379");
  const sock = net.createConnection({ host: u.hostname, port: +u.port || 6379 });
  const c = { sock, queue: [], buf: Buffer.alloc(0), url };
  sock.setKeepAlive(true);
  sock.setTimeout(0);
  sock.on("data", (d) => {
    c.buf = Buffer.concat([c.buf, d]);
    for (;;) {
      const r = parse(c.buf);
      if (!r) break;
      c.buf = c.buf.subarray(r[1]);
      const q = c.queue.shift();
      if (q) (r[0] instanceof Error ? q.reject(r[0]) : q.resolve(r[0]));
    }
  });
  const fail = (e) => { for (const q of c.queue.splice(0)) q.reject(e); if (conn === c) conn = null; };
  sock.on("error", (e) => { fail(e); reject(e); });
  sock.on("close", () => fail(new Error("connexion Redis fermée")));
  sock.on("connect", async () => {
    try {
      if (u.password) await send(c, u.username ? ["AUTH", decodeURIComponent(u.username), decodeURIComponent(u.password)] : ["AUTH", decodeURIComponent(u.password)]);
      const db = u.pathname && u.pathname.slice(1);
      if (db) await send(c, ["SELECT", db]);
      resolve(c);
    } catch (e) { reject(e); }
  });
});

const send = (c, args) => new Promise((resolve, reject) => { c.queue.push({ resolve, reject }); c.sock.write(encode(args)); });

let pending = null;
const cmd = async (args, url) => {
  const want = url || process.env.REDIS_URL || "redis://redis:6379";
  if (!conn || conn.url !== want) {
    /* une seule connexion même si plusieurs blocs démarrent en même temps */
    if (!pending || pending.url !== want) {
      pending = connect(want).then((c) => { c.url = want; conn = c; return c; }).finally(() => { pending = null; });
      pending.url = want;
    }
    await pending;
  }
  return send(conn, args);
};

const available = () => !!process.env.REDIS_URL;

module.exports = { cmd, available, encode, parse };
