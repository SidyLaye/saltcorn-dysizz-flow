/* Services publics et pratiques, gratuits et sans clé pour la plupart :
   météo, adresses et cartes, itinéraires, jours fériés, entreprises (SIRENE),
   taux de change, Wikipédia, vérifications (IBAN, SIRET, TVA), dates cron, Stripe. */
"use strict";
const perm = (m) => Object.assign(new Error(m), { permanent: true });
const need = async (api, name) => { const v = await api.secret(name); if (!v) throw perm(`secret ${name} introuvable (variable d'environnement ou coffre)`); return v; };
const get = async (url, name, headers = {}) => {
  const r = await fetch(url, { headers: { "User-Agent": "dysizz-flow/2 (+https://github.com/SidyLaye)", Accept: "application/json", ...headers } });
  if (!r.ok) throw new Error(`${name} : HTTP ${r.status}`);
  return r.json();
};
const WMO = { 0: ["Ciel dégagé", "☀️"], 1: ["Plutôt dégagé", "🌤️"], 2: ["Partiellement nuageux", "⛅"], 3: ["Couvert", "☁️"], 45: ["Brouillard", "🌫️"], 48: ["Brouillard givrant", "🌫️"], 51: ["Bruine légère", "🌦️"], 53: ["Bruine", "🌦️"], 55: ["Bruine forte", "🌧️"], 56: ["Bruine verglaçante", "🌧️"], 57: ["Bruine verglaçante", "🌧️"], 61: ["Pluie faible", "🌦️"], 63: ["Pluie", "🌧️"], 65: ["Forte pluie", "🌧️"], 66: ["Pluie verglaçante", "🌧️"], 67: ["Pluie verglaçante", "🌧️"], 71: ["Neige faible", "🌨️"], 73: ["Neige", "🌨️"], 75: ["Forte neige", "❄️"], 77: ["Grains de neige", "🌨️"], 80: ["Averses", "🌦️"], 81: ["Averses", "🌧️"], 82: ["Violentes averses", "⛈️"], 85: ["Averses de neige", "🌨️"], 86: ["Averses de neige", "🌨️"], 95: ["Orage", "⛈️"], 96: ["Orage et grêle", "⛈️"], 99: ["Orage et grêle", "⛈️"] };
const geocode = async (q) => {
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(String(q).trim())) { const [lat, lon] = String(q).split(",").map(Number); return { lat, lon, nom: q }; }
  const j = await get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=fr`, "Géocodage");
  const r = (j.results || [])[0];
  if (!r) throw perm(`lieu « ${q} » introuvable`);
  return { lat: r.latitude, lon: r.longitude, nom: `${r.name}${r.admin1 ? `, ${r.admin1}` : ""}`, pays: r.country };
};

/* prochaines dates d'une expression cron (5 champs, heure locale du serveur) */
const cronNext = (expr, n = 5, from = new Date()) => {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw perm("expression cron à 5 champs attendue (min heure jour mois jourSemaine)");
  const R = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const sets = f.map((s, i) => { const out = new Set(); for (const part of s.split(",")) { const [range, step = "1"] = part.split("/"); let [a, b] = range === "*" ? R[i] : range.split("-").map(Number); if (b === undefined) b = step !== "1" ? R[i][1] : a; for (let v = a; v <= b; v += +step) out.add(i === 4 && v === 7 ? 0 : v); } return out; });
  const res = []; const d = new Date(from); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  const domAny = f[2] === "*", dowAny = f[4] === "*";
  for (let i = 0; i < 527040 && res.length < n; i++) {
    const dom = sets[2].has(d.getDate()), dow = sets[4].has(d.getDay());
    const dayOk = domAny && dowAny ? true : domAny ? dow : dowAny ? dom : dom || dow;
    if (sets[3].has(d.getMonth() + 1) && dayOk && sets[1].has(d.getHours()) && sets[0].has(d.getMinutes())) res.push(new Date(d).toISOString());
    d.setMinutes(d.getMinutes() + 1);
  }
  return res;
};
const ibanOk = (iban) => { const s = String(iban).replace(/\s/g, "").toUpperCase(); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false; const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55); let m = 0; for (const c of r) m = (m * 10 + +c) % 97; return m === 1; };
const luhn = (s) => { let sum = 0; [...String(s)].reverse().forEach((c, i) => { let d = +c; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; }); return sum % 10 === 0; };

module.exports = [
  {
    name: "dzf_meteo", label: "Météo", category: "Pratique", icon: "fas fa-cloud-sun", output: "meteo", timeout: 30,
    description: "Météo actuelle et prévisions (jusqu'à 16 jours) pour une ville ou des coordonnées, avec une phrase et une icône prêtes à afficher. Open-Meteo, gratuit, sans clé.",
    params: [{ name: "lieu", label: "Ville ou « lat,lon »", required: true, default: "Paris" }, { name: "jours", label: "Jours de prévision", type: "int", default: 3 }],
    run: async (p) => {
      const g = await geocode(p.lieu);
      const j = await get(`https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=${Math.min(16, Math.max(1, +p.jours || 3))}`, "Open-Meteo");
      const c = j.current, w = WMO[c.weather_code] || ["?", "🌡️"];
      return { lieu: g.nom, lat: g.lat, lon: g.lon, maintenant: { temperature: c.temperature_2m, ressenti: c.apparent_temperature, humidite: c.relative_humidity_2m, vent_kmh: c.wind_speed_10m, pluie_mm: c.precipitation, ciel: w[0], icone: w[1] },
        resume: `${w[1]} ${w[0]}, ${Math.round(c.temperature_2m)} °C (ressenti ${Math.round(c.apparent_temperature)} °C)`,
        jours: j.daily.time.map((d, i) => ({ date: d, min: j.daily.temperature_2m_min[i], max: j.daily.temperature_2m_max[i], pluie_mm: j.daily.precipitation_sum[i], risque_pluie: j.daily.precipitation_probability_max[i], uv: j.daily.uv_index_max[i], lever: j.daily.sunrise[i], coucher: j.daily.sunset[i], ciel: (WMO[j.daily.weather_code[i]] || ["?"])[0], icone: (WMO[j.daily.weather_code[i]] || ["", "🌡️"])[1] })) };
    },
  },
  {
    name: "dzf_adresse", label: "Adresse : chercher, compléter, localiser", category: "Pratique", icon: "fas fa-map-marker-alt", output: "adresse", timeout: 30,
    description: "Transforme une adresse en coordonnées GPS et en adresse propre (et l'inverse). Base Adresse Nationale pour la France, OpenStreetMap ailleurs.",
    params: [{ name: "sens", label: "Sens", type: "select", options: ["adresse → GPS", "GPS → adresse"], default: "adresse → GPS" }, { name: "valeur", label: "Adresse ou « lat,lon »", required: true }, { name: "source", label: "Source", type: "select", options: ["France (BAN)", "Monde (OpenStreetMap)"], default: "France (BAN)" }, { name: "n", label: "Propositions", type: "int", default: 1 }],
    run: async (p) => {
      const n = Math.min(10, +p.n || 1);
      if (p.source === "France (BAN)") {
        const url = p.sens === "adresse → GPS" ? `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(p.valeur)}&limit=${n}` : (() => { const [lat, lon] = String(p.valeur).split(",").map(Number); return `https://data.geopf.fr/geocodage/reverse?lat=${lat}&lon=${lon}&limit=${n}`; })();
        const j = await get(url, "BAN");
        const out = (j.features || []).map((f) => ({ adresse: f.properties.label, numero: f.properties.housenumber, rue: f.properties.street, code_postal: f.properties.postcode, ville: f.properties.city, code_insee: f.properties.citycode, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], score: f.properties.score }));
        return n === 1 ? out[0] || null : out;
      }
      const url = p.sens === "adresse → GPS" ? `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${n}&q=${encodeURIComponent(p.valeur)}` : (() => { const [lat, lon] = String(p.valeur).split(",").map(Number); return `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lon}`; })();
      const j = [].concat(await get(url, "OpenStreetMap", { "Accept-Language": "fr" }));
      const out = j.filter((x) => x && x.lat).map((x) => ({ adresse: x.display_name, ville: x.address && (x.address.city || x.address.town || x.address.village), code_postal: x.address && x.address.postcode, pays: x.address && x.address.country, lat: +x.lat, lon: +x.lon }));
      return n === 1 ? out[0] || null : out;
    },
  },
  {
    name: "dzf_itineraire", label: "Itinéraire et distance", category: "Pratique", icon: "fas fa-route", output: "trajet", timeout: 30,
    description: "Distance et durée entre deux lieux en voiture, à vélo ou à pied (OSRM / OpenStreetMap), ou à vol d'oiseau. Pour les frais kilométriques, les tournées, le temps de trajet.",
    params: [{ name: "depart", label: "Départ (ville, adresse ou lat,lon)", required: true }, { name: "arrivee", label: "Arrivée", required: true }, { name: "mode", label: "Mode", type: "select", options: ["voiture", "vélo", "à pied", "vol d'oiseau"], default: "voiture" }],
    run: async (p) => {
      const [a, b] = await Promise.all([geocode(p.depart), geocode(p.arrivee)]);
      const R = 6371, rad = (x) => (x * Math.PI) / 180;
      const vol = 2 * R * Math.asin(Math.sqrt(Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2));
      if (p.mode === "vol d'oiseau") return { depart: a.nom, arrivee: b.nom, km: +vol.toFixed(1) };
      const prof = { voiture: "routed-car/route/v1/driving", "vélo": "routed-bike/route/v1/bike", "à pied": "routed-foot/route/v1/foot" }[p.mode];
      const j = await get(`https://routing.openstreetmap.de/${prof}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`, "OSRM");
      const r = (j.routes || [])[0];
      if (!r) throw new Error("pas d'itinéraire trouvé");
      const min = Math.round(r.duration / 60);
      return { depart: a.nom, arrivee: b.nom, km: +(r.distance / 1000).toFixed(1), minutes: min, duree: min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`, vol_oiseau_km: +vol.toFixed(1) };
    },
  },
  {
    name: "dzf_jours_feries", label: "Jours fériés et vacances scolaires", category: "Pratique", icon: "fas fa-umbrella-beach", output: "feries", timeout: 30,
    description: "Jours fériés français (métropole, Alsace-Moselle, outre-mer) et vacances scolaires par zone. Dit aussi si une date donnée est fériée ou en vacances.",
    params: [{ name: "quoi", label: "Quoi", type: "select", options: ["jours fériés", "vacances scolaires"], default: "jours fériés" }, { name: "annee", label: "Année", default: "", help: "Vide = cette année" },
      { name: "zone", label: "Zone", default: "metropole", help: "Fériés : metropole, alsace-moselle, guadeloupe, martinique, guyane, la-reunion, mayotte… · Vacances : A, B ou C" }, { name: "date", label: "Tester cette date (facultatif)", help: "AAAA-MM-JJ" }],
    run: async (p) => {
      const year = /^\d{4}$/.test(String(p.annee || "")) ? +p.annee : new Date().getFullYear();
      if (p.quoi === "jours fériés") {
        const j = await get(`https://calendrier.api.gouv.fr/jours-feries/${encodeURIComponent(p.zone || "metropole")}/${year}.json`, "Jours fériés");
        const list = Object.entries(j).map(([date, nom]) => ({ date, nom }));
        return p.date ? { date: p.date, ferie: !!j[p.date], nom: j[p.date] || null, liste: list } : list;
      }
      const zone = String(p.zone || "C").toUpperCase().replace(/^ZONE\s*/, "");
      const j = await get(`https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?where=${encodeURIComponent(`zones="Zone ${zone}" and (start_date>="${year - 1}-08-01" and start_date<"${year + 1}-01-01")`)}&order_by=start_date&limit=50`, "Calendrier scolaire");
      const seen = new Set();
      const list = (j.results || []).map((r) => ({ nom: r.description, debut: String(r.start_date).slice(0, 10), fin: String(r.end_date).slice(0, 10), annee: r.annee_scolaire })).filter((r) => { const k = r.nom + r.debut; if (seen.has(k)) return false; seen.add(k); return true; });
      return p.date ? { date: p.date, vacances: list.find((v) => p.date >= v.debut && p.date < v.fin) || null, liste: list } : list;
    },
  },
  {
    name: "dzf_entreprise", label: "Entreprise : fiche SIRENE", category: "Pratique", icon: "fas fa-building", output: "entreprise", timeout: 30,
    description: "Trouve une entreprise française par nom, SIREN ou SIRET : adresse, activité, dirigeants, effectif, date de création, état (active ou fermée). API Recherche d'entreprises (État), gratuite.",
    params: [{ name: "recherche", label: "Nom, SIREN ou SIRET", required: true }, { name: "n", label: "Résultats", type: "int", default: 1 }],
    run: async (p) => {
      const q = String(p.recherche).replace(/\s/g, "").match(/^\d{9,14}$/) ? String(p.recherche).replace(/\s/g, "") : String(p.recherche);
      const j = await get(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=${Math.min(25, +p.n || 1)}`, "Recherche d'entreprises");
      const out = (j.results || []).map((e) => ({ nom: e.nom_complet, siren: e.siren, siret_siege: e.siege && e.siege.siret, adresse: e.siege && e.siege.adresse, activite: e.activite_principale, categorie: e.categorie_entreprise, effectif: e.tranche_effectif_salarie, creation: e.date_creation, active: e.etat_administratif === "A", dirigeants: (e.dirigeants || []).slice(0, 5).map((d) => d.nom ? `${d.prenoms || ""} ${d.nom}`.trim() : d.denomination), lat: e.siege && +e.siege.latitude, lon: e.siege && +e.siege.longitude }));
      return (+p.n || 1) === 1 ? out[0] || null : out;
    },
  },
  {
    name: "dzf_change", label: "Taux de change", category: "Pratique", icon: "fas fa-euro-sign", output: "change", timeout: 30,
    description: "Convertit un montant d'une devise à une autre au taux du jour (ou d'une date passée), d'après la Banque centrale européenne.",
    params: [{ name: "montant", label: "Montant", type: "number", default: 1 }, { name: "de", label: "De", default: "EUR" }, { name: "vers", label: "Vers", default: "USD,XOF,GBP", help: "Une ou plusieurs devises" }, { name: "date", label: "Date (facultatif)", help: "AAAA-MM-JJ" }],
    run: async (p) => {
      const to = String(p.vers).toUpperCase().replace(/\s/g, "").split(",").filter(Boolean);
      const from = String(p.de).toUpperCase(), amt = +p.montant || 1;
      /* francs CFA et comoriens : parités fixes avec l'euro */
      const FIXE = { EUR: 1, XOF: 655.957, XAF: 655.957, KMF: 491.96775, XPF: 119.33174 };
      const need2 = [from, ...to].filter((c) => !FIXE[c]);
      const rates = need2.length ? (await get(`https://api.frankfurter.dev/v1/${/^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : "latest"}?base=EUR&symbols=${[...new Set(need2)].join(",")}`, "Frankfurter")).rates : {};
      const rate = (c) => { const r = FIXE[c] || rates[c]; if (!r) throw perm(`devise inconnue : ${c}`); return r; };
      const out = Object.fromEntries(to.map((c) => [c, +((amt / rate(from)) * rate(c)).toFixed(4)]));
      return to.length === 1 ? out[to[0]] : out;
    },
  },
  {
    name: "dzf_wikipedia", label: "Wikipédia : résumé", category: "Pratique", icon: "fab fa-wikipedia-w", output: "wiki", timeout: 30,
    description: "Résumé d'un article Wikipédia avec son image, ou recherche d'articles. Pour enrichir une fiche, une veille, un quiz…",
    params: [{ name: "sujet", label: "Sujet", required: true }, { name: "langue", label: "Langue", default: "fr" }],
    run: async (p) => {
      const L = /^[a-z]{2,3}$/.test(p.langue || "") ? p.langue : "fr";
      const s = await get(`https://${L}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(p.sujet)}&limit=1`, "Wikipédia");
      const page = (s.pages || [])[0];
      if (!page) return null;
      const j = await get(`https://${L}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`, "Wikipédia");
      return { titre: j.title, resume: j.extract, description: j.description, image: j.thumbnail && j.thumbnail.source, url: j.content_urls && j.content_urls.desktop.page };
    },
  },
  {
    name: "dzf_verifier_numero", label: "Vérifier un IBAN, SIRET, n° de TVA, carte", category: "Pratique", icon: "fas fa-check-double", output: "verification",
    description: "Contrôle qu'un numéro est bien formé (clé de contrôle) : IBAN, SIREN/SIRET, n° de TVA intracommunautaire (et son existence auprès de l'UE), n° de carte (Luhn). Évite les erreurs de saisie.",
    params: [{ name: "type", label: "Type", type: "select", options: ["IBAN", "SIREN / SIRET", "TVA intracommunautaire", "carte bancaire (Luhn)"], default: "IBAN" }, { name: "numero", label: "Numéro", required: true }, { name: "en_ligne", label: "TVA : vérifier aussi auprès de l'UE (VIES)", type: "bool", default: false }],
    run: async (p) => {
      const s = String(p.numero).replace(/[\s.-]/g, "").toUpperCase();
      if (p.type === "IBAN") return { valide: ibanOk(s), pays: s.slice(0, 2), formate: s.replace(/(.{4})/g, "$1 ").trim() };
      if (p.type.startsWith("SIREN")) return { valide: /^\d{9}$|^\d{14}$/.test(s) && (luhn(s) || s.startsWith("356000000")), type: s.length === 9 ? "SIREN" : "SIRET" };
      if (p.type.startsWith("carte")) return { valide: /^\d{12,19}$/.test(s) && luhn(s), fin: s.slice(-4) };
      const m = s.match(/^([A-Z]{2})([A-Z0-9]{2,13})$/);
      if (!m) return { valide: false };
      let valide = true;
      if (m[1] === "FR") { const siren = m[2].slice(2); valide = /^\d{9}$/.test(siren) && +m[2].slice(0, 2) === (12 + 3 * (+siren % 97)) % 97; }
      if (!p.en_ligne) return { valide, pays: m[1] };
      const r = await fetch("https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ countryCode: m[1] === "GR" ? "EL" : m[1], vatNumber: m[2] }) });
      const j = await r.json().catch(() => ({}));
      return { valide: valide && !!j.valid, pays: m[1], nom: j.name && j.name !== "---" ? j.name : null, adresse: j.address && j.address !== "---" ? j.address : null };
    },
  },
  {
    name: "dzf_cron", label: "Planning : prochaines dates", category: "Pratique", icon: "fas fa-calendar-alt", output: "dates",
    description: "Donne les prochaines dates d'une règle de répétition (format cron, ex. « 0 9 * * 1-5 » = 9 h en semaine), avec une explication. Pour vérifier un planning avant de l'utiliser.",
    params: [{ name: "expression", label: "Règle cron", required: true, default: "0 9 * * 1-5" }, { name: "n", label: "Combien", type: "int", default: 5 }],
    run: async (p) => ({ expression: p.expression, prochaines: cronNext(p.expression, Math.min(50, +p.n || 5)) }),
  },
  {
    name: "dzf_stripe", label: "Stripe : paiements", category: "Pratique", icon: "fab fa-stripe-s", output: "stripe", timeout: 60,
    description: "Crée un lien de paiement ou une session de paiement, lit un paiement ou un client, liste les derniers paiements. Pour tes factures, dons, abonnements.",
    params: [{ name: "cle", label: "Secret de la clé secrète", default: "STRIPE_SECRET" }, { name: "action", label: "Action", type: "select", options: ["créer un paiement (lien)", "derniers paiements", "lire un paiement", "chercher un client", "appel libre"], default: "créer un paiement (lien)" },
      { name: "montant", label: "Montant (€)", type: "number" }, { name: "libelle", label: "Libellé" }, { name: "email", label: "E-mail du client" }, { name: "retour", label: "Page de retour après paiement" }, { name: "reference", label: "Référence (ex. n° de facture)" },
      { name: "id", label: "Id (paiement)" }, { name: "chemin", label: "Chemin", showIf: { action: "appel libre" }, help: "Ex. /v1/customers" }, { name: "methode", label: "Méthode", type: "select", options: ["GET", "POST"], default: "GET", showIf: { action: "appel libre" } }, { name: "corps", label: "Paramètres (JSON)", type: "json", showIf: { action: "appel libre" } }],
    run: async (p, ctx, api) => {
      const k = await need(api, p.cle);
      const form = (o, pre = "") => Object.entries(o).flatMap(([key, v]) => { const kk = pre ? `${pre}[${key}]` : key; return v && typeof v === "object" ? form(v, kk) : v === undefined || v === null ? [] : [`${encodeURIComponent(kk)}=${encodeURIComponent(v)}`]; });
      const S = async (path, method = "GET", body) => {
        const r = await fetch(`https://api.stripe.com${path}`, { method, headers: { Authorization: `Bearer ${k}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, body: body ? form(body).join("&") : undefined });
        const j = await r.json();
        if (!r.ok) throw Object.assign(new Error(`Stripe : ${(j.error && j.error.message) || r.status}`), { permanent: r.status < 500 });
        return j;
      };
      if (p.action === "créer un paiement (lien)") {
        if (!(+p.montant > 0)) throw perm("montant invalide");
        const s = await S("/v1/checkout/sessions", "POST", { mode: "payment", success_url: p.retour || "https://example.com/merci", ...(p.email ? { customer_email: p.email } : {}), client_reference_id: p.reference || undefined, metadata: { reference: p.reference || "" }, line_items: { 0: { quantity: 1, price_data: { currency: "eur", unit_amount: Math.round(+p.montant * 100), product_data: { name: p.libelle || "Paiement" } } } } });
        return { url: s.url, id: s.id, expire: new Date(s.expires_at * 1000).toISOString() };
      }
      if (p.action === "derniers paiements") return (await S("/v1/payment_intents?limit=25")).data.map((x) => ({ id: x.id, montant: x.amount / 100, devise: x.currency, etat: x.status, quand: new Date(x.created * 1000).toISOString(), description: x.description, client: x.customer }));
      if (p.action === "lire un paiement") { const id = String(p.id || ""); return S(id.startsWith("cs_") ? `/v1/checkout/sessions/${id}` : `/v1/payment_intents/${id}`); }
      if (p.action === "chercher un client") return (await S(`/v1/customers?email=${encodeURIComponent(p.email || "")}&limit=5`)).data.map((c) => ({ id: c.id, nom: c.name, email: c.email, cree: new Date(c.created * 1000).toISOString() }));
      if (!String(p.chemin || "").startsWith("/v1/")) throw perm("chemin /v1/… attendu");
      return S(p.chemin, p.methode, p.methode === "POST" ? (typeof p.corps === "string" ? JSON.parse(p.corps || "{}") : p.corps || {}) : undefined);
    },
  },
];
module.exports.cronNext = cronNext;
module.exports.ibanOk = ibanOk;
