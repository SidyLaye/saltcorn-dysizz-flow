/* Lecture des flux RSS / Atom (sites, YouTube). Pas de dépendance à Saltcorn :
   testé seul dans tests/feeds.test.cjs. */
"use strict";
const { XMLParser } = require("fast-xml-parser");
const { plain, safeUrl } = require("../core");

const UA = "Mozilla/5.0 (compatible; DysizzVeille/1.0; +https://github.com/SidyLaye/saltcorn-dysizz-modules)";

const httpGet = async (url, { timeout = 15000, headers = {} } = {}) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5", "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8", ...headers }, signal: ctl.signal, redirect: "follow" });
    const body = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return body;
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "délai dépassé (15 s)" : e.message);
  } finally { clearTimeout(t); }
};

const arr = (x) => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);
const txt = (x) => (x === undefined || x === null ? "" : typeof x === "object" ? (x["#text"] ?? x.__cdata ?? "") : String(x));
const attr = (x, a) => (x && typeof x === "object" ? x["@_" + a] : undefined);

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", cdataPropName: "__cdata", parseTagValue: false, trimValues: true, processEntities: true, htmlEntities: true });

const dateOf = (...cands) => {
  for (const c of cands) {
    const s = txt(c);
    if (!s) continue;
    const d = new Date(s);
    if (!isNaN(d)) return d;
  }
  return null;
};

const firstImg = (html) => {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(String(html || ""));
  return m ? safeUrl(m[1]) : "";
};

/* → [{titre, url, date, resume, image, auteur, video_id}] */
const parseFeed = (xml) => {
  const doc = parser.parse(xml);
  const out = [];
  if (doc.rss || doc["rdf:RDF"]) {
    const ch = doc.rss ? doc.rss.channel : doc["rdf:RDF"];
    const items = arr(doc.rss ? ch && ch.item : doc["rdf:RDF"].item);
    for (const it of items) {
      const desc = txt(it["content:encoded"]) || txt(it.description);
      const media = arr(it["media:content"]).concat(arr(it["media:thumbnail"])).map((m) => attr(m, "url")).find(Boolean);
      const encl = arr(it.enclosure).find((e) => /^image\//.test(attr(e, "type") || ""));
      let link = txt(it.link);
      if (!link && it.guid && attr(it.guid, "isPermaLink") !== "false") link = txt(it.guid);
      out.push({
        titre: plain(txt(it.title), 300), url: safeUrl(link.trim()), date: dateOf(it.pubDate, it["dc:date"], it.published),
        resume: plain(desc, 600), image: safeUrl(media || attr(encl, "url") || firstImg(desc)), auteur: plain(txt(it["dc:creator"]) || txt(it.author), 120), video_id: "",
      });
    }
  } else if (doc.feed) {
    for (const e of arr(doc.feed.entry)) {
      const links = arr(e.link);
      const alt = links.find((l) => !attr(l, "rel") || attr(l, "rel") === "alternate") || links[0];
      const group = e["media:group"] || {};
      const vid = txt(e["yt:videoId"]);
      const desc = txt(group["media:description"]) || txt(e.summary) || txt(e.content);
      out.push({
        titre: plain(txt(e.title), 300), url: safeUrl(attr(alt, "href") || txt(alt)), date: dateOf(e.published, e.updated),
        resume: plain(desc, 600), image: safeUrl(attr(group["media:thumbnail"], "url") || firstImg(txt(e.content))),
        auteur: plain(txt((arr(e.author)[0] || {}).name), 120), video_id: /^[\w-]{11}$/.test(vid) ? vid : "",
      });
    }
  } else throw new Error("ce n'est pas un flux RSS ou Atom");
  return out.filter((x) => x.titre && x.url);
};

/* @chaine ou lien de chaîne → identifiant UC… (lu dans la page de la chaîne) */
const resolveYoutube = async (handleOrUrl) => {
  const s = String(handleOrUrl || "").trim();
  const direct = /(UC[\w-]{22})/.exec(s);
  if (direct) return direct[1];
  const url = /^https?:/.test(s) ? s : `https://www.youtube.com/${s.startsWith("@") ? s : "@" + s}`;
  const html = await httpGet(url, { headers: { Cookie: "SOCS=CAI; CONSENT=YES+cb" } });
  const m = /"(?:channelId|externalId|browseId)":"(UC[\w-]{22})"/.exec(html) || /channel\/(UC[\w-]{22})/.exec(html);
  if (!m) throw new Error("identifiant de chaîne introuvable dans la page YouTube");
  return m[1];
};
const youtubeFeed = (id) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;

/* image d'illustration d'une page : og:image, twitter:image, <link rel=image_src>, puis 1re grande image */
const pageImage = (html, base) => {
  const h = String(html || "").slice(0, 300000);
  const meta = (re) => { const m = re.exec(h); return m ? m[1] : ""; };
  let u = meta(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i)
    || meta(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i)
    || meta(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i);
  if (!u) { const m = /<img[^>]+src=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/i.exec(h); u = m ? m[1] : ""; }
  if (!u) return "";
  try { return safeUrl(new URL(u.replace(/&amp;/g, "&"), base).href); } catch (e) { return ""; }
};

/* Lit un flux de façon robuste :
   - nouvel essai (autre User-Agent) si le site coupe la connexion ou répond 5xx ;
   - YouTube : si le flux de la chaîne répond 404 (arrive souvent), on lit la
     playlist « mises en ligne » de la chaîne (UU…) ;
   - page web au lieu d'un flux : on cherche le flux annoncé par la page
     (<link rel="alternate">), puis les adresses habituelles (/feed, /rss.xml…). */
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const isFeed = (t) => /<(rss|feed|rdf:RDF)[\s>]/i.test(String(t).slice(0, 3000));
const getRetry = async (url) => {
  try { return await httpGet(url); }
  catch (e) {
    if (!/fetch failed|HTTP 5\d\d|HTTP 403|HTTP 429|délai|ECONNRESET|socket/i.test(e.message)) throw e;
    await new Promise((r) => setTimeout(r, 1200));
    return httpGet(url, { timeout: 20000, headers: { "User-Agent": BROWSER_UA } });
  }
};
const discover = (html, base) => {
  const out = [];
  for (const m of String(html).slice(0, 400000).matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const h = /href=["']([^"']+)["']/i.exec(tag);
    if (h) { try { out.push(new URL(h[1].replace(/&amp;/g, "&"), base).href); } catch (e) { /* rien */ } }
  }
  return out;
};
const readFeed = async (url) => {
  const yt = /youtube\.com\/feeds\/videos\.xml\?channel_id=UC([\w-]{22})/.exec(url);
  let body;
  try { body = await getRetry(url); }
  catch (e) {
    if (yt && /HTTP (404|5\d\d)/.test(e.message)) { body = await getRetry(`https://www.youtube.com/feeds/videos.xml?playlist_id=UU${yt[1]}`); }
    else throw e;
  }
  if (isFeed(body)) return { items: parseFeed(body), url };
  const tried = new Set([url]);
  const cands = discover(body, url);
  const u0 = new URL(url);
  for (const pth of ["/feed", "/feed/", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/blog/feed", "/blog/rss.xml", "/blog/feed.xml"]) cands.push(u0.origin + pth);
  for (const c of cands) {
    if (tried.has(c)) continue; tried.add(c);
    try { const b = await httpGet(c, { timeout: 10000 }); if (isFeed(b)) return { items: parseFeed(b), url: c, trouve: true }; } catch (e) { /* suivant */ }
    if (tried.size > 8) break;
  }
  throw new Error("cette adresse est une page web sans flux RSS trouvé : mets l'adresse du flux (souvent …/feed ou …/rss.xml)");
};

module.exports = { pageImage, parseFeed, resolveYoutube, youtubeFeed, httpGet, UA, readFeed, discover };
