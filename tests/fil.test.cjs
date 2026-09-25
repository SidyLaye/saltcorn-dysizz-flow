/* Dossiers et conversation : un prospect écrit, relance, l'équipe répond, le prospect répond.
   Un seul dossier, un seul contact, un seul projet de recherche, un commentaire reconstruit.
   Puis l'adaptateur Immofacile en mode réel contre un faux serveur (projet, commentaire, action,
   relecture avec include, catalogue par curseur). Données fictives. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { traiter, executer, criteresProjet } = require("../src/lib/leads/traiter");
const C = require("../src/lib/leads/conversation");
const { memoire } = require("../src/lib/leads/dossiers");
const M = require("../src/lib/leads/crm/memoire");

const CONF = { domaines_agence: ["agence-exemple.fr"], routage: { personnes: [{ id: "500", nom: "Martin Durand", email: "martin@agence-exemple.fr", role: "negociateur" }], siege: ["siege@agence-exemple.fr"] }, consentement: { actif: true } };
const LBC = (n, date, corps) => ({ expediteur: '"Paul via leboncoin" <abc123xyz@messagerie.leboncoin.fr>', destinataire: "cahors@agence-exemple.fr", objet: 'Nouveau message pour "Maison 5 pièces 120 m²" sur leboncoin', message_id: `<lbc-${n}@t>`, date, texte: corps });

(async () => {
  /* dates : format des portails ramené en UTC (heure de Paris) */
  assert.strictEqual(C.lireDate("16 août. 2026 11:15:33"), "2026-08-16T09:15:33.000Z");
  assert.strictEqual(C.lireDate("On Tuesday, 09/01/26 at 18:39"), "2026-09-01T16:39:00.000Z");
  assert.strictEqual(C.lireDate("rien"), null);
  assert.strictEqual(C.sansSignature("Bonjour,\nOui c'est possible.\nCordialement\nMartin\n06 11 22 33 44\nwww.agence.fr"), "Bonjour,\nOui c'est possible.\nCordialement\nMartin");

  const crm = M.creer({ biens: [{ id: 99, reference: "30123", prix: 250000, surface: 120, pieces: 5, type: "maison", ville: "Cahors", code_postal: "46000", negociateur_id: "500" }] });
  const repo = memoire();
  const passe = async (mail) => { const d = await traiter(mail, crm, CONF, { dossiers: repo }); const ex = await executer(d, crm, { mode: "reel" }); if (d.dossier) await repo.enregistrer(d, ex, new Date(mail.date)); return d; };

  const d1 = await passe(LBC(1, "2026-09-25T07:00:00Z", "Bonjour Martin Durand - Agence Exemple,\nVous avez un nouveau message.\nE-mail : paul.test@example.org\nPaul Lefevre\n« Bonjour, est-il possible de visiter samedi ? »\nRépondre dans la messagerie\nMaison 5 pièces 120 m²\n250000 €\nRéférence : 30123"));
  assert.strictEqual(d1.statut, "pret"); assert.strictEqual(d1.dossier.existant, false);
  assert.deepStrictEqual(d1.actions.map((a) => a.op), ["creerContact", "lierBien", "creerRecherche", "ajouterConsentement"]);
  const pr = d1.actions.find((a) => a.op === "creerRecherche").donnees;
  assert.deepStrictEqual([pr.source, pr.budget_max, pr.surface_min, pr.pieces_min, pr.localisation], ["bien", 275000, 96, 4, "46000 Cahors"], "projet de recherche tiré du bien demandé, avec les marges");

  const d2 = await passe(LBC(2, "2026-09-25T09:00:00Z", "Bonjour Martin Durand - Agence Exemple,\nVous avez un nouveau message.\nPaul Lefevre\n« Parfait, 10h me convient. »\nRépondre dans la messagerie\nMessages précédents\nMartin Durand - Agence Exemple\n25 sept. 2026 10:15:00\nBonjour, oui samedi 10h est possible.\nPaul Lefevre\n25 sept. 2026 09:00:00\nBonjour, est-il possible de visiter samedi ?\nMaison 5 pièces 120 m²\n250000 €\nRéférence : 30123"));
  assert.strictEqual(d2.dossier.existant, true, "même relais Leboncoin → même dossier");
  assert.deepStrictEqual(d2.actions.map((a) => a.op), ["majRecherche"], "ni nouveau contact, ni nouveau suivi, ni nouveau consentement : le commentaire du projet est mis à jour");
  assert.deepStrictEqual(d2.destinataires.liste.map((x) => x.email), ["martin@agence-exemple.fr"], "une relance ne va qu'au négociateur (réglage par défaut)");

  const d3 = await passe({ expediteur: '"Martin Durand" <martin@agence-exemple.fr>', destinataire: "info@agence-exemple.fr", objet: 'Re: Nouveau message pour "Maison 5 pièces 120 m²" sur leboncoin', date: "2026-09-25T10:00:00Z",
    texte: "Je confirme samedi 10h.\nMartin\n\nLe 25 sept. 2026 à 09:00, info@agence-exemple.fr a écrit :\n> E-mail : paul.test@example.org\n> Référence : 30123" });
  assert.strictEqual(d3.extraction.nature, "reponse_equipe"); assert.strictEqual(d3.statut, "suivi");
  assert.ok(!d3.destinataires, "une réponse de l'équipe n'est jamais notifiée");
  assert.deepStrictEqual(d3.actions.map((a) => a.op), ["majRecherche"]);

  const d4 = await passe({ expediteur: '"Paul Lefevre" <paul.test@example.org>', destinataire: "martin@agence-exemple.fr", objet: "Re: visite samedi", date: "2026-09-25T12:00:00Z", texte: "Merci, pouvez-vous m'envoyer le diagnostic avant samedi ?\nPaul" });
  assert.strictEqual(d4.extraction.nature, "relance", "réponse d'un prospect connu, sans référence : relance du dossier");
  assert.strictEqual(d4.bien && d4.bien.id, 99, "le bien vient du dossier");

  assert.strictEqual(repo.liste.length, 1, "un seul dossier pour toute la conversation");
  const dos = repo.liste[0];
  assert.strictEqual(dos.nb_mails, 4); assert.ok(dos.reponse_le, "délai de réponse connu");
  assert.strictEqual(crm.ecritures.filter((e) => e.op === "creerContact").length, 1);
  assert.strictEqual(crm.ecritures.filter((e) => e.op === "creerRecherche").length, 1);
  assert.strictEqual(crm.ecritures.filter((e) => e.op === "ajouterConsentement").length, 1);
  const dernier = crm.ecritures.filter((e) => e.op === "majRecherche").pop().r.comment;
  assert.ok(/5 message\(s\)/.test(dernier), dernier);
  assert.ok(dernier.indexOf("est-il possible de visiter") < dernier.indexOf("oui samedi 10h") && dernier.indexOf("oui samedi 10h") < dernier.indexOf("diagnostic"), "ordre chronologique");
  assert.strictEqual((dernier.match(/est-il possible de visiter/g) || []).length, 1, "message recopié dans l'historique : pas de doublon");

  /* rejouer les mêmes mails ne change rien */
  const avant = JSON.stringify(repo.liste[0].messages.map((m) => m.empreinte));
  await passe(LBC(2, "2026-09-25T09:00:00Z", "Bonjour Martin Durand - Agence Exemple,\nVous avez un nouveau message.\nPaul Lefevre\n« Parfait, 10h me convient. »\nRéférence : 30123"));
  assert.strictEqual(JSON.stringify(repo.liste[0].messages.map((m) => m.empreinte)), avant);

  /* un autre bien du même prospect = un autre dossier */
  crm.ecritures.length = 0;
  const crm2 = M.creer({ biens: [{ id: 99, reference: "30123", prix: 250000 }, { id: 77, reference: "40555", prix: 150000, negociateur_id: "500" }], contacts: [{ id: repo.liste[0].contact_id, email: "paul.test@example.org", cree_le: "2026-01-01" }] });
  const d5 = await traiter({ ...LBC(5, "2026-09-26T07:00:00Z", "Vous avez un nouveau message.\nE-mail : paul.test@example.org\nPaul Lefevre\n« Et celui-ci ? »\nRéférence : 40555"), expediteur: "<zz9@messagerie.leboncoin.fr>" }, crm2, CONF, { dossiers: repo });
  assert.strictEqual(d5.dossier.existant, false); assert.strictEqual(d5.bien.id, 77);
  assert.ok(!d5.actions.some((a) => a.op === "ajouterConsentement"), "consentement déjà posé pour ce contact");

  /* étapes coupées par le client */
  const d6 = await traiter(LBC(9, "2026-09-27T07:00:00Z", "Vous avez un nouveau message.\nE-mail : new@example.org\nNew\n« ? »\nRéférence : 30123"), crm, { ...CONF, etapes: { projet: false, consentement: false, notification: false } }, {});
  assert.deepStrictEqual(d6.actions.map((a) => a.op), ["creerContact", "lierBien"]); assert.ok(!d6.destinataires);

  assert.strictEqual(criteresProjet({ recherche: { type: "maison", budget_max: 300000, localisation: "Lot" } }, null).source, "portail");

  /* ---- Immofacile en réel contre un faux serveur ---- */
  const vus = []; let sr = null;
  const fake = async (url, o = {}) => {
    const m = o.method || "GET"; vus.push(`${m} ${url.replace(/^https:\/\/[^/]+/, "")}`);
    const J = (x, s = 200) => ({ ok: s < 400, status: s, headers: new Map(), text: async () => (x === null ? "" : JSON.stringify(x)) });
    if (/client\/token\/site/.test(url)) return J({ access_token: "T", expires_in: 3600 });
    if (/criterias\/search-requests/.test(url)) return J({ data: [{ id: 26, xml: "TypeTransaction" }, { id: 30, xml: "CPVille" }, { id: 39, xml: "Prix" }, { id: 28, xml: "Surface" }, { id: 27, xml: "NbPieces" }] });
    if (/criterias\/product\/all/.test(url)) return J({ data: [{ id: 27, xml: "TypeBien" }] });
    if (/criterias\/product\/27\/values/.test(url)) return J({ data: [{ id: 2, model: "2", label: "Maison" }] });
    if (m === "POST" && /\/customers\/5\/search-requests$/.test(url)) { sr = JSON.parse(o.body); return J({ data: { id: 42 } }, 201); }
    if (m === "PATCH" && /\/customers\/5\/search-requests\/42$/.test(url)) { sr.comment = JSON.parse(o.body).comment; return J(null, 204); }
    if (m === "POST" && /\/customers\/5\/actions$/.test(url)) { const b = JSON.parse(o.body); assert.strictEqual(b.action_id, 15); assert.strictEqual(b.user_id, 500); return J({ data: { id: 7 } }, 201); }
    if (m === "PATCH" && /\/customers\/5$/.test(url)) return J(null, 204);
    if (m === "GET" && /\/customers\/5\?include=origin,groups/.test(url)) return J({ data: { id: 5, firstname: "Paul", mobilePhone: "+33611111111", origin: { id: 12 }, groups: [{ id: 1 }], user: { id: 500 }, agency: { id: 405 }, consent: { reason: "x" } } });
    if (m === "POST" && /products\/search\?fetch=/.test(url)) { const b = JSON.parse(o.body); return b.cursor ? J({ data: [{ id: 3, model: "C" }], next_cursor: null, has_more: false }) : J({ data: [{ id: 1, model: "A" }, { id: 2, model: "B" }], next_cursor: "Mg==", has_more: true }); }
    return J({ error: { code: "NOT_FOUND" } }, 404);
  };
  const imf = require("../src/lib/leads/crm/immofacile").creer({ site_id: "1", fetch: fake, secret: async () => "QUJD", action_lead: 15 });
  const r1 = await imf.creerRecherche(5, { transaction: "vente", type: "maison", localisation: "46000 Cahors", budget_max: 275000, surface_min: 96, pieces_min: 4, libelle: "Leboncoin", comment: "Conversation — 1 message(s)" });
  assert.strictEqual(r1.id, 42);
  assert.deepStrictEqual(sr.criteria.map((c) => [c.id, c.operator, c.value]), [["TypeTransaction", "EGAL", "Vente"], ["TypeBien", "EGAL", "2"], ["CPVille", "CONTIENT", "46000 Cahors"], ["Prix", "INFERIEUR", "275000"], ["Surface", "SUPERIEUR", "96"], ["NbPieces", "SUPERIEUR", "4"]]);
  await imf.majRecherche(5, 42, { comment: "Conversation — 2 message(s)" });
  assert.strictEqual(sr.comment, "Conversation — 2 message(s)");
  assert.strictEqual((await imf.ajouterAction(5, { texte: "message", negociateur: "500" })).id, 7);
  const c = await imf.contact(5);
  assert.strictEqual(c.origine, 12); assert.deepStrictEqual(c.groupes, [1]); assert.strictEqual(c.consentement, true); assert.strictEqual(c.negociateur, 500);
  const pat = await imf.majContact(5, { telephone: "+33511111111", negociateur: "500" });
  assert.deepStrictEqual(pat.non_pris, ["phone"], "relecture avec include : seul le téléphone non retrouvé est signalé");
  const lots = []; for await (const l of imf.catalogue({})) lots.push(l.map((b) => b.id));
  assert.deepStrictEqual(lots, [[1, 2], [3]], "catalogue lu page par page (curseur)");

  console.log("fil + immofacile réel : ok");
})().catch((e) => { console.error(e); process.exit(1); });
