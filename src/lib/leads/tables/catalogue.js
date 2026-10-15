/* Catalogue local des biens (ld_biens), synchronisé avec le CRM :
   - synchronisation complète (bouton, ou si le catalogue est vide), puis delta par date de modification
     une fois par heure (Immofacile interdit l'interrogation intensive) ;
   - mise à jour en temps réel par webhook (PRODUCT_CREATE / UPDATE / DELETE) ;
   - le rapprochement lit le catalogue local (rapide, sans appel), et le CRM seulement en secours, une fois une
     synchronisation complète faite (un catalogue partiel, rempli bien par bien par le bot, ne doit pas le remplacer) ;
   - le bot lit le bien par bienFrais : relu dans le CRM puis enregistré ici, ou pris ici s'il est frais, fictif,
     ou si le CRM est lent ou en panne. Un bien « fictif » (essai) n'existe que dans l'application. */
"use strict";
const { tables } = require("./schema");
const { flowApi } = require("./core");
const { charger } = require("./conf");

const G = globalThis[Symbol.for("dysizz-flow.leads.catalogue")] || (globalThis[Symbol.for("dysizz-flow.leads.catalogue")] = { cache: new Map() });
/* cache par client et par jeu de tables (préfixe) */
const tenant = () => { let t = "public"; try { t = require("@saltcorn/data/db").getTenantSchema(); } catch (e) { /* rien */ } return t + ":" + require("./schema").prefixe(); };
const oublier = () => G.cache.delete(tenant());

const versLigne = (b) => ({ crm_id: String(b.id), reference: b.reference || null, prix: +b.prix || null, surface: +b.surface || null, pieces: +b.pieces || null, chambres: +b.chambres || null,
  type: b.type || null, ville: b.ville || null, code_postal: b.code_postal || null, negociateur: b.negociateur_id != null ? String(b.negociateur_id) : null, agence: b.agence_id != null ? String(b.agence_id) : null, proprietaire: b.proprietaire_id != null ? String(b.proprietaire_id) : null, supprime: false, synchro_le: new Date() });
const versBien = (r) => ({ id: isFinite(+r.crm_id) ? +r.crm_id : r.crm_id, reference: r.reference || "", prix: r.prix, surface: r.surface, pieces: r.pieces, chambres: r.chambres, type: r.type, ville: r.ville, code_postal: r.code_postal, negociateur_id: r.negociateur, agence_id: r.agence, proprietaire_id: r.proprietaire });

const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
const pourBot = (r) => (r ? { ...versBien(r), photos: json(r.photos, []), fictif: !!r.fictif, synchro_le: r.synchro_le || null } : null);
const lignesDe = async (t, id) => t.biens.getRows({ crm_id: String(id) }, { orderBy: "id" });
const EN_COURS = G.enCours || (G.enCours = new Map());
const TROP_LONG = Symbol("trop long");

/* Relit un bien et ses photos dans le CRM (une requête), l'enregistre (un seul enregistrement par bien), le rend.
   404 ou 403 : le bien n'existe plus (ou plus pour ce site), il est marqué supprimé (jamais un bien fictif). Autre erreur : relancée. */
const relire = async (client, id, dossierImages) => {
  const t = await tables();
  try {
    const b = await client.bienEtPhotos(id, dossierImages);
    const ligne = { ...versLigne(b), photos: JSON.stringify(b.photos || []) };
    const rows = await lignesDe(t, id);
    if (rows[0]) await t.biens.updateRow(ligne, rows[0].id); else await t.biens.insertRow(ligne);
    /* deux processus ont pu insérer en même temps : on garde le premier */
    for (const r of (await lignesDe(t, id)).slice(1)) await t.biens.deleteRows({ id: r.id });
    oublier();
    return { ...b, photos: b.photos || [] };
  } catch (e) {
    if (e && (e.http === 404 || e.http === 403)) {   /* Immofacile répond 403 pour un bien inexistant ou hors du périmètre du site */
      for (const r of await lignesDe(t, id)) if (!r.fictif) await t.biens.updateRow({ supprime: true, synchro_le: new Date() }, r.id);
      oublier();
      return null;
    }
    throw e;
  }
};

/* Le bien que le bot montre. Fictif : tel quel. Relu il y a moins de fraicheur_ms : tel quel (une rafale d'appels
   = un seul appel au CRM). Sinon relu dans le CRM, une seule relecture à la fois par bien dans ce processus ;
   au-delà de budget_ms ou en cas de panne du CRM, la version enregistrée est rendue (perime: true) et la relecture
   finit en arrière-plan. Rien d'enregistré et CRM muet : null. */
const bienFrais = async (client, id, { dossierImages = "", fraicheur_ms = 120000, budget_ms = 3500 } = {}) => {
  if (id == null || String(id).trim() === "") return null;
  const t = await tables();
  const ligne = (await lignesDe(t, id))[0] || null;
  const garde = ligne && !ligne.supprime ? pourBot(ligne) : null;
  if (ligne && ligne.fictif) return garde;
  if (garde && ligne.synchro_le && Date.now() - new Date(ligne.synchro_le).getTime() < fraicheur_ms) return garde;
  if (!isFinite(+id) || !client || !client.bienEtPhotos) return garde;
  const k = tenant() + ":" + String(id) + ":" + dossierImages;
  let p = EN_COURS.get(k);
  if (!p) { p = relire(client, id, dossierImages).finally(() => EN_COURS.delete(k)); EN_COURS.set(k, p); }
  const issue = p.then((b) => ({ b }), (e) => ({ e }));
  let minuteur;
  const r = await Promise.race([issue, new Promise((ok) => { minuteur = setTimeout(() => ok(TROP_LONG), budget_ms); })]);
  clearTimeout(minuteur);
  if (r === TROP_LONG) return garde ? { ...garde, perime: true } : (((await issue).b) || null);
  if (r.e) return garde ? { ...garde, perime: true } : null;
  return r.b;
};

const enregistrerBiens = async (biens) => {
  const t = await tables();
  for (const b of biens) {
    if (!b || b.id == null) continue;
    const ex = await t.biens.getRow({ crm_id: String(b.id) });
    if (ex) await t.biens.updateRow(versLigne(b), ex.id); else await t.biens.insertRow(versLigne(b));
  }
  oublier();
};

const crmDuClient = async (modeForce) => {
  const api = flowApi();
  if (!api) throw new Error("dysizz-flow 2.4 ou plus récent est nécessaire");
  const { crm, conf } = await charger();
  return { api, conf, crm, client: api.crmDepuisCoffre(crm.type, crm.reglages, crm.prefixe, modeForce || "ombre") };
};

/* Synchronisation : complète si « complet » ou si rien n'a jamais été synchronisé ; sinon depuis la dernière. */
const synchroniser = async ({ complet = false } = {}) => {
  const { api, client } = await crmDuClient("ombre");
  if (!client.catalogue) return { ok: false, message: "ce CRM ne sait pas donner son catalogue" };
  return api.verrou.sous("catalogue", async () => {
    const t = await tables();
    const R = (await t.reglages.getRows({}, { orderBy: "id", limit: 1 }))[0];
    const depuis = !complet && R && R.catalogue_synchro_le ? new Date(new Date(R.catalogue_synchro_le).getTime() - 10 * 60000) : null;
    const debut = new Date(); let n = 0; const vus = new Set();
    for await (const lot of client.catalogue({ depuis })) { await enregistrerBiens(lot); n += lot.length; lot.forEach((b) => vus.add(String(b.id))); }
    if (!depuis) { const tous = await t.biens.getRows({ supprime: false }); for (const r of tous) if (!r.fictif && !vus.has(String(r.crm_id))) await t.biens.updateRow({ supprime: true }, r.id); }
    const etat = `${depuis ? "delta" : "complet"} : ${n} bien(s) le ${debut.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`;
    if (R) await t.reglages.updateRow({ catalogue_synchro_le: debut, catalogue_etat: etat }, R.id);
    oublier();
    return { ok: true, n, complet: !depuis, message: etat };
  }, { attente_ms: 1000 });
};

/* Webhook du CRM : un bien créé / modifié / supprimé. */
const evenementBien = async (type, id) => {
  const t = await tables();
  if (/DELETE/i.test(type)) { const ex = await t.biens.getRow({ crm_id: String(id) }); if (ex) await t.biens.updateRow({ supprime: true, synchro_le: new Date() }, ex.id); oublier(); return "supprimé"; }
  const { client } = await crmDuClient("ombre");
  const b = await client.bienParId(id);
  if (b) await enregistrerBiens([b]);
  return b ? "à jour" : "introuvable";
};

/* Biens du catalogue local (sans les biens fictifs), gardés en mémoire 60 s par client ; vide tant qu'aucune
   synchronisation complète n'a eu lieu : le rapprochement passe alors au CRM. */
const biensLocaux = async () => {
  const k = tenant(), c = G.cache.get(k);
  if (c && Date.now() - c.t < 60000) return c.biens;
  const t = await tables();
  const R = (await t.reglages.getRows({}, { orderBy: "id", limit: 1 }))[0];
  const biens = R && R.catalogue_synchro_le ? (await t.biens.getRows({ supprime: false })).filter((r) => !r.fictif).map(versBien) : [];
  G.cache.set(k, { t: Date.now(), biens });
  return biens;
};
/* Biens fictifs d'une référence : un mail d'essai qui cite la référence exacte d'un bien fictif y est rattaché. */
const fictifsParReference = async (ref) => {
  const v = String(ref || "").trim().toLowerCase(); if (!v) return [];
  const t = await tables();
  return (await t.biens.getRows({ fictif: true, supprime: false })).filter((r) => String(r.reference || "").trim().toLowerCase() === v).map(versBien);
};

/* CRM « avec catalogue local » : les recherches de biens se font en local, le reste passe au CRM.
   Si le catalogue est vide (pas encore synchronisé), tout passe au CRM. */
const avecCatalogue = async (crm) => {
  const biens = await biensLocaux().catch(() => []);
  const fictifs = (ref) => fictifsParReference(ref).catch(() => []);
  if (!biens.length) return { ...crm, biensParReference: async (ref) => { const f = await fictifs(ref); return f.length ? f : crm.biensParReference(ref); } };
  const api = flowApi();
  const local = api.leads.ADAPTATEURS.memoire.creer({ biens });
  return {
    ...crm,
    catalogue_local: biens.length,
    bienParId: async (id) => (await local.bienParId(id)) || crm.bienParId(id).catch(() => null),
    biensParReference: async (ref) => { const f = await fictifs(ref); if (f.length) return f; const l = await local.biensParReference(ref); return l.length ? l : crm.biensParReference(ref).catch(() => []); },
    biensParCriteres: (q, o) => local.biensParCriteres(q, o),
    tousLesBiens: async () => biens,
  };
};

module.exports = { synchroniser, evenementBien, avecCatalogue, biensLocaux, fictifsParReference, enregistrerBiens, bienFrais, oublier };
