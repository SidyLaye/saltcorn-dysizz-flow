"use strict";
const assert=require("node:assert/strict");
const {emailTelephone,emailIndisponible,resoudreContact,completer}=require("../src/lib/leads/contact");
const {creer}=require("../src/lib/leads/crm/immofacile");
const {etapeContact}=require("../src/lib/leads/traiter");
const {candidat}=require("../src/lib/leads/tables/sans_email");
const {modifier}=require("../src/lib/leads/tables/pages_actualisation");
(async()=>{
  const tel="+33612345678", placeholder=emailTelephone(tel,"site");
  assert.ok(emailIndisponible(placeholder));assert.equal(emailTelephone(tel,"site"),placeholder);
  assert.notEqual(emailTelephone("+33612345679","site"),placeholder);
  const calls=[];let created=null;
  const crm=creer({site_id:"sans-email-test",secret:async()=>"test",fetch:async(url,o)=>{
    calls.push(o.method+" "+url);
    if(url.includes("/client/token/site")) return new Response(JSON.stringify({access_token:"test"}));
    if(url.endsWith("/customers")) {created=JSON.parse(o.body);return new Response(JSON.stringify({data:{id:42}}),{status:201});}
    return new Response(JSON.stringify({data:{id:42,email:created.email,phone:created.phone,firstname:created.firstname,lastname:created.lastname,user:{id:20},agency:{id:40}}}));
  }});
  assert.equal((await crm.creerContact({telephone:tel,negociateur:20,agence:40})).id,42);
  assert.ok(emailIndisponible(created.email));assert.equal(created.phone,tel);assert.equal(created.check_duplicate,true);
  const before=calls.length;
  await assert.rejects(crm.creerContact({}),/Téléphone valide requis/);assert.equal(calls.length,before);
  let conflitPost=0, conflitEmail="client-reel@example.org", agent=10;
  const conflit=creer({site_id:"sans-email-conflit",secret:async()=>"test",fetch:async(url,o)=>{
    if(url.includes("/client/token/site")) return new Response(JSON.stringify({access_token:"test"}));
    if(url.endsWith("/customers")) {conflitPost++;return new Response("{}",{status:409});}
    if(url.endsWith("/customers/search")) return new Response(JSON.stringify({data:JSON.parse(o.body).phone?[{id:43,email:conflitEmail,phone:tel}]:[]}));
    if(o.method==="PATCH") {const patch=JSON.parse(o.body);assert.equal(patch.email,undefined);agent=patch.user_id||agent;return new Response(null,{status:204});}
    return new Response(JSON.stringify({data:{id:43,email:conflitEmail,phone:tel,user:{id:agent},agency:{id:40}}}));
  }});
  const retrouve=await conflit.creerContact({telephone:tel,negociateur:20,agence:40});
  assert.equal(retrouve.id,43);assert.equal(retrouve.deja,true);assert.equal(conflitPost,1);assert.equal(agent,20);
  assert.equal((await resoudreContact({},{})).action,"impossible");
  const existing={id:42,email:placeholder,telephone:tel};
  assert.equal((await resoudreContact({email:"real@example.org",telephone:tel},{contactsParEmail:async()=>[],contactsParTelephone:async()=>[existing]})).contact.id,42);
  assert.deepEqual(completer(existing,{email:"real@example.org"}),{email:"real@example.org"});
  assert.equal((await resoudreContact({email:"real@example.org",telephone:tel},{contactsParEmail:async()=>[],contactsParTelephone:async()=>[{...existing,email:"other@example.org"}]})).action,"creer");
  for(const contact of [{telephone:tel},{}]) {
    const d={extraction:{contact,portail:"kyero",bien:{}},bien:{id:99,negociateur_id:20,agence_id:40},interne:{},fil:{messages_dossier:[]},dossier:{},motifs:[],alertes:[],actions:[]};
    await etapeContact(d,{contactsParTelephone:async()=>[]},{});
    assert.equal(d.actions.some(x=>x.op==="creerContact"),!!contact.telephone);
    assert.ok(!d.motifs.some(x=>x.includes("ne crée pas de contact sans e-mail")));
  }
  assert.ok(candidat({contact_tel:tel,bien_crm:"99",nature:"lead",mode:"ancien"}));
  assert.ok(!candidat({bien_crm:"99",nature:"lead"}));
  assert.ok(!candidat({contact_tel:tel,bien_crm:"99",nature:"lead",mode:"ombre"}));
  const original={above:[{type:"view",view:"dz_ecran",configuration:{widget:"tableau",source:"bien-fiche",vue:"fiche"}},{view:"dz_ecran",configuration:{widget:"fiche",table:"conge"}}]};
  const updated=modifier(original);assert.equal(updated.blocs,1);assert.equal(updated.layout.above[0].configuration.rafraichir,"15");
  assert.equal(original.above[0].configuration.rafraichir,undefined);assert.equal(modifier(updated.layout).blocs,0);
  console.log("Sans e-mail : téléphone requis, identité stable, aucun faux e-mail dans l'extraction, remplacement ciblé ; pages idempotentes OK");
})().catch(e=>{console.error(e);process.exitCode=1;});
