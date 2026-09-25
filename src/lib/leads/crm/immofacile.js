/* Adaptateur Immofacile API V2 (https://v2.immo-facile.com/api/v2/site).
   Jeton : POST {base}/client/token/site (Basic + site_id), gardé en mémoire jusqu'à expiration.
   Lecture : produits (recherche par model, par critères, détail), contacts (recherche paginée).
   Écriture : création / complément de contact, suivi sur un bien, consentement anti-démarchage.
   « lectureSeule » bloque toute écriture au niveau HTTP (mode ombre). */
"use strict";
const { typeBien } = require("../valeurs");
const { cle } = require("../texte");

const creer = (cfg = {}) => {
  const base = String(cfg.base || "https://v2.immo-facile.com/api").replace(/\/+$/, "");
  const racine = new URL(base).origin + "/api/v2/site";
  const f = cfg.fetch || fetch;
  let jeton = null, expire = 0, defs = null, typesBien = null;
  const journal = cfg.journal || (() => {});
  const LECTURE = (m, p) => (m === "GET" ? /^\/(discovery|customers\/\d+|customers\/(origins|groups)|criterias\/(product\/all|product\/[\w-]+|search-requests)|products\/\d+|agencies|users)(\?|\/|$)/.test(p) : m === "POST" && ["/products/search", "/customers/search"].includes(p.split("?")[0]));

  const token = async () => {
    if (jeton && Date.now() < expire - 60000) return jeton;
    const basic = await cfg.secret("basic");
    if (!basic) throw Object.assign(new Error("identifiants Immofacile absents (coffre : basic)"), { permanent: true });
    const r = await f(`${base}/client/token/site`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: /^basic /i.test(basic) ? basic : "Basic " + basic, Accept: "application/json" }, body: "site_id=" + encodeURIComponent(cfg.site_id) });
    const tx = await r.text();
    if (!r.ok) throw Object.assign(new Error(`jeton Immofacile HTTP ${r.status}`), { permanent: r.status === 401 || r.status === 403 });
    const j = JSON.parse(tx);
    if (!j.access_token) throw new Error("jeton Immofacile reçu sans access_token");
    jeton = j.access_token; expire = Date.now() + (+j.expires_in || 3000) * 1000;
    return jeton;
  };

  const appel = async (methode, chemin, corps, { multipart } = {}) => {
    if (cfg.lectureSeule && !LECTURE(methode, chemin)) throw Object.assign(new Error(`écriture bloquée (mode ombre) : ${methode} ${chemin}`), { permanent: true, ombre: true });
    for (let essai = 1; essai <= 4; essai++) {
      const t0 = Date.now();
      const headers = { Authorization: "Bearer " + (await token()), Accept: "application/json" };
      if (corps && !multipart) headers["Content-Type"] = "application/json";
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), cfg.delai_ms || 20000);
      let r;
      try { r = await f(racine + chemin, { method: methode, headers, body: multipart || (corps ? JSON.stringify(corps) : undefined), signal: ctrl.signal }); }
      catch (e) { clearTimeout(to); if (essai === 4) throw e; await new Promise((ok) => setTimeout(ok, 500 * essai)); continue; }
      clearTimeout(to);
      const tx = await r.text();
      journal({ methode, chemin, statut: r.status, ms: Date.now() - t0 });
      if (r.status === 401 && essai === 1) { jeton = null; continue; }
      if ((r.status === 429 || r.status >= 500) && essai < 4) { await new Promise((ok) => setTimeout(ok, (+r.headers.get("retry-after") || essai) * 1000)); continue; }
      if (!r.ok) throw Object.assign(new Error(`Immofacile ${methode} ${chemin} → HTTP ${r.status} : ${tx.slice(0, 300)}`), { http: r.status, permanent: r.status >= 400 && r.status < 500 && r.status !== 429 });
      try { return tx ? JSON.parse(tx) : {}; } catch (e) { return { brut: tx }; }
    }
  };
  const data = (j) => (j && j.data !== undefined ? j.data : j);

  /* Définitions des critères produit : id numérique → nom XML (Prix, Surface, NbPiece, TypeBien…). */
  const criteres = async () => {
    if (defs) return defs;
    const l = data(await appel("GET", "/criterias/product/all")) || [];
    defs = new Map((Array.isArray(l) ? l : []).filter((d) => d && d.id != null).map((d) => [String(d.id), String(d.xml || d.name || d.id)]));
    return defs;
  };
  const codeType = async (canon) => {
    if (!typesBien) {
      const d = [...(await criteres()).entries()].find(([, x]) => cle(x) === "typebien");
      const vals = d ? data(await appel("GET", "/criterias/product/" + d[0])) : [];
      typesBien = (Array.isArray(vals) ? vals : vals && vals.values ? vals.values : []).map((v) => ({ code: String(v.value ?? v.id ?? v.code), libelle: String(v.label ?? v.name ?? v.value) }));
    }
    const t = typesBien.find((x) => typeBien(x.libelle) === canon);
    return t ? t.code : null;
  };

  const versBien = async (p) => {
    if (!p) return null;
    const D = await criteres().catch(() => new Map());
    const v = {}, lab = {};
    for (const g of [p.criteres_text, p.criteres_number, p.criteres_fulltext, p.criteres_flag]) for (const c of Array.isArray(g) ? g : []) {
      const id = c.critere_id ?? c.criteria_id ?? c.criterias_id ?? c.id;
      const x = (id != null && D.get(String(id))) || c.critere_xml || c.xml;
      if (!x) continue;
      const val = c.critere_value ?? c.value ?? c.valeur; if (val != null && String(val).trim()) v[cle(x)] = val;
      const l = c.critere_value_name ?? c.value_name ?? c.label; if (l != null) lab[cle(x)] = l;
    }
    const n = (k) => (v[k] != null && isFinite(+String(v[k]).replace(",", ".")) ? +String(v[k]).replace(",", ".") : null);
    const a = p.assigned_to || p.assignedTo || {};
    return {
      id: p.id, reference: String(p.model || "").trim(), prix: +p.price || n("prix"), surface: n("surface"), pieces: n("nbpiece") || n("nbpieces"), chambres: n("nbchambre") || n("chambres"),
      type: typeBien(lab.typebien || v.typebien || (p.category && (p.category.name || p.category.label)) || ""), ville: v.villeweb || v.ville_web || null,
      code_postal: (String(v.codepostalweb || v.cpvilleweb || "").match(/\d{5}/) || [])[0] || null,
      negociateur_id: a.id ?? a.user_id ?? p.user_id ?? null, agence_id: p.agency_id ?? (p.agency && p.agency.id) ?? null, brut_id: p.id,
    };
  };
  const detail = async (id) => versBien(data(await appel("GET", `/products/${Number(id)}?fetch=criteres_text,criteres_number,assigned_to,category`)));
  const recherche = async (corps) => { const j = await appel("POST", "/products/search?fetch=assigned_to", corps); const l = data(j); return Array.isArray(l) ? l : []; };

  const versContact = (c) => ({ id: c.id, email: c.email || null, emails: [c.email, ...(c.emails || []).map((e) => e.email || e)].filter(Boolean), telephone: c.phone || null, mobile: c.mobile_phone || c.mobilePhone || null, telephones: [c.phone, c.mobile_phone, c.mobilePhone].filter(Boolean).map((t) => String(t).replace(/[^\d+]/g, "")), prenom: c.firstname || null, nom: c.lastname || null, cree_le: c.created_at || c.createdAt || c.created || null, agence_id: c.agency_id || null, negociateur_id: c.user_id || null });
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

  return {
    nom: "immofacile",
    lectureSeule: !!cfg.lectureSeule,
    tester: async () => ({ ok: true, discovery: data(await appel("GET", "/discovery")) }),
    bienParId: detail,
    biensParReference: async (ref) => { const l = await recherche({ model: String(ref), count: 5 }); return Promise.all(l.filter((p) => String(p.model || "").trim().toLowerCase() === String(ref).trim().toLowerCase()).slice(0, 3).map((p) => detail(p.id))); },
    biensParCriteres: async (q, { max = 2 } = {}) => {
      const c = [];
      if (q.type) { const code = await codeType(q.type); if (code) c.push({ id: "TypeBien", operator: "EGAL", value: code }); }
      if (q.pieces) c.push({ id: "NbPiece", operator: "EGAL", value: String(q.pieces) });
      if (q.surface) c.push({ id: "Surface", operator: "EGAL", value: String(q.surface) });
      if (q.prix) c.push({ id: "Prix", operator: "EGAL", value: String(q.prix) });
      if (q.lieu) c.push({ id: "CPVilleweb", operator: "CONTIENT", value: String(q.lieu) });
      if (!c.length) return [];
      const l = await recherche({ criterias: c, count: max });
      return Promise.all(l.slice(0, max).map((p) => detail(p.id)));
    },
    contactsParEmail: (e) => chercherContacts({ email: e }).then((l) => l.filter((c) => c.emails.map((x) => String(x).toLowerCase()).includes(String(e).toLowerCase()))),
    contactsParTelephone: (t) => chercherContacts({ phone: t }).then((l) => l.filter((c) => c.telephones.some((x) => x.slice(-9) === String(t).replace(/\D/g, "").slice(-9)))),
    origines: async () => data(await appel("GET", "/customers/origins")),
    groupes: async () => data(await appel("GET", "/customers/groups")),
    creerContact: async (d) => {
      const corps = { email: d.email, check_duplicate: true };
      if (d.prenom) corps.firstname = d.prenom; if (d.nom) corps.lastname = d.nom;
      if (d.telephone) corps[/^\+33[67]\d{8}$/.test(d.telephone) ? "mobile_phone" : "phone"] = d.telephone;
      if (d.agence) corps.agency_id = Number(d.agence); if (d.negociateur) corps.user_id = Number(d.negociateur);
      if (d.origine) corps.origin = Number(d.origine); if (cfg.groupe_demandeur) corps.group = Number(cfg.groupe_demandeur);
      return versContact(data(await appel("POST", "/customers", corps)));
    },
    majContact: async (id, p) => {
      const corps = {};
      if (p.prenom) corps.firstname = p.prenom; if (p.nom) corps.lastname = p.nom;
      if (p.mobile) corps.mobile_phone = p.mobile; if (p.telephone) corps.phone = p.telephone;
      if (!Object.keys(corps).length) return { id };
      return data(await appel("PATCH", `/customers/${Number(id)}`, corps));
    },
    lierBien: async (contactId, bienId, note) => data(await appel("POST", `/customers/${Number(contactId)}/follow-ups/${Number(bienId)}`, { comment: String(note || "").slice(0, 2000) })),
    /* Consentement : multipart (date, motif, preuves). Noms de champs configurables : à valider sur la doc V2 avant le passage en réel. */
    ajouterConsentement: async (contactId, a) => {
      const n = { date: "date", motif: "reason", preuve: "proofs[]", ...(cfg.champs_consentement || {}) };
      const fd = new FormData();
      fd.append(n.date, String(a.date).slice(0, 10)); fd.append(n.motif, a.motif);
      for (const p of a.preuves || []) fd.append(n.preuve, new Blob([Buffer.from(p.base64, "base64")], { type: p.type || "application/octet-stream" }), p.nom);
      return data(await appel("POST", `/customers/${Number(contactId)}/consent`, null, { multipart: fd }));
    },
  };
};

module.exports = { creer };
