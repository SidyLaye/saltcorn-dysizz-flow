/* Le traitement d'un lead découpé en étapes (un bloc de workflow par étape) donne exactement
   le même résultat que traiter() d'un coup, même quand le dossier passe par JSON entre deux
   étapes (c'est ce que fait le contexte d'un workflow Saltcorn). Données fictives. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const T = require("../src/lib/leads/traiter");
const { memoire } = require("../src/lib/leads/dossiers");
const M = require("../src/lib/leads/crm/memoire");
const { MAILS } = require("./fixtures-leads.cjs");

const CONF = {
  domaines_agence: ["agence-exemple.fr"], consentement: { actif: true },
  agences: [{ id: "405", nom: "Agence Exemple Cahors", boites: ["cahors@agence-exemple.fr"] }],
  routage: { personnes: [{ id: "500", nom: "Martin Durand", email: "martin@agence-exemple.fr", role: "negociateur", assistante_id: "501" }, { id: "501", nom: "Julie Aide", email: "julie@agence-exemple.fr", role: "assistante" }], siege: ["siege@agence-exemple.fr"] },
};
const json = (x) => JSON.parse(JSON.stringify(x));
/* la preuve .eml a un séparateur MIME tiré de l'heure : on compare tout le reste */
const sansDuree = (d) => { const o = json(d); delete o.duree_ms; for (const a of o.actions || []) for (const p of a.preuves || []) delete p.base64; return o; };

(async () => {
  const biens = [{ id: 99, reference: "30123", prix: 245000, surface: 120, pieces: 5, type: "maison", ville: "Cahors", code_postal: "46000", negociateur_id: "500", agence_id: "405" }];
  const noms = Object.keys(MAILS);
  assert.ok(noms.length >= 8, "jeu de mails d'essai");
  for (const nom of noms) {
    const mail = { ...MAILS[nom], date: "2026-09-25T07:00:00Z" };
    const a = await T.traiter(mail, M.creer({ biens }), CONF, { dossiers: memoire() });
    /* en étapes, avec un aller-retour JSON entre chaque (contexte du workflow) */
    const crm = M.creer({ biens }), repo = memoire();
    let d = json(await T.etapeLire(mail, CONF, { dossiers: repo }));
    d = json(await T.etapeBien(d, crm, CONF));
    d = json(await T.etapeContact(d, crm, CONF));
    d = json(T.etapeConsentement(d, mail, CONF));
    d = json(T.etapeDestinataires(d, CONF));
    assert.deepStrictEqual(sansDuree(T.nettoyer(d)), sansDuree(a), `mail « ${nom} » : même résultat en étapes`);
  }
  /* une fois la lecture décisive (non-lead), les étapes suivantes ne changent rien */
  const spam = json(await T.etapeLire({ ...MAILS.spam }, CONF, {}));
  assert.strictEqual(spam.fin, true);
  assert.deepStrictEqual(await T.etapeBien(json(spam), M.creer({ biens }), CONF), spam);
  /* 19/10 : un scanner de sécurité a rempli 270 fois le formulaire du site (nom « pHqghUme », adresse @example.com) ;
     chaque envoi partait en lead vers le siège et les négociateurs. Un formulaire rempli par un robot n'est jamais transmis. */
  const robot = (remplacer) => ({ ...MAILS.leboncoin, texte: remplacer(MAILS.leboncoin.texte), date: "2026-09-25T07:00:00Z" });
  for (const [quoi, m] of [["signature du scanner", robot((t) => t.replace("Paul Lefèvre", "pHqghUme"))], ["adresse réservée aux essais", robot((t) => t.replace("paul.test@example.org", "testing@example.com"))],
    ["domaine .tst du scanner", robot((t) => t.replace("paul.test@example.org", "sample@email.tst"))]]) {
    const r = await T.traiter(m, M.creer({ biens }), CONF, { dossiers: memoire() });
    assert.deepStrictEqual([r.statut, r.extraction.nature], ["ignore", "robot"], quoi + " : non transmis");
    assert.ok(r.alertes.some((a) => /robot/.test(a)) && !r.actions.length, quoi + " : signalé, aucune écriture");
  }
  assert.notStrictEqual((await T.traiter({ ...MAILS.leboncoin, date: "2026-09-25T07:00:00Z" }, M.creer({ biens }), CONF, { dossiers: memoire() })).extraction.nature, "robot", "un vrai lead reste un lead");
  /* le consentement porte la preuve (.eml) et le motif réglé */
  const lbc = { ...MAILS.leboncoin, date: "2026-09-25T07:00:00Z" };
  let d = await T.etapeLire(lbc, CONF, {}); d = await T.etapeBien(d, M.creer({ biens }), CONF); d = await T.etapeContact(d, M.creer({ biens }), CONF); d = T.etapeConsentement(d, lbc, CONF);
  const c = d.actions.find((x) => x.op === "ajouterConsentement");
  assert.ok(c && /^Demande de contact via .+ du 25\/09\/2026$/.test(c.motif), "motif du consentement");
  assert.strictEqual(c.preuves[0].type, "message/rfc822");
  console.log(`étapes OK : ${noms.length} mails, même résultat qu'en un seul bloc (aller-retour JSON compris)`);
})().catch((e) => { console.error(e); process.exit(1); });
