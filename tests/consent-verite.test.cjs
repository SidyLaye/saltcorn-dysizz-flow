"use strict";
const assert = require("node:assert/strict");
const { etapeConsentement, executer } = require("../src/lib/leads/traiter");
const { miseAJour } = require("../src/lib/leads/dossiers");
const { completer, PRENOM_MANQUANT, NOM_MANQUANT } = require("../src/lib/leads/contact");
const fixture = (actif, ancienId=42) => ({ extraction:{contact:{},portail:"leboncoin"}, actions:[], motifs:[], alertes:[],
  contact:{id:42,action:"mettre_a_jour"}, statut:"pret", portail:"leboncoin",
  interne:{rgpd_disponible:true,dos:{contact_id:ancienId,consentement:true},contact_crm:{id:42,consentement:actif,rgpd:true,rgpd_consent:true,conformite:1},connus:[]}});
const conf = {consentement:{actif:true,libelle:"Nouveau motif via {portail} le {date}"}};
(async()=>{
  const absent=etapeConsentement(fixture(false),{date:"2026-10-02T01:00:00Z"},conf);
  assert.equal(absent.actions.filter(x=>x.op==="ajouterConsentement").length,1,"le cache vrai ne masque pas le consentement CRM absent");
  const present=etapeConsentement(fixture(true),{date:"2026-10-02T01:00:00Z"},conf);
  assert.equal(present.actions.length,0,"ne remplace pas spontanément un consentement actif");
  const sansRgpd = fixture(true); sansRgpd.interne.contact_crm.rgpd_consent = false;
  etapeConsentement(sansRgpd,{date:"2026-10-02T01:00:00Z"},conf);
  assert.deepEqual(sansRgpd.actions,[{op:"confirmerRgpd"}],"RGPD absent complété même si consentement présent");
  const resultatRgpd = await executer(sansRgpd,{confirmerRgpd:async id=>({id,confirme:true})},{mode:"reel"});
  assert.equal(resultatRgpd.resultats[0].fait,true);
  const lesDeux = fixture(false); lesDeux.interne.contact_crm.rgpd_consent = false;
  etapeConsentement(lesDeux,{date:"2026-10-02T01:00:00Z"},conf);
  assert.deepEqual(lesDeux.actions.map(a=>a.op),["ajouterConsentement","confirmerRgpd"]);
  const maj=etapeConsentement(fixture(true),{date:"2026-10-02T01:00:00Z"},{consentement:{...conf.consentement,actualiser_motif:true}});
  assert.match(maj.actions[0].motif,/Nouveau motif/);
  const failed=await executer(absent,{ajouterConsentement:async()=>{throw Error("non confirmé")}}, {mode:"reel"});
  assert.equal(failed.consentement,false);
  let appelsRgpd = 0;
  const absentCrm = {contact:{id:null},statut:"pret",actions:[{op:"confirmerRgpd"}]};
  const skip = await executer(absentCrm,{confirmerRgpd:async()=>{appelsRgpd++;}}, {mode:"reel"});
  assert.equal(skip.resultats[0].ignore,true);assert.equal(appelsRgpd,0,"sans CRM, aucune écriture RGPD");
  const nonConsenti = fixture(false); nonConsenti.actions=[{op:"confirmerRgpd"}];
  await executer(nonConsenti,{confirmerRgpd:async()=>{appelsRgpd++;}}, {mode:"reel"});
  assert.equal(appelsRgpd,0,"vérifié ne signifie pas consenti");
  assert.equal(miseAJour({contact_id:42,consentement:true,messages:[]},absent,failed).consentement,false);
  assert.equal(miseAJour({contact_id:1,consentement:true,messages:[]},{extraction:{},contact:{id:2}}, {contactId:2}).consentement,false,"pas de consentement hérité d'un autre contact");
  assert.deepEqual(completer({prenom:PRENOM_MANQUANT,nom:NOM_MANQUANT},{prenom:"Alice",nom:"Martin"}),{prenom:"Alice",nom:"Martin"});
  console.log("Consentement : CRM fait foi, motif explicite, échec non masqué, identité complétable");
})().catch(e=>{console.error(e);process.exitCode=1;});
