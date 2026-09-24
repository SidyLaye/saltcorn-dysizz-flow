/* dzf_emplois : plusieurs sources simulées, filtre, dédoublonnage, source en panne. */
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { BLOCKS } = require("../src/blocks");
const B = BLOCKS.find((b) => b.name === "dzf_emplois");
const now = new Date().toISOString();
const FIX = {
  "remotive.com": { jobs: [{ id: 1, title: "Senior DevOps Engineer", company_name: "Acme", candidate_required_location: "Europe", url: "https://r/1", publication_date: now, description: "kubernetes" }, { id: 2, title: "Designer", company_name: "X", candidate_required_location: "USA only", url: "https://r/2", publication_date: now }] },
  "jobicy.com": { jobs: [{ id: 9, jobTitle: "DevOps Engineer (senior)", companyName: "acme", jobGeo: "Anywhere", url: "https://j/9", pubDate: now }] },
  "www.arbeitnow.com": { data: [{ slug: "a", title: "DevOps Engineer", company_name: "Berlin GmbH", location: "Berlin", url: "https://a/a", created_at: Date.now() / 1000 }, { slug: "b", title: "DevOps Paris", company_name: "Parisco", location: "Paris", url: "https://a/b", created_at: Date.now() / 1000 }] },
};
global.fetch = async (u) => {
  const h = new URL(u).hostname;
  if (h === "himalayas.app") return { ok: false, status: 503, text: async () => "down" };
  return { ok: true, status: 200, text: async () => JSON.stringify(FIX[h] || {}) };
};
(async () => {
  const api = { secret: async () => undefined, out: "offres" };
  const r = await B.run({ sources: "remotive,jobicy,arbeitnow,himalayas,adzuna", mots_cles: "devops", depuis_jours: 7, max: 50 }, {}, api);
  const o = r.__merge.offres, s = r.__merge.offres_sources;
  const titres = o.map((x) => x.titre);
  assert(titres.includes("Senior DevOps Engineer"), "remotive europe gardée");
  assert(!titres.includes("Designer"), "mots-clés filtrés");
  assert(titres.includes("DevOps Paris") && !titres.includes("DevOps Engineer") || titres.filter((t) => /DevOps Engineer/.test(t)).length >= 1, "arbeitnow : France gardée");
  assert(!o.some((x) => x.entreprise === "Berlin GmbH"), "hors France écarté");
  assert(s.find((x) => x.source === "himalayas").ok === false, "source en panne signalée");
  assert(s.find((x) => x.source === "adzuna").ignoree === true, "source sans clé ignorée");
  console.log("emplois OK :", o.length, "offres,", s.filter((x) => x.ok).length, "sources ok");
})().catch((e) => { console.error(e); process.exit(1); });
