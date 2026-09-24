/* Emploi : chercher des offres dans plusieurs sources publiques à la fois.
   Sans clé : Arbeitnow (Europe), Remotive, RemoteOK, Jobicy, Himalayas (télétravail),
   n'importe quel flux RSS de site d'emploi.
   Avec clé gratuite (rangée dans le coffre) : France Travail, Adzuna, Jooble.
   Chaque source est lue à part : une source en panne n'empêche pas les autres.
   Les offres sont ramenées à un même format et dédoublonnées (titre + entreprise). */
"use strict";
const { plain, safeUrl } = require("../core");
const { asList, pool } = require("../engine");
const { parseFeed, httpGet } = require("../lib/feeds");

const UA = { "User-Agent": "Mozilla/5.0 (dysizz-flow; veille emploi)", Accept: "application/json" };
const getJSON = async (url, opt = {}) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opt.timeout || 20000);
  try {
    const r = await fetch(url, { ...opt, headers: { ...UA, ...(opt.headers || {}) }, signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return JSON.parse(txt);
  } catch (e) { throw new Error(e.name === "AbortError" ? "délai dépassé" : e.message); } finally { clearTimeout(t); }
};
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const words = (s) => String(s || "").split(",").map((x) => norm(x).trim()).filter(Boolean);
/* un des mots-clés (tous ses mots) se trouve dans le texte */
const matches = (txt, kws) => !kws.length || kws.some((k) => k.split(/\s+/).every((w) => norm(txt).includes(w)));
const ALL_OK = /(france|europe|emea|worldwide|anywhere|remote|monde|partout|cet|utc\+[0-2]\b|utc ?[+-]1\b)/i;
const offer = (o) => ({
  ref: String(o.ref).slice(0, 200), titre: plain(o.titre, 300), entreprise: plain(o.entreprise || "", 200), lieu: plain(o.lieu || "", 200),
  contrat: plain(o.contrat || "", 120), salaire: plain(o.salaire || "", 200), experience: plain(o.experience || "", 200), date: o.date || null,
  url: safeUrl(o.url), description: plain(o.description || "", 8000), source: o.source, logo: safeUrl(o.logo || ""), teletravail: !!o.teletravail,
});

const SOURCES = {
  france_travail: { label: "France Travail", key: true, run: async (q, api) => {
    const ft = require("./services").find((b) => b.name === "dzf_france_travail");
    const list = await ft.run({ variable_id: "FT_CLIENT_ID", variable_secret: "FT_CLIENT_SECRET", mots_cles: q.mots_cles, departement: q.departement, commune: q.commune, rayon_km: q.rayon_km, contrat: q.contrat, alternance: q.alternance, depuis_jours: q.depuis_jours }, {}, api);
    return list.map((o) => ({ ...o, ref: `ft:${o.ref}` }));
  } },
  adzuna: { label: "Adzuna", key: true, run: async (q, api) => {
    const id = await api.secret("ADZUNA_APP_ID"), key = await api.secret("ADZUNA_APP_KEY");
    if (!id || !key) throw Object.assign(new Error("clés ADZUNA_APP_ID / ADZUNA_APP_KEY absentes"), { skip: true });
    const u = new URLSearchParams({ app_id: id, app_key: key, results_per_page: "50", what_or: q.kws.join(" "), max_days_old: String(q.depuis_jours || 7), sort_by: "date", "content-type": "application/json" });
    if (q.lieu) u.set("where", q.lieu);
    const j = await getJSON(`https://api.adzuna.com/v1/api/jobs/fr/search/1?${u}`);
    return (j.results || []).map((o) => ({ ref: `adzuna:${o.id}`, titre: o.title, entreprise: (o.company || {}).display_name, lieu: (o.location || {}).display_name, contrat: [o.contract_type, o.contract_time].filter(Boolean).join(" "), salaire: o.salary_min ? `${Math.round(o.salary_min)}–${Math.round(o.salary_max || o.salary_min)} €` : "", date: o.created, url: o.redirect_url, description: o.description, source: "Adzuna" }));
  } },
  jooble: { label: "Jooble", key: true, run: async (q, api) => {
    const key = await api.secret("JOOBLE_KEY");
    if (!key) throw Object.assign(new Error("clé JOOBLE_KEY absente"), { skip: true });
    const j = await getJSON(`https://fr.jooble.org/api/${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords: q.kws.join(" "), location: q.lieu || "France", page: 1 }) });
    return (j.jobs || []).map((o) => ({ ref: `jooble:${o.id || o.link}`, titre: o.title, entreprise: o.company, lieu: o.location, contrat: o.type, salaire: o.salary, date: o.updated, url: o.link, description: o.snippet, source: `Jooble${o.source ? " · " + o.source : ""}` }));
  } },
  arbeitnow: { label: "Arbeitnow (Europe)", run: async (q) => {
    const j = await getJSON(`https://www.arbeitnow.com/api/job-board-api${q.teletravail ? "?remote=true" : ""}`);
    return (j.data || []).map((o) => ({ ref: `arbeitnow:${o.slug}`, titre: o.title, entreprise: o.company_name, lieu: o.location, contrat: (o.job_types || []).join(", "), date: o.created_at ? new Date(o.created_at * 1000).toISOString() : null, url: o.url, description: `${(o.tags || []).join(", ")} ${o.description || ""}`, source: "Arbeitnow", teletravail: !!o.remote }))
      .filter((o) => q.teletravail ? o.teletravail : /france|paris|lyon|remote/i.test(o.lieu));
  } },
  remotive: { label: "Remotive (télétravail)", run: async (q) => {
    const j = await getJSON(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q.kws[0] || "")}&limit=100`);
    return (j.jobs || []).map((o) => ({ ref: `remotive:${o.id}`, titre: o.title, entreprise: o.company_name, lieu: o.candidate_required_location, contrat: o.job_type, salaire: o.salary, date: o.publication_date, url: o.url, description: o.description, source: "Remotive", logo: o.company_logo, teletravail: true }));
  } },
  remoteok: { label: "RemoteOK (télétravail)", run: async () => {
    const j = await getJSON("https://remoteok.com/api");
    return (Array.isArray(j) ? j : []).filter((o) => o && o.id && o.position).map((o) => ({ ref: `remoteok:${o.id}`, titre: o.position, entreprise: o.company, lieu: o.location || "Télétravail", salaire: o.salary_min ? `${o.salary_min}–${o.salary_max} $` : "", date: o.date, url: o.url || o.apply_url, description: `${(o.tags || []).join(", ")} ${o.description || ""}`, source: "RemoteOK", logo: o.company_logo || o.logo, teletravail: true }));
  } },
  jobicy: { label: "Jobicy (télétravail)", run: async (q) => {
    const u = new URLSearchParams({ count: "100" });
    if (q.kws[0]) u.set("tag", q.kws[0]);
    const j = await getJSON(`https://jobicy.com/api/v2/remote-jobs?${u}`);
    return (j.jobs || []).map((o) => ({ ref: `jobicy:${o.id}`, titre: o.jobTitle, entreprise: o.companyName, lieu: o.jobGeo, contrat: [].concat(o.jobType || []).join(", "), salaire: o.annualSalaryMin ? `${o.annualSalaryMin}–${o.annualSalaryMax} ${o.salaryCurrency || ""}` : "", date: o.pubDate, url: o.url, description: `${o.jobIndustry || ""} ${o.jobExcerpt || o.jobDescription || ""}`, source: "Jobicy", logo: o.companyLogo, teletravail: true }));
  } },
  himalayas: { label: "Himalayas (télétravail)", run: async () => {
    const j = await getJSON("https://himalayas.app/jobs/api?limit=100");
    return (j.jobs || []).map((o) => ({ ref: `himalayas:${o.guid || o.applicationLink}`, titre: o.title, entreprise: o.companyName, lieu: [].concat(o.locationRestrictions || []).join(", ") || "Monde", contrat: o.employmentType, salaire: o.minSalary ? `${o.minSalary}–${o.maxSalary} ${o.currency || ""}` : "", date: o.pubDate ? new Date(o.pubDate * (o.pubDate < 1e12 ? 1000 : 1)).toISOString() : null, url: o.applicationLink, description: `${(o.categories || []).join(", ")} ${o.excerpt || o.description || ""}`, source: "Himalayas", logo: o.companyLogo, teletravail: true }));
  } },
  rss: { label: "Flux RSS d'offres", run: async (q) => {
    const out = [];
    for (const u of asList(q.flux_rss).flatMap((x) => String(x).split(/[\s,]+/)).filter((x) => /^https?:/.test(x))) {
      const items = parseFeed(await httpGet(u, { timeout: 15000 }));
      for (const it of items) out.push({ ref: `rss:${it.url}`, titre: it.titre, entreprise: it.auteur, lieu: "", date: it.date, url: it.url, description: it.resume, source: new URL(u).hostname.replace(/^www\./, "") });
    }
    return out;
  } },
};

module.exports = [{
  name: "dzf_emplois", label: "Emploi : chercher dans plusieurs sources", category: "Services", icon: "fas fa-briefcase", output: "offres", timeout: 240,
  description: "Cherche des offres dans plusieurs sources à la fois (France Travail, Adzuna, Jooble, Arbeitnow, Remotive, RemoteOK, Jobicy, Himalayas, flux RSS), filtre par mots-clés, lieu, télétravail et date, et renvoie une liste propre et sans doublon. Les sources en panne sont listées dans <sortie>_sources.",
  params: [
    { name: "sources", label: "Sources", default: "france_travail,adzuna,jooble,arbeitnow,remotive,jobicy,himalayas,remoteok", help: `Séparées par des virgules : ${Object.entries(SOURCES).map(([k, v]) => `${k} (${v.label}${v.key ? ", clé" : ""})`).join(", ")}` },
    { name: "mots_cles", label: "Mots-clés", required: true, help: "Séparés par des virgules : une offre doit contenir au moins un des mots-clés (tous ses mots)" },
    { name: "departement", label: "Département(s) (France Travail)" }, { name: "lieu", label: "Ville ou région (Adzuna, Jooble)", help: "Ex. Paris, Île-de-France" },
    { name: "commune", label: "Code commune INSEE (France Travail)" }, { name: "rayon_km", label: "Rayon km (France Travail)", type: "int" },
    { name: "contrat", label: "Contrat (France Travail : CDI, CDD…)" }, { name: "alternance", label: "Alternance seulement", type: "bool" },
    { name: "teletravail", label: "Télétravail seulement", type: "bool" }, { name: "depuis_jours", label: "Publiées depuis (jours)", type: "int", default: 7 },
    { name: "flux_rss", label: "Flux RSS d'offres (si source rss)", help: "Une ou plusieurs adresses" }, { name: "max", label: "Offres max", type: "int", default: 300 },
  ],
  run: async (p, ctx, api) => {
    const q = { ...p, kws: words(p.mots_cles), lieu: String(p.lieu || "").trim() };
    const wanted = String(p.sources || "").split(",").map((s) => s.trim()).filter((s) => SOURCES[s]);
    const since = Date.now() - (+p.depuis_jours || 7) * 864e5;
    const bilan = [];
    const lists = await pool(wanted, 4, async (s) => {
      const t0 = Date.now();
      try {
        let l = (await SOURCES[s].run(q, api)).map(offer).filter((o) => o.titre && o.url);
        if (s !== "france_travail" && s !== "adzuna" && s !== "jooble") {
          l = l.filter((o) => matches(`${o.titre} ${o.description}`, q.kws));
          if (!p.teletravail) l = l.filter((o) => !o.teletravail || ALL_OK.test(o.lieu));
          if (p.alternance) l = l.filter((o) => /altern|apprenti|work.?study|stage|intern/i.test(`${o.titre} ${o.contrat} ${o.description.slice(0, 400)}`));
        }
        l = l.filter((o) => !o.date || new Date(o.date).getTime() >= since);
        bilan.push({ source: s, ok: true, offres: l.length, ms: Date.now() - t0 });
        return l;
      } catch (e) { bilan.push({ source: s, ok: false, ignoree: !!e.skip, erreur: e.message, ms: Date.now() - t0 }); return []; }
    });
    const seen = new Set();
    const out = [];
    for (const o of lists.flat().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))) {
      const k = norm(`${o.titre}|${o.entreprise}`).replace(/[^a-z0-9|]/g, "");
      if (seen.has(k)) continue;
      seen.add(k); out.push(o);
      if (out.length >= (+p.max || 300)) break;
    }
    const k = api.out || "offres";
    return { __merge: { [k]: out, [`${k}_sources`]: bilan } };
  },
}];
module.exports.SOURCES = SOURCES;
