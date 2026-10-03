/* Reprise ciblée par la pipeline existante, sans préparer ni envoyer de notifications. */
"use strict";
const S = require("./schema"), { charger } = require("./conf");
const { traiterMail } = require("./dossier");
const { echecsCrm } = require("./reprise_crm");
const lire = v => typeof v === "string" ? JSON.parse(v) : v || {};
const candidat = r => !String(r.contact_email || "").trim() &&
  /^\d{9,15}$/.test(String(r.contact_tel || "").replace(/\D/g, "")) &&
  /^\d+$/.test(String(r.bien_crm || "")) && !/^\d+$/.test(String(r.contact_crm || "")) &&
  /^(lead|relance|direct|recherche|estimation)$/.test(r.nature || "") && r.mode !== "ombre";
const reprendre = async ({ debut, suivi = {}, budgetMs = 80*60000 }) => {
  const date = new Date(debut);
  if (!Number.isFinite(date.getTime()) || date > new Date()) throw new Error("Date de début invalide");
  const { crm } = await charger();
  if (crm.type !== "immofacile" || crm.mode !== "reel") throw new Error("Immofacile réel requis");
  const api = require("./core").flowApi(), client = api.crmDepuisCoffre(crm.type, crm.reglages, crm.prefixe, "reel");
  const db = require("@saltcorn/data/db"), t = await S.tables();
  const table = `"${db.getTenantSchema()}"."${S.nom("leads")}"`;
  const cache = (await require("../../../store").ensureTables()).cache;
  const cle = `sans-email-v1:${S.prefixe()}:${date.toISOString()}`;
  const ancien = await cache.getRow({ cle });
  let state = ancien ? lire(ancien.valeur) : null;
  if (!state) {
    const fin = new Date().toISOString();
    const rows = (await db.query(`select id,mail_id,mode,nature,bien_crm,contact_crm,contact_email,contact_tel,recu_le,dossier
      from ${table} where recu_le >= $1 and recu_le <= $2 and coalesce(contact_email,'')=''
      and bien_crm ~ '^[0-9]+$' and coalesce(contact_crm,'') !~ '^[0-9]+$' order by recu_le,id`, [date.toISOString(),fin])).rows;
    state = { cibles: rows.filter(candidat), curseur: 0, rapport: { debut: date.toISOString(), fin,
      candidats: rows.filter(candidat).length, traites:0, contacts_confirmes:0, resultats:[], erreurs:[], emails_envoyes:0 } };
  }
  const sauver = async () => {
    const row = { cle, valeur: JSON.stringify(state), expire: new Date(Date.now()+90*86400000) };
    const ex = await cache.getRow({ cle });
    if (ex) await cache.updateRow(row,ex.id); else await cache.insertRow(row);
  };
  await sauver();
  const r = state.rapport, start = Date.now();
  suivi.total=state.cibles.length; suivi.fait=state.curseur;
  for (;state.curseur<state.cibles.length && Date.now()-start<budgetMs;state.curseur++) {
    const old=state.cibles[state.curseur]; suivi.etape=`fiche sans e-mail : lead ${old.id}`;
    try {
      const row = await t.leads.getRow({id:old.id});
      if (!row) throw new Error("Demande introuvable");
      const precedent = echecsCrm(row);
      if (precedent.some(x=>/résultat d'écriture inconnu|vérifier avant reprise/i.test(x.erreur)))
        throw new Error("Ancienne écriture ambiguë : vérifier la fiche avant toute reprise");
      if (!row.contact_crm) {
        if (!candidat(row)) throw new Error("La demande a changé : reprise à vérifier");
        await traiterMail(row.mail_id,{forcerOmbre:false});
      }
      const actuel=await t.leads.getRow({id:old.id}), id=actuel && actuel.contact_crm;
      if (!/^\d+$/.test(String(id||""))) throw new Error("La pipeline n'a pas confirmé de fiche CRM : " + String(actuel?.motifs||"à vérifier").slice(0,220));
      const contact=await client.contact(id), n=String(row.contact_tel).replace(/\D/g,"").slice(-9);
      if (!contact || !(contact.telephones||[]).some(x=>String(x).replace(/\D/g,"").slice(-9)===n))
        throw new Error("Téléphone de la fiche CRM non confirmé par relecture");
      if (!(await client.suivis(id)).some(x=>String(x.bien)===String(actuel.bien_crm)))
        throw new Error("Liaison de la fiche au bien non confirmée");
      // Après une reprise ancienne, le responsable reste celui de la demande la plus récente.
      const latest=(await db.query(`select bien_crm from ${table} where contact_crm=$1 and bien_crm ~ '^[0-9]+$'
        and nature in ('lead','relance','direct','recherche','estimation')
        and coalesce(mode,'') <> 'ombre' order by recu_le desc nulls last,id desc limit 1`,[String(id)])).rows[0];
      const bien=await client.bienParId(latest?.bien_crm || actuel.bien_crm);
      if (!bien?.negociateur_id) throw new Error("Négociateur du bien actuel introuvable");
      const patch={};
      if (String(contact.negociateur)!==String(bien.negociateur_id)) patch.negociateur=bien.negociateur_id;
      if (bien.agence_id && String(contact.agence)!==String(bien.agence_id)) patch.agence=bien.agence_id;
      if(Object.keys(patch).length) await client.majContact(id,patch);
      const relu=await client.contact(id);
      if(String(relu?.negociateur)!==String(bien.negociateur_id) || (bien.agence_id && String(relu?.agence)!==String(bien.agence_id)))
        throw new Error("Affectation non confirmée par relecture");
      r.contacts_confirmes++;
      r.resultats.push({lead_id:old.id,contact_id:id,telephone_confirme:true,bien_confirme:true,affectation_confirmee:true,erreurs_crm:echecsCrm(actuel)});
    } catch(e) { r.erreurs.push({lead_id:old.id,erreur:String(e.message||e).slice(0,400)}); }
    r.traites++; suivi.fait=state.curseur+1;
    // Chaque cas est sauvegardé : un redémarrage reprend la vérification, pas un envoi.
    state.curseur++; await sauver(); state.curseur--;
  }
  r.reste=state.cibles.length-state.curseur; r.termine=r.reste===0;
  r.a_verifier=r.erreurs.length+r.resultats.filter(x=>x.erreurs_crm.length).length;
  r.derniere_sauvegarde=new Date().toISOString(); await sauver();
  return r;
};
module.exports={candidat,reprendre};
