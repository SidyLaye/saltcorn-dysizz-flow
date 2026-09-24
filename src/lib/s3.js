/* Client S3 minimal (signature AWS v4), compatible AWS, OVH, Scaleway, MinIO,
   Cloudflare R2, Backblaze B2, Wasabi, Garage… Sans dépendance. */
"use strict";
const crypto = require("crypto");

const hmac = (k, s) => crypto.createHmac("sha256", k).update(s).digest();
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (k) => String(k).split("/").map(enc).join("/");

/* cfg : { endpoint, region, bucket, access, secret, style: "chemin"|"domaine" } */
const target = (cfg, key = "") => {
  const u = new URL(cfg.endpoint || `https://s3.${cfg.region || "us-east-1"}.amazonaws.com`);
  const k = String(key).replace(/^\/+/, "");
  if (cfg.style === "domaine" && cfg.bucket) { u.hostname = `${cfg.bucket}.${u.hostname}`; u.pathname = "/" + encPath(k); }
  else u.pathname = (u.pathname.replace(/\/$/, "") + "/" + (cfg.bucket ? enc(cfg.bucket) + "/" : "") + encPath(k)).replace(/\/+/g, "/");
  return u;
};

const scope = (cfg, date) => `${date.slice(0, 8)}/${cfg.region || "us-east-1"}/s3/aws4_request`;
const skey = (cfg, date) => hmac(hmac(hmac(hmac("AWS4" + cfg.secret, date.slice(0, 8)), cfg.region || "us-east-1"), "s3"), "aws4_request");
const canonQuery = (q) => Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k] ?? "")}`).join("&");
const amzDate = (d = new Date()) => d.toISOString().replace(/[:-]|\.\d{3}/g, "");

const request = async (cfg, method, key, { query = {}, body, headers = {} } = {}) => {
  const u = target(cfg, key);
  const date = amzDate();
  const payload = body ? sha(body) : sha("");
  const h = { host: u.host, "x-amz-date": date, "x-amz-content-sha256": payload, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])) };
  const names = Object.keys(h).sort();
  const creq = [method, u.pathname, canonQuery(query), names.map((n) => `${n}:${String(h[n]).trim()}\n`).join(""), names.join(";"), payload].join("\n");
  const sts = ["AWS4-HMAC-SHA256", date, scope(cfg, date), sha(creq)].join("\n");
  const sig = crypto.createHmac("sha256", skey(cfg, date)).update(sts).digest("hex");
  const qs = canonQuery(query);
  const { host, ...send } = h;
  const r = await fetch(u.origin + u.pathname + (qs ? "?" + qs : ""), { method, body, headers: { ...send, Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.access}/${scope(cfg, date)}, SignedHeaders=${names.join(";")}, Signature=${sig}` } });
  if (!r.ok && !(method === "DELETE" && r.status === 404)) {
    const t = await r.text();
    const code = (t.match(/<Code>([^<]+)/) || [])[1], msg = (t.match(/<Message>([^<]+)/) || [])[1];
    throw Object.assign(new Error(`S3 : HTTP ${r.status}${code ? ` ${code}` : ""}${msg ? ` — ${msg}` : ""}`), { permanent: [403, 400, 404].includes(r.status) });
  }
  return r;
};

/* lien signé (téléchargement ou dépôt direct) valable `secondes` */
const presign = (cfg, method, key, secondes = 3600) => {
  const u = target(cfg, key);
  const date = amzDate();
  const q = { "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${cfg.access}/${scope(cfg, date)}`, "X-Amz-Date": date, "X-Amz-Expires": String(Math.min(604800, Math.max(1, +secondes || 3600))), "X-Amz-SignedHeaders": "host" };
  const creq = [method, u.pathname, canonQuery(q), `host:${u.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const sig = crypto.createHmac("sha256", skey(cfg, date)).update(["AWS4-HMAC-SHA256", date, scope(cfg, date), sha(creq)].join("\n")).digest("hex");
  return `${u.origin}${u.pathname}?${canonQuery(q)}&X-Amz-Signature=${sig}`;
};

const xmlVal = (s, tag) => { const m = s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'") : undefined; };

const list = async (cfg, prefix = "", max = 1000) => {
  const out = [], dossiers = new Set();
  let token;
  do {
    const q = { "list-type": "2", prefix, delimiter: "/", "max-keys": String(Math.min(1000, max - out.length)) };
    if (token) q["continuation-token"] = token;
    const t = await (await request(cfg, "GET", "", { query: q })).text();
    for (const c of t.match(/<Contents>[\s\S]*?<\/Contents>/g) || []) out.push({ cle: xmlVal(c, "Key"), octets: +xmlVal(c, "Size"), modifie: xmlVal(c, "LastModified"), etag: String(xmlVal(c, "ETag") || "").replace(/"/g, "") });
    for (const c of t.match(/<CommonPrefixes>[\s\S]*?<\/CommonPrefixes>/g) || []) dossiers.add(xmlVal(c, "Prefix"));
    token = xmlVal(t, "IsTruncated") === "true" ? xmlVal(t, "NextContinuationToken") : null;
  } while (token && out.length < max);
  return { fichiers: out, dossiers: [...dossiers] };
};

module.exports = { request, presign, list, target, sha };
