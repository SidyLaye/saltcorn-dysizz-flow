"use strict";
const assert=require("node:assert/strict"), Module=require("node:module");
const rows=[1,2].map(id=>({id,mail_id:id,mode:"reel",nature:"lead",bien_crm:"42",contact_crm:String(100+id),recu_le:`2026-10-01T0${id+4}:00:00Z`,dossier:"{}"}));
let actif=false,calls=[];
const original=Module._load;
Module._load=function(n,parent,...args){
  if(parent.filename.endsWith("reprise_crm.js")){
    if(n==="./conf")return {charger:async()=>({crm:{mode:"reel"},conf:{consentement:{actif:true}}})};
    if(n==="./schema")return {nom:()=>"ld_leads",tables:async()=>({leads:{getRows:async()=>rows,getRow:async({mail_id})=>rows.find(x=>x.mail_id===mail_id)}})};
    if(n==="@saltcorn/data/db")return {getTenantSchema:()=>"test",query:async()=>({rows})};
    if(n==="./dossier")return {traiterMail:async(id,o)=>{assert.equal(o.actualiserConsentement,true);calls.push(id);return {dossier:{actions:[{op:"ajouterConsentement",motif:"Motif actuel"}]}}}};
    if(n==="./core")return {flowApi:()=>({crmDepuisCoffre:()=>({contact:async()=>({consentement:actif,consentement_detail:{raison:"Motif actuel"}})})})};
  }
  return original.call(this,n,parent,...args);
};
const {reparerCrm}=require("../src/lib/leads/tables/reprise_crm");
(async()=>{
  const dates={debut:"2026-10-01T04:00:00Z",fin:"2026-10-02T04:00:00Z",suivi:{fait:0}};
  const stop=await reparerCrm(dates);assert.deepEqual(calls,[2]);assert.equal(stop.poursuite_autorisee,false);assert.equal(stop.traites,0);
  actif=true;calls=[];const ok=await reparerCrm(dates);assert.deepEqual(calls,[2,1,2]);assert.equal(ok.confirmes,2);assert.equal(ok.emails_envoyes_par_ce_bloc,0);
  console.log("Réparation CRM : dernier vérifié avant la période, refus arrête la reprise, motif confirmé, aucune notification");
})().catch(e=>{console.error(e);process.exitCode=1});
