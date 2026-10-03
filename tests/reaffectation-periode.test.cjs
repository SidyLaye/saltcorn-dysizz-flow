"use strict";
const assert=require("node:assert/strict"),Module=require("node:module");
const rows=[{id:1,mail_id:1,contact_crm:"42",bien_crm:"99",contact_email:"a@example.test",recu_le:"2026-08-01T05:00:00Z"},
  {id:2,mail_id:2,contact_crm:"42",bien_crm:"100",contact_email:"a@example.test",recu_le:"2026-10-03T06:00:00Z"},
  {id:3,mail_id:3,contact_crm:"43",bien_crm:"101",contact_email:"wrong@example.test",recu_le:"2026-10-03T06:00:00Z"}];
let saved=null,writes=0,linked=[];
const c=new Map([["42",{id:42,email:"a@example.test",negociateur:10,agence:30}],["43",{id:43,email:"other@example.test"}]]);
const client={bienParId:async id=>({id,negociateur_id:20,agence_id:40}),contact:async id=>c.get(String(id)),
  majContact:async(id,p)=>{writes++;Object.assign(c.get(String(id)),{negociateur:p.negociateur,agence:p.agence});},
  suivis:async()=>linked,lierBien:async(_id,id)=>{linked.push({bien:String(id)});}};
const original=Module._load;
Module._load=function(n,parent,...rest){
  if(parent.filename.endsWith("reaffectation.js")){
    if(n==="./schema")return {nom:()=>"ld_leads",prefixe:()=>"ld_",tables:async()=>({mails:{getRow:async({id})=>({id})}})};
    if(n==="./conf")return {charger:async()=>({conf:{routage:{personnes:[]}},crm:{mode:"reel",type:"immofacile"}})};
    if(n==="./dossier")return {cleVerrou:(_a,_m,_c,id)=>"mail:"+id,versMoteur:x=>x};
    if(n==="./core")return {flowApi:()=>({crmDepuisCoffre:()=>client,verrou:{sous:async(_k,fn)=>fn()}})};
    if(n==="../../../store")return {ensureTables:async()=>({cache:{getRow:async()=>saved,insertRow:async r=>{saved={...r,id:1};},updateRow:async r=>{saved={...r,id:1};}}})};
    if(n==="@saltcorn/data/db")return {getTenantSchema:()=>"test",query:async(sql,args)=>{
      if(sql.includes("count(*)"))return {rows:[{n:1}]};
      if(sql.includes("order by recu_le"))return {rows:rows.filter(r=>r.contact_crm===args[0]).slice(-1)};
      assert.ok(sql.includes("<> 'ombre'"));assert.equal(args[0],"2026-08-01T04:00:00.000Z");return {rows};
    }};
  }
  return original.call(this,n,parent,...rest);
};
const {reaffecter,derniers}=require("../src/lib/leads/tables/reaffectation");
(async()=>{
  assert.deepEqual(derniers(rows).map(r=>r.id),[2,3]);
  const initial=await reaffecter({debut:"2026-08-01T04:00:00Z",budgetMs:0,suivi:{}});
  assert.equal(initial.termine,false);assert.equal(initial.reste,2);assert.equal(writes,0);
  const r=await reaffecter({debut:"2026-08-01T04:00:00Z",suivi:{}});
  assert.equal(r.termine,true);assert.equal(r.confirmes,1);assert.equal(r.erreurs.length,1);
  assert.equal(r.emails_envoyes,0);assert.equal(writes,1);assert.equal(linked[0].bien,"100");
  assert.equal(r.resultats[0].affectation_confirmee,true);assert.equal(r.resultats[0].bien_confirme,true);
  await reaffecter({debut:"2026-08-01T04:00:00Z",suivi:{}});assert.equal(writes,1,"reprise terminée sans refaire les écritures");
  console.log("Période : dernière demande par contact, ancien mode inclus, identité, reprise durable, liaison vérifiée, zéro SMTP OK");
})().catch(e=>{console.error(e);process.exitCode=1});
