"use strict";
const NOMS=["leads","lead","biens","bien","agences","agence","negociateurs","negociateur","stats","executions","execution","envois","reception","etat"];
const modifier = layout => {
  const out=JSON.parse(JSON.stringify(layout)); let blocs=0;
  const walk=x=>{
    if(!x || typeof x!=="object") return;
    if(x.view==="dz_ecran" && x.configuration?.widget==="tableau" && x.configuration.source &&
       !["filtres","note","onglets"].includes(x.configuration.vue)) {
      if(String(x.configuration.rafraichir)!=="15") { x.configuration.rafraichir="15";blocs++; }
    }
    for(const v of Object.values(x)) if(v && typeof v==="object") walk(v);
  };
  walk(out);return {layout:out,blocs};
};
const installer=async()=>{
  const Page=require("@saltcorn/data/models/page"), cache=(await require("../../../store").ensureTables()).cache;
  const rapport={pages:[],blocs:0,emails_envoyes:0};
  for(const name of NOMS) {
    const page=await Page.findOne({name}); if(!page) continue;
    const next=modifier(page.layout); if(!next.blocs) continue;
    const cle=`pages-actualisation-v1:${name}`;
    if(!await cache.getRow({cle})) await cache.insertRow({cle,valeur:JSON.stringify(page.layout),expire:new Date(Date.now()+90*86400000)});
    await Page.update(page.id,{layout:next.layout});
    rapport.pages.push(name);rapport.blocs+=next.blocs;
  }
  await require("../../rafraichir").rafraichir(["pages"]);
  return rapport;
};
module.exports={modifier,installer};
