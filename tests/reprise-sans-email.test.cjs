"use strict";
const assert=require("node:assert/strict"), Module=require("node:module");
let saved=null, traitements=0;
const row={id:1,mail_id:7,contact_tel:"+33612345678",bien_crm:"99",nature:"lead",mode:"ancien"};
const client={contact:async()=>({id:42,telephones:[row.contact_tel],negociateur:20,agence:40}),suivis:async()=>[{bien:"99"}],bienParId:async()=>({id:99,negociateur_id:20,agence_id:40})};
const original=Module._load;
Module._load=function(n,parent,...rest){
 if(parent.filename.endsWith("sans_email.js")) {
  if(n==="./schema")return {nom:()=>"ld_leads",prefixe:()=>"ld_",tables:async()=>({leads:{getRow:async()=>({...row})}})};
  if(n==="./conf")return {charger:async()=>({crm:{type:"immofacile",mode:"reel"}})};
  if(n==="./core")return {flowApi:()=>({crmDepuisCoffre:()=>client})};
  if(n==="./dossier")return {traiterMail:async()=>{traitements++;row.contact_crm="42";}};
  if(n==="./reprise_crm")return {echecsCrm:()=>[]};
  if(n==="@saltcorn/data/db")return {getTenantSchema:()=>"test",query:async(sql,args)=>sql.includes("limit 1")?{rows:[{bien_crm:"99"}]}:{rows:[{...row}]}};
  if(n==="../../../store")return {ensureTables:async()=>({cache:{getRow:async()=>saved,insertRow:async r=>{saved={...r,id:1};},updateRow:async r=>{saved={...r,id:1};}}})};
 }
 return original.call(this,n,parent,...rest);
};
(async()=>{
 const {reprendre}=require("../src/lib/leads/tables/sans_email");
 const p={debut:"2026-08-01T04:00:00.000Z"};
 assert.equal((await reprendre({...p,budgetMs:0})).reste,1);
 const r=await reprendre(p);assert.equal(r.termine,true);assert.equal(r.contacts_confirmes,1);assert.equal(r.a_verifier,0);assert.equal(r.emails_envoyes,0);
 await reprendre(p);assert.equal(traitements,1,"recliquer ne retraite pas la demande terminée");
 Module._load=original;console.log("Reprise téléphone : mode ancien, reprise sauvegardée, contact/liaison/affectation relus, zéro envoi OK");
})().catch(e=>{console.error(e);process.exitCode=1;});
