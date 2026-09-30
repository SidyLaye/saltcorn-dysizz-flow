/* Adaptateur Immofacile API V2 (https://v2.immo-facile.com/api/v2/site).
   Jeton : POST {base}/client/token/site (Basic + site_id), gardé en mémoire jusqu'à expiration.
   Lecture : produits (recherche par model, par critères, détail), contacts (recherche paginée).
   Écriture : création / complément de contact, suivi sur un bien, consentement anti-démarchage.
   « lectureSeule » bloque toute écriture au niveau HTTP (mode ombre). */
"use strict";
const { typeBien } = require("../valeurs");
const { cle } = require("../texte");

/* Jetons gardés d'un adaptateur à l'autre (un workflow en étapes en crée un par étape) :
   clé = empreinte de l'adresse, du site et des identifiants, jamais les identifiants eux-mêmes. */
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
  const lectureHttp = async (url, options) => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), cfg.delai_ms || 15000);
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
      try { ({ r, tx } = await lectureHttp(racine + chemin, { method: methode, headers, body: multipart || (corps ? JSON.stringify(corps) : undefined) })); }
      catch (e) {
        if (!rejouable) throw Object.assign(new Error(`Immofacile ${methode} ${chemin} : résultat d'écriture inconnu, vérifier avant reprise`), { cause: e, ambiguous: true, permanent: true });
        if (essai === 4) throw e;
        await pause(null, essai); continue;
      }
      journal({ methode, chemin, statut: r.status, ms: Date.now() - t0 });
      if (r.status === 401 && essai === 1) { for (const [k, v] of JETONS) if (v.jeton === jeton) JETONS.delete(k); jeton = null; continue; }
      if ((r.status === 429 || (r.status >= 500 && rejouable)) && essai < 4) { await pause(r, essai); continue; }
      if (!r.ok) throw Object.assign(new Error(`Immofacile ${methode} ${chemin} → HTTP ${r.status}`), { http: r.status, ambiguous: !rejouable && r.status >= 500, permanent: (!rejouable && r.status >= 500) || (r.status >= 400 && r.status < 500 && r.status !== 429) });
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
      negociateur_id: a.id ?? a.user_id ?? p.userId ?? p.user_id ?? null, proprietaire_id: p.customers_id ?? p.customer_id ?? (p.customer && p.customer.id) ?? null, agence_id: p.agencyId ?? p.agency_id ?? (p.agency && p.agency.id) ?? null,
    };
  };
  const FETCH = "criteres_text,criteres_number,assigned_to,category";
  const detail = async (id) => versBien(data(await appel("GET", `/products/${Number(id)}?fetch=${FETCH}`)));
  /* Recherche avec ?fetch= : les biens reviennent complets (au plus 100 par page), sans appel de détail. */
  const recherche = async (corps) => { const l = data(await appel("POST", `/products/search?fetch=${FETCH}`, corps)); return Promise.all((Array.isArray(l) ? l : []).map((p) => (p && (p.criteres_text || p.criteresText) ? versBien(p) : detail(p.id || p)))); };

  const versContact = (c) => ({ id: c.id, email: c.email || null, emails: [c.email].filter(Boolean), telephone: c.phone || null, mobile: c.mobilePhone || c.mobile_phone || null,
    telephones: [c.phone, c.mobilePhone, c.mobile_phone].filter(Boolean).map((t) => String(t).replace(/[^\d+]/g, "")), prenom: c.firstname || null, nom: c.lastname || null,
    cree_le: c.createdAt || c.created_at || null,
    agence: idDe(c.agency ?? c.agency_id ?? c.manufacturer), negociateur: idDe(c.user ?? c.user_id ?? c.admin),
    consentement: !!(c.consent && !(c.consent.revokedAt || c.consent.revoked_at)), origine: idDe(c.origin ?? c.origin_id), groupes: [].concat(c.groups ?? c.group ?? []).map(idDe).filter(Boolean) });
  const idDe = (x) => (x == null ? null : typeof x === "object" ? x.id ?? null : x);
  /* Relecture après écriture : l'ancien service écrivait origin / group / phone sans jamais les
     retrouver à la relecture (2 081 cas sur 2 127). On relit et on dit ce qui n'a pas été pris. */
  const relire = async (id, corps) => {
    try {
      const c = (await lireContact(id)) || {};
      c.groupes = c.groupes || [];
      const chiffres = (x) => String(x || "").replace(/\D/g, "").slice(-9);
      const pris = { firstname: c.prenom, lastname: c.nom, phone: c.telephone, mobile_phone: c.mobile, agency_id: c.agence, user_id: c.negociateur, origin: c.origine, group: c.groupes[0] };
      return Object.keys(corps).filter((k) => k in pris && (k === "group" ? !c.groupes.map(String).includes(String(corps[k])) : ["phone", "mobile_phone"].includes(k) ? chiffres(pris[k]) !== chiffres(corps[k]) : String(pris[k] ?? "") !== String(corps[k])));
    } catch (e) { return ["relecture impossible : " + e.message]; }
  };
  /* POST /customers/search : plus récents d'abord, pagination par curseur (meta.next_cursor). */
  const chercherContacts = async (filtre) => {
    const out = [], vus = new Set(), curseurs = new Set(); let cursor = null;
    for (let page = 0; page < 20; page++) {
      const j = await appel("POST", "/customers/search", { ...filtre, per_page: 200, ...(cursor ? { cursor } : {}) });
      const l = Array.isArray(j && j.data) ? j.data : [];
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
  /* Contact avec ses relations : sans « include », origine et groupes ne reviennent pas
     (c'est pour ça que l'ancien service ne les retrouvait jamais à la relecture). */
  const lireContact = async (id) => {
    const c = data(await appel("GET", `/customers/${Number(id)}?include=origin,groups,user,agency,searchRequests,consent`));
    if (!c || !c.id) return null;
    const k = c.consent && !(c.consent.revokedAt || c.consent.revoked_at) ? c.consent : null;
    return { ...versContact(c), recherches: (c.searchRequests || []).map((x) => ({ id: x.id, comment: x.comment || "" })),
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
    tester: async () => ({ ok: true, agences: (data(await appel("GET", "/discovery")) || []).map((a) => ({ id: a.agency_id, nom: a.name, ville: a.city })) }),
    bienParId: detail,
    biensParReference: async (ref) => (await recherche({ model: String(ref), count: 5 })).filter((b) => b && b.reference.toLowerCase() === String(ref).trim().toLowerCase()).slice(0, 3),
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
    /* check_duplicate: true → 409 si un doublon existe (jamais de mise à jour silencieuse). */
    creerContact: async (d) => {
      const corps = { email: d.email, check_duplicate: true };
      if (d.prenom) corps.firstname = d.prenom; if (d.nom) corps.lastname = d.nom;
      if (d.telephone) corps[/^\+33[67]\d{8}$/.test(d.telephone) ? "mobile_phone" : "phone"] = d.telephone;
      if (d.agence && isFinite(+d.agence)) corps.agency_id = Number(d.agence); if (d.negociateur && isFinite(+d.negociateur)) corps.user_id = Number(d.negociateur);
      if (d.origine) corps.origin = Number(d.origine); if (cfg.groupe_demandeur) corps.group = Number(cfg.groupe_demandeur);
      const id = (data(await appel("POST", "/customers", corps)) || {}).id;
      const non_pris = id ? await relire(id, corps) : [];
      return { id, ...(non_pris.length ? { non_pris } : {}) };
    },
    majContact: async (id, p) => {
      const corps = {};
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
      return { id, ...(non_pris.length ? { non_pris } : {}) };
    },
    /* Suivi (rapprochement) contact ↔ bien ; 409 = déjà suivi, c'est bon. */
    lierBien: async (contactId, bienId) => {
      const r = await tolere409(() => appel("POST", `/customers/${Number(contactId)}/follow-ups/${Number(bienId)}`));
      return { id: contactId, deja: !!(r && r.deja) };
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
    ajouterConsentement: async (contactId, a) => {
      const fd = new FormData();
      fd.append("reason", String(a.motif).slice(0, 64));
      fd.append("consent_date", new Date(a.date).toISOString());
      if (a.hors_horaires !== undefined) fd.append("accept_outside_hours", a.hors_horaires ? "1" : "0");
      for (const p of a.preuves || []) fd.append("proofs[]", new Blob([Buffer.from(p.base64, "base64")], { type: p.type || "application/octet-stream" }), p.nom);
      await appel("POST", `/customers/${Number(contactId)}/consent`, null, { multipart: fd });
      return { id: contactId };
    },
  };
};

module.exports = { creer };
