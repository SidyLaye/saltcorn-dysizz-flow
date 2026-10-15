/* Adaptateur Immofacile API V2 (https://v2.immo-facile.com/api/v2/site).
   Jeton : POST {base}/client/token/site (Basic + site_id), gardé en mémoire jusqu'à expiration.
   Lecture : produits (recherche par model, par critères, détail), contacts (recherche paginée).
   Écriture : création / complément de contact, suivi sur un bien, consentement anti-démarchage.
   « lectureSeule » bloque toute écriture au niveau HTTP (mode ombre). */
"use strict";
const { typeBien } = require("../valeurs");
const { cle } = require("../texte");
const { completer, recent, PRENOM_MANQUANT, NOM_MANQUANT, emailTelephone } = require("../contact");

/* Jetons gardés d'un adaptateur à l'autre (un workflow en étapes en crée un par étape) :
   clé = empreinte de l'adresse, du site et des identifiants, jamais les identifiants eux-mêmes. */
/* Lieu dit par un prospect → termes du critère « C.P. ou ville » (CONTIENT, seul critère de lieu cherchable) et, pour un département
   ou une région, débuts de code postal à garder. Les noms de département sont traduits en numéro par l'IA du bot. */
const REGIONS = [
  [/parisien|ile de france|\bidf\b|paris et (sa )?region/, "75 77 78 91 92 93 94 95"],
  [/occitanie/, "09 11 12 30 31 32 34 46 48 65 66 81 82"], [/nouvelle aquitaine/, "16 17 19 23 24 33 40 47 64 79 86 87"],
  [/pays basque|cote basque/, "64"], [/provence|paca|cote d azur/, "04 05 06 13 83 84"], [/bretagne/, "22 29 35 56"], [/normandie/, "14 27 50 61 76"],
  [/hauts de france/, "02 59 60 62 80"], [/grand est|alsace|lorraine/, "08 10 51 52 54 55 57 67 68 88"], [/bourgogne|franche comte/, "21 25 39 58 70 71 89 90"],
  [/auvergne|rhone alpes/, "01 03 07 15 26 38 42 43 63 69 73 74"], [/centre val de loire/, "18 28 36 37 41 45"], [/pays de (la )?loire/, "44 49 53 72 85"], [/corse/, "20"],
];
const zonesDe = (lieu) => {
  const k = cle(lieu), r = REGIONS.find(([re]) => re.test(k));
  if (r) { const d = r[1].split(" "); return { termes: d, prefixes: d }; }
  const dep = k.match(/^(?:(?:dans|en|sur|vers|secteur|departement|le|du)\s+)*(\d{2}|2a|2b)$/);
  if (dep) { const d = /^2[ab]$/.test(dep[1]) ? "20" : dep[1]; return { termes: [d], prefixes: [d] }; }
  const t = String(lieu).trim().replace(/^(?:(?:pr[eè]s de|autour de|aux alentours de|du c[oô]t[eé] de|secteur( de)?|vers|sur|dans|à|a)\s+)+/i, "").trim();
  /* le CRM écrit « ONET LE CHATEAU » ou « Roquefort-les-Pins » selon l'origine de l'annonce : les deux écritures sont cherchées */
  return { termes: [...new Set([cle(t), t].filter(Boolean))], prefixes: null };
};

const JETONS = new Map();
const empreinte = (...x) => require("crypto").createHash("sha256").update(x.map(String).join("\n")).digest("hex");

const creer = (cfg = {}) => {
  const base = String(cfg.base || "https://v2.immo-facile.com/api").replace(/\/+$/, "");
  const racine = new URL(base).origin + "/api/v2/site";
  const f = cfg.fetch || fetch;
  let jeton = null, expire = 0, defs = null, typesBien = null;
  const journal = cfg.journal || (() => {});
  const LECTURE = (m, p) => (m === "GET" ? /^\/(discovery|customers\/\d+|customers\/(origins|groups)|criterias\/|products\/\d+|agencies|users)/.test(p) && (!/\/(consent|follow-ups|actions|search-requests)/.test(p) || /^\/customers\/\d+\/(follow-ups|actions)(\?|$)/.test(p)) : m === "POST" && ["/products/search", "/products/search/count", "/customers/search"].includes(p.split("?")[0]));

  /* Le délai couvre aussi la lecture du corps, qui peut rester suspendue après
     réception des en-têtes. Un POST d'écriture ambigu n'est jamais rejoué. */
  const lectureHttp = async (url, options, delai) => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), delai || cfg.delai_ms || 15000);
    try {
      const r = await f(url, { ...options, signal: ctrl.signal });
      const tx = await r.text();
      return { r, tx };
    } finally { clearTimeout(to); }
  };
  const attendre = cfg.attendre || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const pause = (r, essai) => {
    const h = r?.headers?.get?.("retry-after");
    const s = Number(h);
    const ms = h && Number.isFinite(s) ? s * 1000 : h && Number.isFinite(Date.parse(h)) ? Date.parse(h) - Date.now() : essai * 500;
    return attendre(Math.max(0, Math.min(ms, 15000)));
  };

  const token = async () => {
    if (jeton && Date.now() < expire - 60000) return jeton;
    const basic = await cfg.secret("basic");
    if (!basic) throw Object.assign(new Error("identifiants Immofacile absents (coffre : basic)"), { permanent: true });
    const cleJeton = empreinte(base, cfg.site_id, basic);
    const garde = JETONS.get(cleJeton);
    if (garde && Date.now() < garde.expire - 60000) { jeton = garde.jeton; expire = garde.expire; return jeton; }
    let r, tx;
    for (let essai = 1; essai <= 4; essai++) {
      try { ({ r, tx } = await lectureHttp(`${base}/client/token/site`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: /^basic /i.test(basic) ? basic : "Basic " + basic, Accept: "application/json" }, body: "site_id=" + encodeURIComponent(cfg.site_id) })); }
      catch (e) { if (essai === 4) throw e; await pause(null, essai); continue; }
      if ((r.status === 429 || r.status >= 500) && essai < 4) { await pause(r, essai); continue; }
      break;
    }
    if (!r.ok) throw Object.assign(new Error(`jeton Immofacile HTTP ${r.status}`), { permanent: r.status === 401 || r.status === 403 });
    const j = JSON.parse(tx);
    if (!j.access_token) throw new Error("jeton Immofacile reçu sans access_token");
    jeton = j.access_token; expire = Date.now() + (+j.expires_in || 3000) * 1000;
    if (JETONS.size > 200) JETONS.clear();
    JETONS.set(cleJeton, { jeton, expire });
    return jeton;
  };

  const appel = async (methode, chemin, corps, { multipart } = {}) => {
    if (cfg.lectureSeule && !LECTURE(methode, chemin)) throw Object.assign(new Error(`écriture bloquée (mode ombre) : ${methode} ${chemin}`), { permanent: true, ombre: true });
    for (let essai = 1; essai <= 4; essai++) {
      const t0 = Date.now();
      const headers = { Authorization: "Bearer " + (await token()), Accept: "application/json" };
      if (corps && !multipart) headers["Content-Type"] = "application/json";
      const rejouable = methode === "GET" || LECTURE(methode, chemin);
      let r, tx;
      try { ({ r, tx } = await lectureHttp(racine + chemin, { method: methode, headers, body: multipart || (corps ? JSON.stringify(corps) : undefined) }, chemin === "/customers/search" ? cfg.recherche_delai_ms || cfg.delai_ms || 45000 : undefined)); }
      catch (e) {
        if (!rejouable) throw Object.assign(new Error(`Immofacile ${methode} ${chemin} : résultat d'écriture inconnu, vérifier avant reprise`), { cause: e, ambiguous: true, permanent: true });
        if (essai === 4) throw e;
        await pause(null, essai); continue;
      }
      journal({ methode, chemin, statut: r.status, ms: Date.now() - t0 });
      if (r.status === 401 && essai === 1) { for (const [k, v] of JETONS) if (v.jeton === jeton) JETONS.delete(k); jeton = null; continue; }
      if ((r.status === 429 || (r.status >= 500 && rejouable)) && essai < 4) { await pause(r, essai); continue; }
      if (!r.ok) {
        let champs = [];
        try {
          const erreur = JSON.parse(tx).error;
          champs = (erreur && Array.isArray(erreur.details) ? erreur.details : [])
            .map((x) => String(x && x.field || ""))
            .filter((x) => /^[a-z][a-z0-9_.\[\]]{0,60}$/i.test(x));
        } catch (_) {}
        throw Object.assign(new Error(`Immofacile ${methode} ${chemin} → HTTP ${r.status}${champs.length ? " (champs : " + [...new Set(champs)].join(", ") + ")" : ""}`),
          { http: r.status, champs, ambiguous: !rejouable && r.status >= 500,
            permanent: (!rejouable && r.status >= 500) || (r.status >= 400 && r.status < 500 && r.status !== 429) });
      }
      try { return tx ? JSON.parse(tx) : {}; } catch (e) { return { brut: tx }; }
    }
  };
  const data = (j) => (j && j.data !== undefined ? j.data : j);

  /* Définitions des critères produit : id numérique → clé XML (Prix, Surface, NbPieces, TypeBien…). */
  const criteres = async () => {
    if (defs) return defs;
    const l = data(await appel("GET", "/criterias/product/all")) || [];
    defs = new Map((Array.isArray(l) ? l : []).filter((d) => d && d.id != null).map((d) => [String(d.id), String(d.xml || d.id)]));
    return defs;
  };
  /* La clé XML réelle du site pour un critère (ex. « NbPieces » ou « NbPiece » selon les sites). */
  const cleXml = async (...candidats) => {
    const D = await criteres().catch(() => new Map());
    const xs = [...D.values()];
    for (const c of candidats) { const x = xs.find((v) => cle(v) === cle(c)); if (x) return x; }
    return candidats[0];
  };
  /* Type de bien : la valeur attendue est le code (champ « model ») de GET /criterias/product/{id}/values. */
  const codeType = async (canon) => {
    if (!typesBien) {
      const D = await criteres();
      const d = [...D.entries()].find(([, x]) => cle(x) === "typebien");
      const vals = d ? data(await appel("GET", `/criterias/product/${d[0]}/values`).catch(() => [])) : [];
      typesBien = (Array.isArray(vals) ? vals : []).map((v) => ({ code: String(v.model ?? v.value ?? v.id), libelle: String(v.label ?? v.model ?? "") }));
    }
    const t = typesBien.find((x) => typeBien(x.libelle) === canon || typeBien(x.code) === canon);
    return t ? t.code : null;
  };

  const versBien = async (p) => {
    if (!p) return null;
    const D = await criteres().catch(() => new Map());
    const v = {}, lab = {};
    const groupes = [p.criteres_text, p.criteres_number, p.criteres_fulltext, p.criteres_flag, p.criteresText, p.criteresNumber, p.criteresFullText, p.criteresFlag];
    for (const g of groupes) for (const c of Array.isArray(g) ? g : []) {
      const id = c.critere_id ?? c.criteria_id ?? c.criterias_id ?? c.id;
      const x = (id != null && D.get(String(id))) || c.critere_xml || c.xml || (isNaN(+id) ? id : null);
      if (!x) continue;
      const val = c.critere_value ?? c.value ?? c.valeur; if (val != null && String(val).trim()) v[cle(x)] = val;
      const l = c.critere_value_name ?? c.value_name ?? c.label; if (l != null) lab[cle(x)] = l;
    }
    const n = (k) => (v[k] != null && isFinite(+String(v[k]).replace(",", ".")) ? +String(v[k]).replace(",", ".") : null);
    const a = p.assigned_to || p.assignedTo || {};
    return {
      id: p.id, reference: String(p.model || "").trim(), prix: +p.price || n("prix"), surface: n("surface"), pieces: n("nbpieces") || n("nbpiece"), chambres: n("nbchambres") || n("nbchambre") || n("chambres"),
      type: typeBien(lab.typebien || v.typebien || (p.category && (p.category.name || p.category.label)) || ""),
      ville: v.villeweb || v.ville_web || v.ville || null,
      code_postal: (String(v.codepostalweb || v.cpvilleweb || v.codepostal || v.cpville || "").match(/\d{5}/) || [])[0] || null,
      /* adresse réelle, quand l'annonce affiche une commune voisine : un mail peut citer l'une ou l'autre */
      statut: v.statut != null ? String(v.statut) : null, diffuse: typeof p.status_web === "boolean" ? p.status_web : null,
      ville_reelle: v.ville || null, code_postal_reel: (String(v.codepostal || v.cpville || "").match(/\d{5}/) || [])[0] || null,
      negociateur_id: a.id ?? a.user_id ?? p.userId ?? p.user_id ?? null, proprietaire_id: p.customers_id ?? p.customer_id ?? (p.customer && p.customer.id) ?? null, agence_id: p.agencyId ?? p.agency_id ?? (p.agency && p.agency.id) ?? null,
    };
  };
  const FETCH = "criteres_text,criteres_number,assigned_to,category";
  const detail = async (id) => versBien(data(await appel("GET", `/products/${Number(id)}?fetch=${FETCH}`)));
  /* Recherche avec ?fetch= : les biens reviennent complets (au plus 100 par page), sans appel de détail. */
  const recherche = async (corps) => { const l = data(await appel("POST", `/products/search?fetch=${FETCH}`, corps)); return Promise.all((Array.isArray(l) ? l : []).map((p) => (p && (p.criteres_text || p.criteresText) ? versBien(p) : detail(p.id || p)))); };

  const versContact = (c) => ({ id: c.id, email: c.email || null, emails: [c.email].filter(Boolean), telephone: c.phone || null, mobile: c.mobilePhone || c.mobile_phone || null,
    telephones: [c.phone, c.mobilePhone, c.mobile_phone].filter(Boolean).map((t) => String(t).replace(/[^\d+]/g, "")), prenom: c.firstname || c.first_name || null, nom: c.lastname || c.last_name || null,
    cree_le: c.createdAt || c.created_at || null,
    agence: idDe(c.agency ?? c.agency_id ?? c.manufacturer), negociateur: idDe(c.user ?? c.user_id ?? c.admin),
    consentement: !!(c.consent && !(c.consent.revokedAt || c.consent.revoked_at)),
    rgpd: typeof c.rgpd === "boolean" ? c.rgpd : null,
    rgpd_consent: typeof c.rgpd_consent === "boolean" ? c.rgpd_consent : null,
    conformite: [0, 1, 2].includes(c.conformity) ? c.conformity : null,
    origine: idDe(c.origin ?? c.origin_id), groupes: [].concat(c.groups ?? c.group ?? []).map(idDe).filter(Boolean) });
  const idDe = (x) => (x == null ? null : typeof x === "object" ? x.id ?? null : x);
  /* Relecture après écriture : l'ancien service écrivait origin / group / phone sans jamais les
     retrouver à la relecture (2 081 cas sur 2 127). On relit et on dit ce qui n'a pas été pris. */
  const relire = async (id, corps) => {
    try {
      const c = (await lireContact(id)) || {};
      c.groupes = c.groupes || [];
      const chiffres = (x) => String(x || "").replace(/\D/g, "").slice(-9);
      const pris = { email: c.email, firstname: c.prenom, lastname: c.nom, phone: c.telephone, mobile_phone: c.mobile, agency_id: c.agence, user_id: c.negociateur, origin: c.origine, group: c.groupes[0] };
      return Object.keys(corps).filter((k) => k in pris && (k === "group" ? !c.groupes.map(String).includes(String(corps[k])) : ["phone", "mobile_phone"].includes(k) ? chiffres(pris[k]) !== chiffres(corps[k]) : String(pris[k] ?? "") !== String(corps[k])));
    } catch (e) { return ["relecture impossible : " + e.message]; }
  };
  /* POST /customers/search : plus récents d'abord, pagination par curseur (meta.next_cursor). */
  const chercherContacts = async (filtre) => {
    /* Immofacile lit « _ » comme un joker dans la recherche par e-mail : pour certaines adresses elle ne répond
       alors jamais (lead bloqué « recherche du contact CRM indisponible »). Échappé, même résultat, en moins d'1 s. */
    if (filtre.email) filtre = { ...filtre, email: String(filtre.email).replace(/_/g, "\\_") };
    const out = [], vus = new Set(), curseurs = new Set(); let cursor = null;
    for (let page = 0; page < 20; page++) {
      const j = await appel("POST", "/customers/search", { ...filtre, per_page: 200, ...(cursor ? { cursor } : {}) });
      const l = Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : null;
      if (!l) throw new Error("Immofacile /customers/search : liste de contacts absente de la réponse");
      for (const c of l) if (c && c.id && !vus.has(c.id)) { vus.add(c.id); out.push(versContact(c)); }
      const next = j && j.meta && j.meta.next_cursor;
      if (!next || !l.length || curseurs.has(next)) break;
      curseurs.add(next); cursor = next;
    }
    return out;
  };
  /* Critères de recherche : clés XML réelles du site, lues une fois. */
  let defsRecherche = null;
  const cleRecherche = async (...candidats) => {
    if (!defsRecherche) { const l = data(await appel("GET", "/criterias/search-requests").catch(() => ({ data: [] }))) || []; defsRecherche = (Array.isArray(l) ? l : []).map((d) => String(d.xml || d.id)); }
    for (const c of candidats) { const x = defsRecherche.find((v) => cle(v) === cle(c)); if (x) return x; }
    return candidats[0];
  };
  const criteresRecherche = async (r) => {
    const c = [];
    if (r.transaction) c.push({ id: await cleRecherche("TypeTransaction"), operator: "EGAL", value: r.transaction === "location" ? "Location" : "Vente" });
    if (r.type) { const code = await codeType(r.type).catch(() => null); if (code) c.push({ id: await cleRecherche("TypeBien"), operator: "EGAL", value: code }); }
    if (r.localisation) c.push({ id: await cleRecherche("CPVille", "CPVilleweb"), operator: "CONTIENT", value: String(r.localisation) });
    if (r.budget_max) c.push({ id: await cleRecherche("Prix"), operator: "INFERIEUR", value: String(r.budget_max) });
    if (r.surface_min) c.push({ id: await cleRecherche("Surface"), operator: "SUPERIEUR", value: String(r.surface_min) });
    if (r.pieces_min) c.push({ id: await cleRecherche("NbPieces", "NbPiece"), operator: "SUPERIEUR", value: String(r.pieces_min) });
    return c;
  };
  /* Recherche Immofacile → projet lisible. Identifiants de critères du référentiel produit : 30 prix, 33 pièces, 34 surface,
     36 terrain, 38 chambres, 64 rayon (km), 65 commune ; INFERIEUR = maximum, SUPERIEUR = minimum. */
  const projetDe = (x) => {
    const o = {}, num = (v) => (isFinite(+v) ? Math.round(+v) : null);
    for (const c of x.criteria || []) {
      const id = +c.id, op = String(c.operator || "").toUpperCase(), v = Array.isArray(c.value) ? c.value : c.value;
      const borne = (k) => { if (num(v) != null) o[k + (op === "INFERIEUR" ? "_max" : op === "SUPERIEUR" ? "_min" : "")] = num(v); };
      if (id === 30) borne("budget"); else if (id === 34) borne("surface"); else if (id === 36) borne("terrain"); else if (id === 33) borne("pieces"); else if (id === 38) borne("chambres");
      else if (id === 64 && num(v) != null) o.rayon_km = num(v); else if (id === 65 && v) o.zone = String(v);
    }
    for (const [k, n] of [["timeframe", "delai"], ["intended_use", "usage"], ["reason_for_purchase", "motif"], ["current_resale", "revente"]]) {
      const v = x[k]; if (v != null && v !== "") o[n] = typeof v === "object" ? v.label || v.name || v.value || JSON.stringify(v) : v;
    }
    return o;
  };
  /* Contact avec ses relations : sans « include », origine et groupes ne reviennent pas
     (c'est pour ça que l'ancien service ne les retrouvait jamais à la relecture). */
  const lireContact = async (id) => {
    const c = data(await appel("GET", `/customers/${Number(id)}?include=origin,groups,user,agency,searchRequests,consent,rgpd`));
    if (!c || !c.id) return null;
    const k = c.consent && !(c.consent.revokedAt || c.consent.revoked_at) ? c.consent : null;
    return { ...versContact(c), recherches: (c.searchRequests || []).map((x) => ({ id: x.id, comment: x.comment || "" })),
      /* projet du contact, tiré de ses recherches actives (critères, délai, revente…), sans les commentaires (notes internes) */
      projets: (c.searchRequests || c.search_requests || []).filter((x) => x && (x.is_active ?? x.isActive) !== false).map(projetDe),
      consentement_detail: k ? { raison: k.reason ?? null, date: k.consentDate ?? k.consent_date ?? null, hors_horaires: k.acceptOutsideHours ?? k.accept_outside_hours ?? null,
        preuves: Array.isArray(k.proofs) ? k.proofs.length : k.proofs ? 1 : 0 } : null };
  };
  /* Biens suivis par un contact (GET /customers/{id}/follow-ups) : lecture seule, pour les contrôles. */
  const suivis = async (id) => {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const j = await appel("GET", `/customers/${Number(id)}/follow-ups?page=${page}&per_page=100`);
      const l = Array.isArray(j && j.data) ? j.data : [];
      for (const x of l) { const pid = x.product_id ?? x.productId ?? (x.product && x.product.id) ?? x.id; if (pid != null) out.push({ bien: String(pid), cree_le: x.created_at ?? x.createdAt ?? null }); }
      const m = j && j.meta; if (!l.length || !m || (m.last_page && page >= m.last_page) || (!m.last_page && !m.next_cursor && l.length < 100)) break;
    }
    return out;
  };
  const tolere409 = async (fn) => { try { return await fn(); } catch (e) { if (e.http === 409) return { deja: true }; throw e; } };

  return {
    nom: "immofacile",
    lectureSeule: !!cfg.lectureSeule,
    tester: async () => {
      const rep = data(await appel("GET", "/discovery"));
      const agences = Array.isArray(rep) ? rep : rep && Array.isArray(rep.agencies) ? rep.agencies : [];
      return { ok: true, agences: agences.map((a) => ({ id: a.agency_id ?? a.id, nom: a.name, ville: a.city })) };
    },
    bienParId: detail,
    /* Photos d'un bien en taille pleine, dans l'ordre de l'annonce, pour un dossier d'images donné (« pr_p », « pr_2 »).
       Lecture seule ; le choix du dossier revient au client (les photos privées ne se montrent jamais). */
    photosBien: async (id, dossier) => {
      const p = data(await appel("GET", `/products/${Number(id)}?fetch=products_photos`)) || {};
      return (p.products_photos || []).filter((x) => x && x.type === dossier && !x.is_red && !x.is_mid && /^https:\/\//.test(x.chemin || ""))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((x) => x.chemin);
    },
    /* Le bien, ses photos (dossier d'images donné) et le contenu brut de l'annonce (tous les critères avec leur libellé,
       descriptions, pièces) en UNE requête : ce que lit le bot, sous fort trafic. Le tri de ce qui peut être dit est fait
       par lib/leads/bot.js (annonce). Bien introuvable : erreur http 404 (ou 403 chez Immofacile). */
    bienEtPhotos: async (id, dossier) => {
      const p = data(await appel("GET", `/products/${Number(id)}?fetch=${FETCH},criteres_flag,descriptions,rooms,products_photos`)) || {};
      const photos = dossier ? (p.products_photos || []).filter((x) => x && x.type === dossier && !x.is_red && !x.is_mid && /^https:\/\//.test(x.chemin || ""))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((x) => x.chemin) : [];
      const criteres = [];
      for (const [g, nature] of [[p.criteres_text, "texte"], [p.criteres_number, "nombre"], [p.criteres_flag, "case"]])
        for (const c of Array.isArray(g) ? g : []) {
          const valeur = c.critere_value_name != null && String(c.critere_value_name).trim() ? c.critere_value_name : c.critere_value;
          if (c.critere_id != null && c.critere_name) criteres.push({ id: +c.critere_id, nom: String(c.critere_name), valeur, nature });
        }
      const descriptions = (p.descriptions || []).filter((d) => d && (d.description || d.title)).map((d) => ({ langue: String(d.language_code || ""), titre: d.title || "", texte: d.description || "" }));
      const pieces = (p.rooms || []).filter((r) => r && r.piece).map((r) => ({ piece: r.piece, surface: +r.surface || null, niveau: r.niveau || "", commentaire: r.commentaires || "" }));
      return { ...(await versBien(p)), photos, annonce: { criteres, descriptions, pieces } };
    },
    biensParReference: async (ref) => (await recherche({ model: String(ref), count: 5 })).filter((b) => b && b.reference.toLowerCase() === String(ref).trim().toLowerCase()).slice(0, 3),
    /* Biens EN VENTE et DIFFUSÉS qui correspondent à une recherche du prospect (bot : « avez-vous d'autres biens… ») :
       q = { lieu (code postal ou commune), type, prix_min, prix_max, pieces_min, surface_min }. Une requête, photos et annonce
       comprises (100 biens au plus par page avec fetch). Opérateurs acceptés par l'API : EGAL, CONTIENT, INFERIEUR, SUPERIEUR. */
    biensCorrespondants: async (q = {}, { max = 10, dossier = "", exclure = [] } = {}) => {
      const c = [{ id: await cleXml("Statut"), operator: "EGAL", value: "EnCours" }];
      const CPV = await cleXml("CPVilleweb", "CPVille"), z = q.lieu ? zonesDe(q.lieu) : null;
      if (q.type) { const code = await codeType(q.type).catch(() => null); if (code) c.push({ id: await cleXml("TypeBien"), operator: "EGAL", value: code }); }
      if (+q.prix_max > 0) c.push({ id: await cleXml("Prix"), operator: "INFERIEUR", value: String(Math.round(+q.prix_max)) });
      if (+q.prix_min > 0) c.push({ id: await cleXml("Prix"), operator: "SUPERIEUR", value: String(Math.round(+q.prix_min)) });
      if (+q.pieces_min > 0) c.push({ id: await cleXml("NbPieces", "NbPiece"), operator: "SUPERIEUR", value: String(Math.max(0, Math.round(+q.pieces_min) - 1)) });
      if (+q.surface_min > 0) c.push({ id: await cleXml("Surface"), operator: "SUPERIEUR", value: String(Math.round(+q.surface_min)) });
      if (c.length < 2 && !(z && z.termes.length)) return [];   // jamais tout le catalogue : un lieu, un type ou un budget au moins
      const sans = new Set(exclure.map(String));
      const COMPLET = `${FETCH},criteres_flag,descriptions,products_photos`, avec = (t) => [...c, { id: CPV, operator: "CONTIENT", value: t }];
      let l;
      if (z) {
        /* Lieu : recherche légère par terme (sans photos : 5 fois plus rapide), tri sur le début du code postal pour un département
           (« contient 91 » ramène aussi 19100), puis chargement complet des seuls biens retenus, un par un, en parallèle. */
        // ponytail: un appel par département en parallèle (13 pour l'Occitanie) ; un catalogue local complet le remplacera
        const lots = await Promise.all(z.termes.map((t) => appel("POST", "/products/search?fetch=criteres_text", { criterias: avec(t), status_web: true, count: 100 }).then(data).catch(() => [])));
        const gardes = [];
        for (const [j, lot] of lots.entries()) for (const p of Array.isArray(lot) ? lot : []) {
          const b = p && !sans.has(String(p.id)) && !gardes.some((g) => g.id === p.id) ? await versBien(p) : null;
          if (b && (!z.prefixes || (b.code_postal || "").startsWith(z.prefixes[j]))) gardes.push({ id: p.id, j, n: gardes.filter((g) => g.j === j).length });
        }
        gardes.sort((a, b) => a.n - b.n || a.j - b.j);   // départements mélangés : pas dix fois Paris
        l = await Promise.all(gardes.slice(0, max + 3).map((g) => appel("GET", `/products/${Number(g.id)}?fetch=${COMPLET}`).then(data).catch(() => null)));
      } else l = data(await appel("POST", `/products/search?fetch=${COMPLET}`, { criterias: c, status_web: true, count: Math.min(30, max + sans.size + 5) }));
      const out = [];
      for (const p of Array.isArray(l) ? l : []) {
        if (!p || sans.has(String(p.id))) continue;
        const photos = (p.products_photos || []).filter((x) => x && (!dossier || x.type === dossier) && !x.is_red && !x.is_mid && /^https:\/\//.test(x.chemin || ""))
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((x) => x.chemin);
        if (!photos.length) continue;   // une carte de carrousel exige une image
        const criteres = [];
        for (const [g, nature] of [[p.criteres_text, "texte"], [p.criteres_number, "nombre"], [p.criteres_flag, "case"]])
          for (const k of Array.isArray(g) ? g : []) if (k.critere_id != null && k.critere_name) criteres.push({ id: +k.critere_id, nom: String(k.critere_name), valeur: k.critere_value_name != null && String(k.critere_value_name).trim() ? k.critere_value_name : k.critere_value, nature });
        const descriptions = (p.descriptions || []).filter((d) => d && (d.description || d.title)).map((d) => ({ langue: String(d.language_code || ""), titre: d.title || "", texte: d.description || "" }));
        out.push({ ...(await versBien(p)), photos: photos.slice(0, 10), annonce: { criteres, descriptions, pieces: [] } });
        if (out.length >= max) break;
      }
      return out;
    },
    biensParCriteres: async (q, { max = 2 } = {}) => {
      const c = [];
      if (q.type) { const code = await codeType(q.type); if (code) c.push({ id: await cleXml("TypeBien"), operator: "EGAL", value: code }); }
      if (q.pieces) c.push({ id: await cleXml("NbPieces", "NbPiece"), operator: "EGAL", value: String(q.pieces) });
      if (q.surface) c.push({ id: await cleXml("Surface"), operator: "EGAL", value: String(q.surface) });
      if (q.prix) c.push({ id: await cleXml("Prix"), operator: "EGAL", value: String(q.prix) });
      if (q.prix_min) c.push({ id: await cleXml("Prix"), operator: "SUPERIEUR", value: String(q.prix_min) });
      if (q.prix_max) c.push({ id: await cleXml("Prix"), operator: "INFERIEUR", value: String(q.prix_max) });
      if (q.lieu) c.push({ id: await cleXml("CPVilleweb", "CPVille"), operator: "CONTIENT", value: String(q.lieu) });
      if (!c.length) return [];
      return (await recherche({ criterias: c, count: max })).slice(0, max);
    },
    contactsParEmail: (e) => chercherContacts({ email: e }).then((l) => l.filter((c) => c.emails.map((x) => String(x).toLowerCase()).includes(String(e).toLowerCase()))),
    contactsParTelephone: (t) => chercherContacts({ phone: String(t).replace(/^\+33/, "0") }).then((l) => l.filter((c) => c.telephones.some((x) => x.replace(/\D/g, "").slice(-9) === String(t).replace(/\D/g, "").slice(-9)))),
    contact: lireContact,
    suivis,
    capacites: ["catalogue", "contact", "suivi", "projet", "commentaire", "action", "consentement", "webhooks"],
    origines: async () => data(await appel("GET", "/customers/origins")),
    groupes: async () => data(await appel("GET", "/customers/groups")),
    /* Le POST détecte les doublons sur e-mail OU téléphone. Créer avec
       l'e-mail seul évite de rattacher un nouvel acquéreur au numéro partagé
       d'un autre contact. Le téléphone est complété ensuite, sans perdre l'ID. */
    creerContact: async (d) => {
      const provisoire = !d.email;
      const corps = { email: d.email || emailTelephone(d.telephone, cfg.site_id), check_duplicate: true };
      if (provisoire) corps.phone = d.telephone;
      corps.firstname = d.prenom || PRENOM_MANQUANT;
      corps.lastname = d.nom || NOM_MANQUANT;
      if (d.agence && isFinite(+d.agence)) corps.agency_id = Number(d.agence); if (d.negociateur && isFinite(+d.negociateur)) corps.user_id = Number(d.negociateur);
      if (d.origine) corps.origin = Number(d.origine); if (cfg.groupe_demandeur) corps.group = Number(cfg.groupe_demandeur);
      let id, deja = false;
      try { id = (data(await appel("POST", "/customers", corps)) || {}).id; }
      catch (e) {
        if (e.http !== 409) throw e;
        let exacts = (await chercherContacts({ email: corps.email }))
          .filter((c) => c.emails.some((x) => String(x).trim().toLowerCase() === String(corps.email).trim().toLowerCase()));
        if (!exacts.length && provisoire) exacts = (await chercherContacts({ phone: String(d.telephone).replace(/^\+33/, "0") }))
          .filter(c => c.telephones.some(x => String(x).replace(/\D/g, "").slice(-9) === String(d.telephone).replace(/\D/g, "").slice(-9)));
        if (!exacts.length) throw e;
        id = recent(exacts).id;
        deja = true;
      }
      if (!id) throw new Error("Immofacile : création sans identifiant de contact confirmé");
      const non_pris = [];
      if (deja) {
        const ex = await lireContact(id);
        if (!ex) throw new Error("Immofacile : contact existant illisible après conflit 409");
        const p = completer(ex, d);
        const patch = {};
        if (p.prenom) patch.firstname = p.prenom;
        if (p.nom) patch.lastname = p.nom;
        if (p.email) patch.email = p.email;
        if (p.telephone) patch.phone = p.telephone;
        if (p.mobile) patch.mobile_phone = p.mobile;
        if (d.origine && !ex.origine) patch.origin = Number(d.origine);
        if (d.agence && String(ex.agence || "") !== String(d.agence)) patch.agency_id = Number(d.agence);
        if (d.negociateur && String(ex.negociateur || "") !== String(d.negociateur)) patch.user_id = Number(d.negociateur);
        if (Object.keys(patch).length) await appel("PATCH", `/customers/${Number(id)}`, patch);
        non_pris.push(...await relire(id, patch));
      } else {
        if (d.telephone && !provisoire) {
          const field = /^\+33[67]\d{8}$/.test(d.telephone) ? "mobile_phone" : "phone";
          try { await appel("PATCH", `/customers/${Number(id)}`, { [field]: d.telephone }); }
          catch (e) { non_pris.push(field + " : " + e.message); }
        }
        non_pris.push(...await relire(id, corps));
      }
      const affectationNonConfirmee = ("user_id" in corps || "agency_id" in corps) &&
        non_pris.some(k => ["user_id", "agency_id"].includes(k) || k.startsWith("relecture impossible"));
      const identiteNonConfirmee = provisoire && non_pris.some(k => k === "phone" || k.startsWith("relecture impossible"));
      return { id, ...(deja ? { deja: true } : {}), ...(non_pris.length ? { non_pris } : {}),
        ...(identiteNonConfirmee ? { identite_confirmee: false } : {}),
        ...(affectationNonConfirmee ? { affectation_confirmee: false } : {}) };
    },
    majContact: async (id, p) => {
      const corps = {};
      if (p.email) corps.email = p.email;
      if (p.prenom) corps.firstname = p.prenom; if (p.nom) corps.lastname = p.nom;
      if (p.mobile) corps.mobile_phone = p.mobile; if (p.telephone) corps.phone = p.telephone;
      if (p.agence && isFinite(+p.agence))
        corps.agency_id = Number(p.agence);

      if (p.negociateur && isFinite(+p.negociateur))
        corps.user_id = Number(p.negociateur);

      if (p.origine && isFinite(+p.origine))
        corps.origin = Number(p.origine);

      if (cfg.groupe_demandeur && isFinite(+cfg.groupe_demandeur))
        corps.group = Number(cfg.groupe_demandeur);
      if (!Object.keys(corps).length) return { id };
      await appel("PATCH", `/customers/${Number(id)}`, corps);
      const non_pris = await relire(id, corps);
      if ("email" in corps && non_pris.some(k => k === "email" || k.startsWith("relecture impossible")))
        throw new Error("e-mail réel non confirmé après remplacement de l'adresse provisoire");
      if (("user_id" in corps || "agency_id" in corps) &&
          non_pris.some(k => ["user_id", "agency_id"].includes(k) || k.startsWith("relecture impossible")))
        throw new Error("réaffectation du contact CRM non confirmée par relecture : " + non_pris.join(", "));
      return { id, ...(non_pris.length ? { non_pris } : {}) };
    },
    /* Couleur du contact (température du projet). L'identifiant est celui de la palette du site. */
    couleurContact: async (id, couleur) => { await appel("PATCH", `/customers/${Number(id)}`, { color_id: Number(couleur) }); return { id }; },
    /* Suivi (rapprochement) contact ↔ bien ; 409 = déjà suivi, c'est bon. */
    lierBien: async (contactId, bienId) => {
      const r = await tolere409(() => appel("POST", `/customers/${Number(contactId)}/follow-ups/${Number(bienId)}`));
      if (!(await suivis(contactId)).some(s => String(s.bien) === String(bienId)))
        throw new Error("liaison du contact au bien non confirmée par relecture Immofacile");
      return { id: contactId, deja: !!(r && r.deja), confirme: true };
    },
    /* Projet de recherche (POST /customers/{id}/search-requests), un par dossier. Les critères sont
       ceux du bien demandé (doc API, cas d'usage 1, étape 3) ou ceux donnés par le portail.
       Les clés XML sont celles du site (GET /criterias/search-requests). */
    creerRecherche: async (contactId, r) => {
      const c = await criteresRecherche(r);
      if (!c.length && !r.comment) return null;
      const corps = { wording: String(r.libelle || "Demande reçue par mail").slice(0, 120), alertEmail: false, criteria: c };
      if (r.comment) corps.comment = String(r.comment);
      const out = data(await appel("POST", `/customers/${Number(contactId)}/search-requests`, corps));
      return { id: out && out.id };
    },
    /* Mise à jour du projet : le commentaire est remplacé par la conversation reconstruite. */
    majRecherche: async (contactId, id, r) => {
      const corps = {};
      if (r.comment != null) corps.comment = String(r.comment);
      if (r.criteres) corps.criteria = await criteresRecherche(r.criteres);
      if (!Object.keys(corps).length) return { id };
      await appel("PATCH", `/customers/${Number(contactId)}/search-requests/${Number(id)}`, corps);
      return { id };
    },
    /* Action commerciale (visible dans l'onglet si le type d'action a des actions filles). */
    ajouterAction: async (contactId, a) => {
      const corps = { action_id: Number(a.action_id || cfg.action_lead), result: String(a.texte || "").slice(0, 4000) };
      if (a.negociateur && isFinite(+a.negociateur)) corps.user_id = Number(a.negociateur);
      if (a.date) corps.date_performed = new Date(a.date).toISOString();
      if (!corps.action_id) return null;
      return { id: (data(await appel("POST", `/customers/${Number(contactId)}/actions`, corps)) || {}).id };
    },
    /* Catalogue complet ou modifié depuis une date (synchronisation du catalogue local). */
    catalogue: async function* ({ depuis } = {}) {
      let cursor = null; const vus = new Set();
      for (let page = 0; page < 1000; page++) {
        const corps = { ...(depuis ? { last_modified: new Date(depuis).toISOString().replace(/\.\d{3}Z$/, "+00:00") } : {}), ...(cursor ? { cursor } : { count: 100 }), sort_type: "id", sort_order: "asc" };
        const j = await appel("POST", `/products/search?fetch=${FETCH}`, corps);
        const l = Array.isArray(j && j.data) ? j.data : [];
        const biens = [];
        for (const p of l) if (p && p.id && !vus.has(p.id)) { vus.add(p.id); biens.push(await versBien(p)); }
        if (biens.length) yield biens;
        const next = j && (j.next_cursor || (j.meta && j.meta.next_cursor));
        if (!next || !l.length || next === cursor) break;
        cursor = next;
      }
    },
    /* Consentement anti-démarchage (POST /customers/{id}/consent, multipart) :
       reason (64 caractères max), consent_date (ISO), proofs[] (rangées dans Documents confidentiels/Consentement). */
    confirmerRgpd: async (contactId) => {
      const avant = await lireContact(contactId);
      if (!avant || typeof avant.rgpd_consent !== "boolean")
        throw new Error("confirmation RGPD illisible sur la fiche Immofacile : à vérifier");
      if (!avant.consentement) throw new Error("consentement du contact non confirmé : conformité RGPD non modifiée");
      if (avant.conformite === 2) throw new Error("contact déclaré non conforme dans Immofacile : vérification manuelle requise");
      if (avant.conformite === 1 && avant.rgpd_consent) return { id: contactId, confirme: true, deja: true };
      const corps = {};
      if (!avant.rgpd_consent) corps.rgpd_consent = true;
      if (avant.conformite !== 1) corps.conformity = 1;
      await appel("PATCH", `/customers/${Number(contactId)}`, corps);
      const apres = await lireContact(contactId);
      if (!apres || apres.rgpd_consent !== true)
        throw new Error("confirmation RGPD écrite mais non confirmée sur la fiche Immofacile : à vérifier");
      if (apres.conformite === null)
        throw new Error("consentement RGPD relu et confirmé ; confirmation conformity non exposée par Immofacile : à vérifier sur la fiche");
      if (apres.conformite !== 1)
        throw new Error("conformité RGPD écrite mais non confirmée par relecture Immofacile");
      return { id: contactId, confirme: true };
    },
    ajouterConsentement: async (contactId, a) => {
      const fd = new FormData();
      fd.append("reason", String(a.motif).slice(0, 64));
      /* L'API valide Y-m-d\TH:i:sP : pas de millisecondes et décalage +00:00,
         même si son OpenAPI appelle plus largement cela « ISO 8601 ». */
      fd.append("consent_date", new Date(a.date).toISOString().replace(/\.\d{3}Z$/, "+00:00"));
      if (a.hors_horaires !== undefined) fd.append("accept_outside_hours", a.hors_horaires ? "1" : "0");
      for (const p of a.preuves || []) fd.append("proofs[]", new Blob([Buffer.from(p.base64, "base64")], { type: p.type || "application/octet-stream" }), p.nom);
      await appel("POST", `/customers/${Number(contactId)}/consent`, null, { multipart: fd });
      const confirme = await lireContact(contactId);
      if (!confirme || !confirme.consentement)
        throw new Error("consentement écrit mais non confirmé sur la fiche Immofacile : à vérifier");
      return { id: contactId, confirme: true };
    },
  };
};

module.exports = { creer, zonesDe };
