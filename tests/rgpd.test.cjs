"use strict";
const assert=require("node:assert/strict");
const {creer}=require("../src/lib/leads/crm/immofacile");
(async()=>{
  for(const initial of [true,false,"inconnu"]){
    let conformity=initial?1:0,patches=0;
    const crm=creer({site_id:"rgpd-"+initial,secret:async()=>"test",fetch:async(url,o)=>{
      if(url.includes("/client/token/site"))return new Response(JSON.stringify({access_token:"test"}));
      if(o.method==="PATCH"){
        assert.deepEqual(JSON.parse(o.body),{conformity:1});patches++;conformity=1;
        return new Response(null,{status:204});
      }
      assert.ok(url.includes("consent,rgpd"));
      return new Response(JSON.stringify({data:{id:42,conformity,rgpd_consent:initial==="inconnu"?null:true,consent:{reason:"Motif conservé"}}}));
    }});
    if(initial==="inconnu")await assert.rejects(crm.confirmerRgpd(42),/illisible/);
    else{
      assert.equal((await crm.confirmerRgpd(42)).confirme,true);
      assert.equal((await crm.confirmerRgpd(42)).deja,true,"reprise sans écriture supplémentaire");
    }
    assert.equal(patches,initial===false?1:0);
  }
  const crm=creer({site_id:"rgpd-non-confirme",secret:async()=>"test",fetch:async(url,o)=>{
    if(url.includes("/client/token/site"))return new Response(JSON.stringify({access_token:"test"}));
    if(o.method==="PATCH")return new Response(null,{status:204});
    return new Response(JSON.stringify({data:{id:42,conformity:0,rgpd_consent:true,consent:{reason:"Demande"}}}));
  }});
  await assert.rejects(crm.confirmerRgpd(42),/non confirmée/);
  const sansChamp=creer({site_id:"conformity-absent",secret:async()=>"test",fetch:async(url,o)=>{
    if(url.includes("/client/token/site"))return new Response(JSON.stringify({access_token:"test"}));
    if(o.method==="PATCH")return new Response(null,{status:204});
    return new Response(JSON.stringify({data:{id:42,rgpd:false,rgpd_consent:true,consent:{reason:"Demande"}}}));
  }});
  await assert.rejects(sansChamp.confirmerRgpd(42),/non exposée/,"204 n'est pas une preuve du statut conformity");
  console.log("RGPD : état réel, complément absent, idempotence et relecture obligatoire OK");
})().catch(e=>{console.error(e);process.exitCode=1});
