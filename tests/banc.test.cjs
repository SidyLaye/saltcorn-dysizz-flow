/* Banc d'essai des leads : compare le moteur avec les résultats d'un ancien système, sans donnée personnelle
   dans le rapport. Mails fictifs. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { banc, squelette, ecart } = require("../src/lib/leads/banc");
const { MAILS } = require("./fixtures-leads.cjs");

(async () => {
  /* squelette : le gabarit reste, les personnes disparaissent */
  const df = new Map([["bonjour", 9], ["email", 9], ["telephone", 9], ["message", 9]]);
  const s = squelette("Bonjour Jean Dupont\nEmail : jean.dupont@example.org\nTéléphone : 06 12 34 56 78\nMessage : je souhaite visiter la maison réf 30123", df, 3);
  assert(!/jean|dupont|example|12 34|visiter/i.test(s), "rien de personnel : " + s);
  assert(/Bonjour/.test(s) && /Email : \[email\]$/m.test(s) && /\[tel\]/.test(s) && /9/.test(s), "gabarit gardé : " + s);
  /* un nom qui revient dans beaucoup de mails (même prospect) reste masqué : toute valeur après « Libellé : » l'est */
  const dfN = new Map([["nom", 50], ["theo", 50], ["gloudemans", 50], ["email", 50]]);
  const s2 = squelette("Nom: Theo Gloudemans\nEmail : theo@example.org\nRéf : TXNV-T123", dfN, 5);
  assert(!/theo|gloudemans/i.test(s2) && /Nom : …/.test(s2) && /AAAA-A999/.test(s2), "valeur après libellé masquée, forme de référence gardée : " + s2);
  assert.strictEqual(require("../src/lib/leads/banc").identite(["martin", "paul"], ["martin", "paul"]), "accord");
  assert.strictEqual(require("../src/lib/leads/banc").identite(["martin", "paul"], ["martin"]), "l'un contient l'autre");
  assert.strictEqual(ecart("reference", "SEHA123", "SEHA12"), "l'une contient l'autre");
  assert.strictEqual(ecart("email", "a@x.fr", ""), "absent chez nous");

  /* comparaison avec un « ancien système » : accords, écarts typés, décisions, squelettes */
  const liste = Object.entries(MAILS).filter(([, m]) => m && m.expediteur).slice(0, 12).map(([k, m], i) => ({ id: i + 1, ...m, date: "2026-09-10T10:00:00Z", _k: k }));
  const anciens = new Map();
  anciens.set(1, { source: "leboncoin", statut: "publie", champs: { email: "paul.test@example.org", tel: "", nom: "Lefèvre", prenom: "Paul" } });
  anciens.set(2, { source: "SeLoger", statut: "rejete", champs: { email: "autre@example.org" } });
  const R = await banc({ mails: liste, anciens, conf: { domaines_agence: ["agence-exemple.fr"] } });
  assert.strictEqual(R.mails, liste.length); assert.strictEqual(R.erreurs, 0);
  assert(R.portails.leboncoin && R.portails.leboncoin.champs.email.accord === 1, "e-mail Leboncoin identique à l'ancien");
  assert(Object.keys(R.decisions).length, "décisions comptées");
  assert(R.cas.some((c) => c.mail === 2 && c.champ === "email" && /adresse différente/.test(c.ecart)), "écart typé sans valeur");
  assert(R.exemples.length && R.exemples.every((e) => e.squelette !== undefined), "exemples par portail");
  const json = JSON.stringify(R);
  for (const x of ["paul.test@example.org", "autre@example.org", "Lefèvre"]) assert(!json.includes(x), "rapport sans donnée personnelle : " + x);
  console.log(`banc OK : ${liste.length} mails, décisions ${JSON.stringify(R.decisions)}, ${R.cas.length} cas anonymisés`);
})().catch((e) => { console.error(e); process.exit(1); });
