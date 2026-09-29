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
  const dfN = new Map([["nom", 50], ["jan", 50], ["pieterse", 50], ["email", 50]]);
  const s2 = squelette("Nom: Jan Pieterse\nEmail : jan@example.org\nRéf : ABCD-T123", dfN, 5);
  assert(!/jan|pieterse/i.test(s2) && /Nom : …/.test(s2) && /AAAA-A999/.test(s2), "valeur après libellé masquée, forme de référence gardée : " + s2);
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

  /* IA sur un échantillon : seuls les mails que les règles ne savent pas lire, jamais plus que demandé ;
     ce qu'elle lit devient un gabarit (en mémoire) pour le mail suivant de la même forme */
  const A = require("../src/lib/leads/apprentissage");
  const perso = (i, nom, mail) => ({ id: 100 + i, expediteur: `${mail}`, destinataire: "contact@agence-exemple.fr", objet: "Demande d'information",
    texte: `Bonjour,\nJe suis intéressée par votre maison.\nNom : ${nom}\nEmail : ${mail}\nTéléphone : 06 11 22 33 4${i}\nCordialement`, date: "2026-09-10T10:00:00Z" });
  const lot = [perso(1, "Claire Martin", "claire.m@example.org"), perso(2, "Luc Bernard", "luc.b@example.org"), perso(3, "Anne Petit", "anne.p@example.org")];
  let appels = 0;
  const faux = { lire: async (m, t) => { appels++; const n = t.match(/Nom : (\S+) (\S+)/), e = t.match(/Email : (\S+)/), tel = t.match(/Téléphone : ([\d ]+)/);
    return { sortie: { nature: "lead", confiance_nature: 0.95, source: "particulier", prenom: n[1], nom: n[2], email: e[1], telephone: tel[1].trim(),
      motif_prenom: "Nom : (\\S+) \\S+", motif_nom: "Nom : \\S+ (\\S+)", motif_email: "Email : (\\S+)", motif_telephone: "Téléphone : ([\\d ]+)" }, rejets: [], ms: 1 }; } };
  const store = A.memoire([]);
  const R2 = await banc({ mails: lot, anciens: new Map(), conf: { domaines_agence: ["agence-exemple.fr"] }, opts: { ia: faux, gabarits: store }, iaEchantillon: 2 });
  assert(appels <= 2 && R2.ia.echantillon <= 2, "jamais plus d'appels que l'échantillon : " + appels);
  assert.strictEqual(R2.erreurs, 0);
  assert(R2.lecture && Object.keys(R2.lecture).length, "étages de lecture comptés : " + JSON.stringify(R2.lecture));
  const R3 = await banc({ mails: lot, anciens: new Map(), conf: { domaines_agence: ["agence-exemple.fr"] }, opts: { gabarits: A.memoire([]) } });
  assert(!R3.ia.appels && Object.values(R3.decisions).length, "sans IA : aucun appel");
  assert(!JSON.stringify(R2).match(/claire|luc\.b|anne\.p|Martin|Bernard|Petit/), "rapport IA sans donnée personnelle");
  console.log(`banc IA OK : ${appels} appels, lecture ${JSON.stringify(R2.lecture)}, gabarits appris ${JSON.stringify(R2.gabarits_appris_pendant_le_banc)}`);
  console.log(`banc OK : ${liste.length} mails, décisions ${JSON.stringify(R.decisions)}, ${R.cas.length} cas anonymisés`);
})().catch((e) => { console.error(e); process.exit(1); });
