"use strict";
const assert = require("node:assert/strict");
const { creer } = require("../src/lib/leads/crm/immofacile");
const { executer } = require("../src/lib/leads/traiter");
(async () => {
  for (const conflit of [false, true]) for (const confirme of [false, true]) {
    let patched = false;
    const crm = creer({ site_id: `creation-${conflit}-${confirme}`, secret: async () => "test", fetch: async (url, o) => {
      const j = (data, status=200) => new Response(JSON.stringify(data), { status });
      if (url.includes("/client/token/site")) return j({access_token:"test"});
      if (url.endsWith("/customers") && o.method === "POST") {
        const b = JSON.parse(o.body); assert.equal(b.user_id,20); assert.equal(b.agency_id,40);
        return conflit ? j({},409) : j({data:{id:42}},201);
      }
      if (url.endsWith("/customers/search")) return j({data:[{id:42,email:"client@example.test"}]});
      if (o.method === "PATCH") { assert.deepEqual(JSON.parse(o.body),{agency_id:40,user_id:20});patched=true;return new Response(null,{status:204}); }
      return j({data:{id:42,email:"client@example.test",firstname:"Alice",lastname:"Martin",
        user:{id:confirme && (!conflit || patched)?20:10},agency:{id:confirme && (!conflit || patched)?40:30}}});
    }});
    const out = await crm.creerContact({email:"client@example.test",prenom:"Alice",nom:"Martin",negociateur:20,agence:40});
    assert.equal(out.id,42);
    assert.equal(out.affectation_confirmee===false,!confirme);
    assert.equal(patched,conflit,"le conflit 409 réaffecte aussi le contact existant");
    if (!confirme) {
      const ex = await executer({statut:"pret",contact:{id:null},actions:[{op:"creerContact",donnees:{}}]},
        {creerContact:async()=>out},{mode:"reel"});
      assert.equal(ex.contactId,42,"conserver la fiche réelle pour éviter une recréation");
      assert.equal(ex.resultats[0].fait,false);assert.match(ex.resultats[0].erreur,/non confirmée/);
    }
  }
  for(const present of [true,false]){
    const crm=creer({site_id:"liaison-"+present,secret:async()=>"test",fetch:async(url,o)=>{
      if(url.includes("/client/token/site"))return new Response(JSON.stringify({access_token:"test"}));
      if(o.method==="POST")return new Response(null,{status:204});
      return new Response(JSON.stringify({data:present?[{product_id:99}]:[]}));
    }});
    if(present)assert.equal((await crm.lierBien(42,99)).confirme,true);
    else await assert.rejects(crm.lierBien(42,99),/non confirmée/);
  }
  console.log("Création, conflit 409 et liaison bien : affectation relue, échec signalé, ID conservé OK");
})().catch(e=>{console.error(e);process.exitCode=1});
