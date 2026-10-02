"use strict";
const assert = require("node:assert/strict");
const { etapeConsentement, executer } = require("../src/lib/leads/traiter");
const { miseAJour } = require("../src/lib/leads/dossiers");
const { completer, PRENOM_MANQUANT, NOM_MANQUANT } = require("../src/lib/leads/contact");
const fixture = (actif, ancienId=42) => ({ extraction:{contact:{},portail:"leboncoin"}, actions:[], motifs:[], alertes:[],
  contact:{id:42,action:"mettre_a_jour"}, statut:"pret", portail:"leboncoin",
  interne:{dos:{contact_id:ancienId,consentement:true},contact_crm:{id:42,consentement:actif},connus:[]}});
const conf = {consentement:{actif:true,libelle:"Nouveau motif via {portail} le {date}"}};
(async()=>{
  const absent=etapeConsentement(fixture(false),{date:"2026-10-02T01:00:00Z"},conf);
  assert.equal(absent.actions.filter(x=>x.op==="ajouterConsentement").length,1,"le cache vrai ne masque pas le consentement CRM absent");
  const present=etapeConsentement(fixture(true),{date:"2026-10-02T01:00:00Z"},conf);
  assert.equal(present.actions.length,0,"ne remplace pas spontanément un consentement actif");
  const maj=etapeConsentement(fixture(true),{date:"2026-10-02T01:00:00Z"},{consentement:{...conf.consentement,actualiser_motif:true}});
  assert.match(maj.actions[0].motif,/Nouveau motif/);
  const failed=await executer(absent,{ajouterConsentement:async()=>{throw Error("non confirmé")}}, {mode:"reel"});
  assert.equal(failed.consentement,false);
  assert.equal(miseAJour({contact_id:42,consentement:true,messages:[]},absent,failed).consentement,false);
  assert.equal(miseAJour({contact_id:1,consentement:true,messages:[]},{extraction:{},contact:{id:2}}, {contactId:2}).consentement,false,"pas de consentement hérité d'un autre contact");
  assert.deepEqual(completer({prenom:PRENOM_MANQUANT,nom:NOM_MANQUANT},{prenom:"Alice",nom:"Martin"}),{prenom:"Alice",nom:"Martin"});
  console.log("Consentement : CRM fait foi, motif explicite, échec non masqué, identité complétable");
})().catch(e=>{console.error(e);process.exitCode=1;});
