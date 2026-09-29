/* Contrôle CRM ↔ mails : la fiche réelle comparée au mail et à ce que le moteur écrirait (lecture, recherche,
   écriture). CRM simulé, données fictives ; le rapport ne contient aucune donnée personnelle. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { controler } = require("../src/lib/leads/controle");
const M = require("../src/lib/leads/crm/memoire");
const { CONF, MAILS } = require("./fixtures-leads.cjs");

(async () => {
  const biens = [{ id: 501, reference: "30123", prix: 245000, pieces: 5, surface: 120, type: "maison", ville: "Cahors", code_postal: "46000", negociateur_id: 7, agence_id: 3 }];
  const bonne = { id: 900, email: "paul.test@example.org", emails: ["paul.test@example.org"], telephones: [], prenom: "Paul", nom: "Lefèvre", origine: 58893, groupes: [1], negociateur: 7, agence: 3, consentement: true, consentement_detail: { raison: "Demande de contact via Leboncoin le 10/09/2026", date: "2026-09-10T10:00:00Z", preuves: 1 } };
  const fausse = { id: 901, email: "autre@example.org", emails: ["autre@example.org"], telephones: [], prenom: "PAUL", nom: "Martin", origine: 26, groupes: [], negociateur: 8, agence: 3, consentement: false };
  const base = M.creer({ biens, contacts: [bonne, fausse] });
  const crm = { ...base, suivis: async (id) => (String(id) === "900" ? [{ bien: "501" }] : []) };
  const conf = { ...CONF, origines: [{ id: 58893, code: "leboncoin" }, { id: 26, code: "se_loger" }], origines_portail: { leboncoin: "leboncoin" }, consentement: { actif: true, libelle: "Demande de contact via {portail} le {date}" } };
  const mail = (id) => ({ id, ...MAILS.leboncoin, date: "2026-09-10T10:00:00Z" });
  const R = await controler({ lignes: [{ mail: mail(1), contact_id: 900, bien: 501 }, { mail: mail(2), contact_id: 901, bien: 501 }, { mail: mail(3), contact_id: 999, bien: 501 }], crm, crmMoteur: crm, biens, conf, groupeDemandeur: 1, origines: conf.origines });
  const C = R.controles;
  assert.strictEqual(R.lus_dans_le_crm, 2); assert.strictEqual(R.introuvables_dans_le_crm, 1);
  assert.strictEqual(C["e-mail"].accord, 1); assert.strictEqual(C["e-mail"]["même domaine, adresse différente"], 1, "e-mail de la fiche ≠ mail");
  assert.strictEqual(C["recherche du contact"]["le moteur choisit une autre fiche"], 1, "l'ancien a écrit dans une autre fiche que celle du prospect");
  assert.strictEqual(C["consentement"]["présent sur la fiche"], 1);
  assert.strictEqual(C["prénom et nom"].accord, 1); assert(C["prénom et nom"]["en partie"] || C["prénom et nom"]["différent"], "nom de la fiche ≠ mail");
  assert.strictEqual(C["groupe Demandeur"].accord, 1); assert.strictEqual(C["groupe Demandeur"]["absent de la fiche"], 1);
  assert.strictEqual(C["bien de l'ancien suivi sur la fiche"].accord, 1); assert.strictEqual(C["bien de l'ancien suivi sur la fiche"]["non suivi"], 1);
  assert.strictEqual(C["négociateur de la fiche = celui du bien"].accord, 1); assert.strictEqual(C["négociateur de la fiche = celui du bien"]["différent"], 1);
  assert.strictEqual(C["origine"].accord, 1); assert(Object.keys(C["origine"]).some((k) => /différente \(fiche se_loger \/ moteur leboncoin\)/.test(k)), JSON.stringify(C["origine"]));
  assert(C["recherche du contact"] && C["recherche du contact"].accord >= 1, "le moteur retrouve la fiche de l'ancien : " + JSON.stringify(C["recherche du contact"]));
  assert(Object.keys(C).some((k) => /^écriture/.test(k)), "écritures prévues contrôlées : " + Object.keys(C).join(", "));
  const json = JSON.stringify(R);
  for (const x of ["paul.test@example.org", "autre@example.org", "Lefèvre", "PAUL", "Martin Durand"]) assert(!json.includes(x), "rapport sans donnée personnelle : " + x);
  /* écriture : la fiche n'a pas le téléphone du mail → le moteur l'écrirait, au bon format */
  const jeanne = { id: 902, email: "jeanne.m@example.org", emails: ["jeanne.m@example.org"], telephones: [], prenom: "Jeanne", nom: "Martin", origine: 26, groupes: [1], consentement: false };
  const crm2 = { ...M.creer({ biens, contacts: [jeanne] }), suivis: async () => [] };
  const R2 = await controler({ lignes: [{ mail: { id: 4, ...MAILS.seloger, date: "2026-09-10T10:00:00Z" }, contact_id: 902 }], crm: crm2, crmMoteur: crm2, biens, conf: { ...conf, origines_portail: { seloger: "se_loger" } }, groupeDemandeur: 1, origines: conf.origines });
  assert.strictEqual((R2.controles["écriture : telephone"] || {})["le moteur l'écrirait, absent de la fiche"], 1, JSON.stringify(R2.controles));
  assert(!R2.controles["écriture : format"], "valeurs écrites au bon format : " + JSON.stringify(R2.controles["écriture : format"]));
  assert.strictEqual((R2.controles["téléphone"] || {})["dans le mail, absent de la fiche"], 1);
  console.log(`contrôle CRM OK : ${Object.keys(C).length} contrôles (lecture, recherche, écriture), ${R.cas.length} cas anonymisés`);
})().catch((e) => { console.error(e); process.exit(1); });
