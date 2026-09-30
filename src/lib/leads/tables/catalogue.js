/* Catalogue local des biens (ld_biens), synchronisé avec le CRM :
   - synchronisation complète (bouton, ou si le catalogue est vide), puis delta par date de modification
     une fois par heure (Immofacile interdit l'interrogation intensive) ;
   - mise à jour en temps réel par webhook (PRODUCT_CREATE / UPDATE / DELETE) ;
   - le rapprochement lit le catalogue local (rapide, sans appel), et le CRM seulement en secours. */
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
    if (!depuis) { const tous = await t.biens.getRows({ supprime: false }); for (const r of tous) if (!vus.has(String(r.crm_id))) await t.biens.updateRow({ supprime: true }, r.id); }
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

/* Biens du catalogue local, gardés en mémoire 60 s par client. */
const biensLocaux = async () => {
  const k = tenant(), c = G.cache.get(k);
  if (c && Date.now() - c.t < 60000) return c.biens;
  const t = await tables();
  const biens = (await t.biens.getRows({ supprime: false })).map(versBien);
  G.cache.set(k, { t: Date.now(), biens });
  return biens;
};

/* CRM « avec catalogue local » : les recherches de biens se font en local, le reste passe au CRM.
   Si le catalogue est vide (pas encore synchronisé), tout passe au CRM. */
const avecCatalogue = async (crm) => {
  const biens = await biensLocaux().catch(() => []);
  if (!biens.length) return crm;
  const api = flowApi();
  const local = api.leads.ADAPTATEURS.memoire.creer({ biens });
  return {
    ...crm,
    catalogue_local: biens.length,
    bienParId: async (id) => (await local.bienParId(id)) || crm.bienParId(id).catch(() => null),
    biensParReference: async (ref) => { const l = await local.biensParReference(ref); return l.length ? l : crm.biensParReference(ref).catch(() => []); },
    biensParCriteres: (q, o) => local.biensParCriteres(q, o),
    tousLesBiens: async () => biens,
  };
};

module.exports = { synchroniser, evenementBien, avecCatalogue, biensLocaux, enregistrerBiens, oublier };
