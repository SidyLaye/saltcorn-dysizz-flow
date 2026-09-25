/* Blocs 2.3 : stockage, documents, blockchain, pratique… sans Saltcorn ni réseau (fetch simulé). */
const assert = require("assert");
const zlib = require("zlib");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { BLOCKS } = require("../src/blocks");
const B = (n) => BLOCKS.find((b) => b.name === n);
const SECRETS = { S3_CLES: "AKID:SECRET", PORTEFEUILLE_CLE: "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318", OVH_CLES: "a:b:c" };
const api = { secret: async (n) => SECRETS[n], user: { id: 1, role_id: 1 }, log: () => {} };
const run = (n, p, ctx = {}) => B(n).run(p, ctx, api);
const B64 = { sortie_fichier: "base64 (dans le workflow)" };

let routes = [];
global.fetch = async (url, opt = {}) => {
  const r = routes.find((x) => x.test(String(url), opt));
  if (!r) throw new Error("fetch inattendu " + url);
  const res = await r.res(String(url), opt);
  const body = typeof res === "string" || Buffer.isBuffer(res) ? res : JSON.stringify(res);
  return { ok: true, status: 200, url: String(url), headers: new Map([["content-type", r.type || "application/json"]]), text: async () => String(body), json: async () => JSON.parse(body), arrayBuffer: async () => Buffer.from(body) };
};
const route = (re, res, type) => ({ test: (u) => re.test(u), res, type });

(async () => {
  /* ZIP : aller-retour, noms en double, filtre */
  const z = await run("dzf_zip", { fichiers: [{ nom: "a.txt", contenu: "Bonjour é" }, { nom: "a.txt", contenu: "deux" }, { nom: "data.json", contenu: { x: 1 } }], nom: "t", ...B64 });
  assert.strictEqual(z.nom, "t.zip");
  const back = await run("dzf_dezipper", { archive: z, ...B64 });
  assert.deepStrictEqual(back.map((x) => x.nom), ["a.txt", "a-1.txt", "data.json"]);
  assert.strictEqual(back[0].texte, "Bonjour é");
  assert.strictEqual(JSON.parse(back[2].texte).x, 1);
  const bomb = require("../src/lib/zip").writeZip([{ nom: "b.txt", contenu: Buffer.alloc(3 * 1024 * 1024) }]);
  await assert.rejects(run("dzf_dezipper", { archive: { base64: bomb.toString("base64") }, max_mo: 1, ...B64 }), /bombe/);

  /* base64 et empreinte */
  const e = await run("dzf_base64", { source: "abc", operation: "empreinte", algo: "sha256" });
  assert.strictEqual(e.hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.strictEqual(await run("dzf_base64", { source: "aGVsbG8=", operation: "depuis base64 (texte)" }), "hello");

  /* S3 : signature présente, liste XML décodée, lien signé */
  let seen;
  routes = [route(/s3\.test/, (u, o) => { seen = { u, o }; return "<ListBucketResult><Contents><Key>f/a&amp;b.txt</Key><Size>12</Size><LastModified>2026-01-01T00:00:00Z</LastModified><ETag>\"x\"</ETag></Contents><CommonPrefixes><Prefix>f/sous/</Prefix></CommonPrefixes><IsTruncated>false</IsTruncated></ListBucketResult>"; }, "application/xml")];
  const S = { point: "https://s3.test", region: "gra", seau: "seau", cles: "S3_CLES", style: "chemin" };
  const l = await run("dzf_s3_lister", { ...S, prefixe: "f/" });
  assert.deepStrictEqual(l.fichiers[0], { cle: "f/a&b.txt", octets: 12, modifie: "2026-01-01T00:00:00Z", etag: "x" });
  assert.deepStrictEqual(l.dossiers, ["f/sous/"]);
  assert.match(seen.o.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/gra\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  const lien = await run("dzf_s3_lien", { ...S, cle: "a b.pdf", usage: "télécharger", duree: 10 });
  assert.match(lien.url, /^https:\/\/s3\.test\/seau\/a%20b\.pdf\?X-Amz-Algorithm=AWS4-HMAC-SHA256&.*X-Amz-Expires=600.*&X-Amz-Signature=[0-9a-f]{64}$/);
  await assert.rejects(run("dzf_s3_lister", { ...S, cles: "ABSENT" }), /introuvable/);

  /* PDF : créé, valide, texte relu */
  const pdf = await run("dzf_pdf_creer", { format: "Markdown", contenu: "# Facture été\n\nTotal : 12,50 €\n\n| A | B |\n|---|---|\n| 1 | 2 |", nom: "f", ...B64 });
  const pbuf = Buffer.from(pdf.base64, "base64");
  assert.strictEqual(pbuf.slice(0, 5).toString(), "%PDF-");
  assert.match(require("../src/lib/pdf").lireTextePdf(pbuf), /Facture été[\s\S]*12,50 €/);
  assert.match(await run("dzf_document_texte", { fichier: { base64: pdf.base64, nom: "f.pdf", type: "application/pdf" }, moteur: "intégré" }), /Total/);

  /* Excel : écrire puis relire, colonnes choisies */
  const x = await run("dzf_excel_ecrire", { donnees: [{ nom: "Awa", age: 31, ville: "Dakar" }, { nom: "Léo", age: 7, ville: "Lyon" }], colonnes: "nom, age", ...B64 });
  const rows = await run("dzf_excel_lire", { fichier: { base64: x.base64, nom: "e.xlsx" }, feuille: "1", entete: true });
  assert.deepStrictEqual(rows, [{ nom: "Awa", age: 31 }, { nom: "Léo", age: 7 }]);

  /* Word : modèle avec {{champ}} coupé en plusieurs morceaux par Word */
  const { writeZip } = require("../src/lib/zip");
  const tpl = writeZip([{ nom: "word/document.xml", contenu: '<w:document><w:body><w:p><w:r><w:t>Bonjour {{cli</w:t></w:r><w:r><w:t>ent.nom}} !</w:t></w:r></w:p></w:body></w:document>' }]);
  const filled = await run("dzf_word", { action: "remplir un modèle", fichier: { base64: tpl.toString("base64"), nom: "m.docx" }, ...B64 }, { client: { nom: "A & B" } });
  assert.match(require("../src/lib/zip").readZip(Buffer.from(filled.base64, "base64"))[0].contenu.toString(), /Bonjour A &amp; B !/);

  /* QR et Markdown */
  const q = await run("dzf_qr", { type: "virement SEPA", beneficiaire: "AMBS", iban: "FR76 3000 6000 0112 3456 7890 189", montant: "12.5", reference: "F-42", taille: 200 });
  assert.match(q.svg, /^<svg/); assert.match(q.contenu, /^BCD\n002\n1\nSCT\n\nAMBS\nFR7630006000011234567890189\nEUR12.50/);
  assert.strictEqual(await run("dzf_markdown", { markdown: "# T\n\n**gras** <script>x</script>\n\n- a\n- b" }), "<h1>T</h1>\n<p><strong>gras</strong> &lt;script&gt;x&lt;/script&gt;</p>\n<ul><li>a</li><li>b</li></ul>");

  /* Blockchain : solde (nœud simulé), signature, envoi refusé au-dessus du plafond */
  routes = [route(/rpc\.test/, (u, o) => { const b = JSON.parse(o.body); const R = { eth_getBalance: "0xde0b6b3a7640000", eth_call: "0x" + "0".repeat(62) + "06" }; return { jsonrpc: "2.0", id: b.id, result: R[b.method] }; })];
  const sol = await run("dzf_evm_solde", { reseau: "Ethereum", rpc: "https://rpc.test", adresse: "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23" });
  assert.strictEqual(sol.solde, "1"); assert.strictEqual(sol.adresse, "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23");
  const sig = await run("dzf_evm_signature", { action: "signer", message: "Bonjour", cle: "PORTEFEUILLE_CLE" });
  const ver = await run("dzf_evm_signature", { action: "vérifier", message: "Bonjour", signature: sig.signature, adresse: sig.adresse });
  assert(ver.valide);
  await assert.rejects(run("dzf_evm_envoyer", { reseau: "Ethereum", rpc: "https://rpc.test", cle: "PORTEFEUILLE_CLE", type_envoi: "monnaie du réseau", vers: sol.adresse, montant: "5", plafond: "0.1" }), /plafond/);

  /* Pratique : météo simulée, change avec franc CFA, IBAN, cron */
  routes = [route(/geocoding-api/, () => ({ results: [{ name: "Dakar", admin1: "Dakar", latitude: 14.69, longitude: -17.44, country: "Sénégal" }] })),
    route(/api\.open-meteo/, () => ({ current: { temperature_2m: 28.4, apparent_temperature: 31, relative_humidity_2m: 70, weather_code: 2, wind_speed_10m: 12, precipitation: 0 }, daily: { time: ["2026-09-24"], temperature_2m_min: [24], temperature_2m_max: [30], precipitation_sum: [0], precipitation_probability_max: [5], uv_index_max: [8], sunrise: ["06:50"], sunset: ["19:05"], weather_code: [2] } })),
    route(/frankfurter/, () => ({ rates: { USD: 1.1 } }))];
  const m = await run("dzf_meteo", { lieu: "Dakar", jours: 1 });
  assert.strictEqual(m.resume, "⛅ Partiellement nuageux, 28 °C (ressenti 31 °C)");
  assert.deepStrictEqual(await run("dzf_change", { montant: 100, de: "EUR", vers: "XOF,USD" }), { XOF: 65595.7, USD: 110 });
  assert.strictEqual(await run("dzf_change", { montant: 655.957, de: "XOF", vers: "EUR" }), 1);
  assert.strictEqual((await run("dzf_verifier_numero", { type: "IBAN", numero: "FR76 3000 6000 0112 3456 7890 189" })).valide, true);
  assert.strictEqual((await run("dzf_verifier_numero", { type: "TVA intracommunautaire", numero: "FR40303265045" })).valide, true);
  assert.strictEqual((await run("dzf_cron", { expression: "0 9 * * 1-5", n: 3 })).prochaines.length, 3);

  /* IA : découpage */
  const parts = await run("dzf_ia_decouper", { texte: "Phrase. ".repeat(600), taille: 500, recouvrement: 50 });
  assert(parts.length >= 8 && parts.every((x) => x.texte.length <= 760), "découpage");

  /* flux : page web → flux découvert ; YouTube 404 → playlist des mises en ligne */
  const RSS = '<?xml version="1.0"?><rss><channel><item><title>Un article</title><link>https://site.test/a</link></item></channel></rss>';
  const ATOM = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Vidéo</title><link href="https://www.youtube.com/watch?v=abc"/><yt:videoId>abc</yt:videoId></entry></feed>';
  routes = [route(/site\.test\/$/, () => '<html><head><link rel="alternate" type="application/rss+xml" href="/blog/flux.xml"></head></html>', "text/html"), route(/site\.test\/blog\/flux\.xml/, () => RSS, "application/rss+xml"),
    { test: (u) => /channel_id=/.test(u), res: () => { throw new Error("HTTP 404"); } }, route(/playlist_id=UU/, () => ATOM, "application/atom+xml")];
  global.fetch = ((f) => async (u, o) => { const r = routes.find((x) => x.test(String(u))); if (r && /channel_id=/.test(u)) return { ok: false, status: 404, text: async () => "" }; return f(u, o); })(global.fetch);
  const fl = (await B("dzf_rss").run({ sources: [{ id: 1, url: "https://site.test/" }, { id: 2, youtube_id: "UC" + "a".repeat(22) }], max_par_source: 5 }, {}, { ...api, out: "articles" })).__merge;
  assert.strictEqual(fl.articles.length, 2, JSON.stringify(fl.articles_erreurs));
  assert.deepStrictEqual(fl.articles_chaines, [{ source: 1, flux: "https://site.test/blog/flux.xml" }]);

  console.log("blocs 2.3 : ok");
})().catch((e) => { console.error(e); process.exit(1); });
