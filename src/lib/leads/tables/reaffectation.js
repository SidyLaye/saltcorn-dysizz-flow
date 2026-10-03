/* Rattrapage des affectations CRM uniquement. Aucun appel au traitement des mails ou au SMTP. */
"use strict";
const { tables, nom, prefixe } = require("./schema");
const { charger } = require("./conf");
const { cleVerrou, versMoteur } = require("./dossier");
const lire = v => typeof v === "string" ? JSON.parse(v) : v;
const email = v => String(v || "").trim().toLowerCase();
const positif = v => /^\d+$/.test(String(v || "")) && Number(v) > 0;
const NATURES = ["lead", "relance", "direct", "recherche", "estimation"];
const derniers = rows => {
  const m = new Map();
  for (const r of rows) {
    const k = String(r.contact_crm), old = m.get(k);
    if (!old || Date.parse(r.recu_le) > Date.parse(old.recu_le) ||
        (Date.parse(r.recu_le) === Date.parse(old.recu_le) && Number(r.id) > Number(old.id))) m.set(k, r);
  }
  return [...m.values()].sort((a,b) => Number(a.contact_crm) - Number(b.contact_crm));
};
const reaffecter = async ({ debut, suivi = {}, budgetMs = 80 * 60000 } = {}) => {
  const date = new Date(debut);
  if (!Number.isFinite(date.getTime()) || date > new Date()) throw new Error("Date de début invalide");
  const { conf, crm } = await charger();
  if (crm.type !== "immofacile" || crm.mode !== "reel") throw new Error("Immofacile réel doit être activé");
  const api = require("./core").flowApi();
  const client = api.crmDepuisCoffre(crm.type, { ...crm.reglages, groupe_demandeur: null }, crm.prefixe, "reel");
  const db = require("@saltcorn/data/db"), t = await tables();
  const cache = (await require("../../../store").ensureTables()).cache;
  const cle = `reaffectation-v1:${prefixe()}:${date.toISOString()}`;
  const ex = await cache.getRow({ cle });
  let etat = ex ? lire(ex.valeur) : null;
  const table = `"${db.getTenantSchema()}"."${nom("leads")}"`;
  if (!etat) {
    const fin = new Date().toISOString();
    const rows = (await db.query(`select id,mail_id,recu_le,contact_crm,contact_email,contact_tel,bien_crm,agence
      from ${table} where recu_le >= $1 and recu_le <= $2 and nature = any($3::text[])
      and coalesce(mode,'') <> 'ombre' and contact_crm ~ '^[0-9]+$' and bien_crm ~ '^[0-9]+$'`,
      [date.toISOString(), fin, NATURES])).rows;
    const sans = (await db.query(`select count(*)::int as n from ${table} where recu_le >= $1 and recu_le <= $2
      and nature = any($3::text[]) and bien_crm ~ '^[0-9]+$' and coalesce(contact_crm,'') !~ '^[0-9]+$'`,
      [date.toISOString(), fin, NATURES])).rows[0].n;
    etat = { debut: date.toISOString(), fin, cibles: derniers(rows), curseur: 0,
      rapport: { debut: date.toISOString(), fin, contacts: derniers(rows).length, demandes_sans_contact_crm: sans,
        traites: 0, confirmes: 0, modifies: 0, deja_corrects: 0, demandes_plus_recentes: 0,
        agence_non_verifiable: 0, erreurs: [], resultats: [], emails_envoyes: 0 } };
  }
  const sauver = async () => {
    const row = { cle, valeur: JSON.stringify(etat), expire: new Date(Date.now() + 90*86400000) };
    const old = await cache.getRow({ cle });
    if (old) await cache.updateRow(row, old.id); else await cache.insertRow(row);
  };
  await sauver();
  const r = etat.rapport, depart = Date.now(), biens = new Map();
  suivi.total = etat.cibles.length; suivi.fait = etat.curseur;
  for (; etat.curseur < etat.cibles.length && Date.now() - depart < budgetMs; etat.curseur++) {
    const row = etat.cibles[etat.curseur];
    suivi.etape = `affectation du contact ${row.contact_crm}`;
    const resultat = { lead_id: row.id, contact_id: row.contact_crm, bien_id: row.bien_crm };
    try {
      const mail = await t.mails.getRow({ id: row.mail_id });
      if (!mail) throw new Error("mail d'origine introuvable : affectation non modifiée");
      await api.verrou.sous(cleVerrou(api, versMoteur(mail), conf, mail.id), async () => {
        const latest = (await db.query(`select id,recu_le from ${table} where contact_crm=$1
          and nature=any($2::text[]) and bien_crm ~ '^[0-9]+$' and coalesce(mode,'') <> 'ombre'
          order by recu_le desc,id desc limit 1`, [String(row.contact_crm), NATURES])).rows[0];
        if (latest && Number(latest.id) !== Number(row.id)) {
          r.demandes_plus_recentes++; resultat.ignore = "une demande plus récente existe pour ce contact"; return;
        }
        if (!biens.has(row.bien_crm)) biens.set(row.bien_crm, await client.bienParId(row.bien_crm));
        const b = biens.get(row.bien_crm);
        if (!b || !positif(b.negociateur_id)) throw new Error("bien ou négociateur actuel du bien introuvable");
        if (String(b.proprietaire_id || "") === String(row.contact_crm)) throw new Error("contact propriétaire du bien : à vérifier avant réaffectation acquéreur");
        const avant = await client.contact(row.contact_crm);
        if (!avant) throw new Error("contact CRM introuvable");
        if (row.contact_email && email(row.contact_email) !== email(avant.email)) throw new Error("e-mail du contact différent de la demande : identité à vérifier");
        if (!row.contact_email) {
          const tel = String(row.contact_tel || "").replace(/\D/g, "");
          if (tel.length < 9 || !(avant.telephones || []).some(v => String(v).replace(/\D/g, "").slice(-9) === tel.slice(-9)))
            throw new Error("identité sans e-mail non confirmée par téléphone");
        }
        const personne = ((conf.routage || {}).personnes || []).find(p => String(p.id) === String(b.negociateur_id));
        const agence = positif(b.agence_id) ? b.agence_id : personne && positif(personne.agence_id) ? personne.agence_id : null;
        const patch = {};
        if (String(avant.negociateur || "") !== String(b.negociateur_id)) patch.negociateur = b.negociateur_id;
        if (agence && String(avant.agence || "") !== String(agence)) patch.agence = agence;
        if (Object.keys(patch).length) await client.majContact(row.contact_crm, patch);
        const suivis = await client.suivis(row.contact_crm);
        if (!suivis.some(s => String(s.bien) === String(b.id))) await client.lierBien(row.contact_crm, b.id);
        const apres = await client.contact(row.contact_crm);
        if (!apres || String(apres.negociateur) !== String(b.negociateur_id) || (agence && String(apres.agence) !== String(agence)))
          throw new Error("affectation non confirmée après relecture CRM");
        const liens = await client.suivis(row.contact_crm);
        if (!liens.some(s => String(s.bien) === String(b.id))) throw new Error("liaison au bien non confirmée après relecture CRM");
        resultat.negociateur_id = b.negociateur_id; resultat.agence_id = agence;
        resultat.affectation_confirmee = true; resultat.bien_confirme = true;
        resultat.agence_confirmee = agence ? true : null;
        if (!agence) r.agence_non_verifiable++;
        r.confirmes++;
        if (Object.keys(patch).length) r.modifies++; else r.deja_corrects++;
      }, { attente_ms: 10000 });
    } catch (e) { resultat.erreur = String(e.message || e).slice(0, 250); r.erreurs.push(resultat); }
    r.resultats.push(resultat); r.traites++; suivi.fait = etat.curseur + 1;
    // Points de reprise par dix contacts. Relecture/idempotence protègent un lot rejoué après interruption.
    if ((etat.curseur + 1) % 10 === 0) { etat.curseur++; await sauver(); etat.curseur--; }
  }
  r.reste = etat.cibles.length - etat.curseur; r.termine = r.reste === 0;
  r.a_verifier = r.erreurs.length + r.agence_non_verifiable;
  r.derniere_sauvegarde = new Date().toISOString();
  if (r.termine) r.termine_le = r.derniere_sauvegarde;
  else r.reprise = "Relancer le même Run JS : reprise au prochain contact, sans e-mail";
  await sauver(); return r;
};
module.exports = { reaffecter, derniers };
