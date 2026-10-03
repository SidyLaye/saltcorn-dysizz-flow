"use strict";
const assert=require("node:assert/strict");
const {etapeContact}=require("../src/lib/leads/traiter");
(async()=>{
  for(const possede of [true,false]){
    const contact={id:42,email:"client@example.test",prenom:"Alice",nom:"Martin",recherches:possede?[{id:77}]:[]};
    const d={extraction:{contact:{email:contact.email},bien:{},portail:"leboncoin",recherche:{}},
      fil:{messages_dossier:[{role:"prospect",texte:"Bonjour",date:"2026-10-03"}]},
      bien:{id:99,reference:"REF",prix:100000,surface:50,ville:"Paris",code_postal:"75001"},
      interne:{dos:{contact_id:42,recherche_id:77,bien_id:99}},dossier:{contact_id:42,recherche_id:77},
      actions:[],alertes:[],motifs:[]};
    await etapeContact(d,{contactsParEmail:async()=>[contact],contact:async()=>contact},{});
    assert.equal(d.actions.some(a=>a.op==="majRecherche"),possede);
    assert.equal(d.actions.some(a=>a.op==="creerRecherche"),!possede);
    if(!possede)assert.equal(d.dossier.recherche_id,null);
  }
  console.log("Projets : identifiant périmé écarté, projet du contact conservé OK");
})().catch(e=>{console.error(e);process.exitCode=1});
