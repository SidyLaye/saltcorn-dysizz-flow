/* Corrections venues de l'audit des mails réels (données fictives ici) : téléphone de l'équipe ou de l'agence
   jamais pris pour celui du prospect, e-mail collé au mot suivant, mots de service jamais pris pour un nom,
   texte brut resté en gabarit, CessionPME, et rien d'écrit dans le CRM pour un lead non automatisé. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const V = require("../src/lib/leads/valeurs");
const { extraire, telephoneDuProspect, nettoyerNoms } = require("../src/lib/leads/extraire");
const { executer } = require("../src/lib/leads/traiter");
const { texteMail } = require("../src/lib/leads/texte");
const { CONF } = require("./fixtures-leads.cjs");
const conf = { ...CONF, agences: [{ id: "1", nom: "AGENCE EXEMPLE CAHORS" }], routage: { personnes: [{ id: "500", nom: "Martin Durand", telephone: "06 11 22 33 44" }] } };

(async () => {
  assert.strictEqual(V.email("jean.test@gmail.comdans"), "jean.test@gmail.com", "extension collée au mot suivant");
  assert.strictEqual(V.email("jean@exemple.fr"), "jean@exemple.fr");
  const ok = (t, n) => telephoneDuProspect(t, conf)(V.telephone(n));
  assert.strictEqual(ok("Cordialement,\nMartin Durand\nTel : 06 11 22 33 44", "0611223344"), false, "téléphone de l'équipe");
  assert.strictEqual(ok("Merci\nAGENCE EXEMPLE CAHORS\n☎\n05 65 00 00 01", "0565000001"), false, "numéro de l'agence juste après son nom");
  assert.strictEqual(ok("Pour l'Agence : AGENCE EXEMPLE CAHORS  Client : Jeanne Martin - 0677889900", "0677889900"), true, "le client après le nom de l'agence reste le prospect");
  assert.strictEqual(ok("VAT Number GB 843 8810 09", "843881009"), false, "numéro de TVA");
  assert.strictEqual(ok("Téléphone : +33600000000", "+33600000000"), false, "numéro bidon");
  assert.strictEqual(ok("Téléphone : 01 40 00 00 12\nSuperimmo.com ®", "0140000012"), false, "standard du portail en bas de page");
  assert.strictEqual(ok("Vous pouvez le rappeler à ce numéro : 06 47 61 77 71 Bien’ici vous remercie", "0647617771"), true);
  const c = { prenom: "secrétariat", nom: "comptabilité" }; nettoyerNoms(c); assert.ok(!c.prenom && !c.nom, "mots de service");
  /* texte brut resté en gabarit : la version HTML est lue */
  const t = texteMail({ texte: "Nom: #Naamaanvrager\nTéléphone: #Telefoonnummeraanvrager\n" + "x".repeat(90), html: "<p>Nom: Jan Peters</p><p>Téléphone: +32471000000</p>" });
  assert.match(t, /Jan Peters/);
  /* CessionPME : une prise de contact sur une annonce est un lead */
  const cp = extraire({ expediteur: "<pacontact@cessionpme.com>", objet: "CessionPME - Prise de contact sur l'annonce référence CessionPME 12008358885_60396600",
    texte: "Bonjour,\nNous avons communiqué vos coordonnées à Monsieur ou Madame Jean Exemple\n(Email : jean.exemple@example.org - N° téléphone : +33677000000)\nPrix de vente 123 000 €\n" + "x".repeat(40) }, conf);
  assert.strictEqual(cp.nature, "lead"); assert.strictEqual(cp.contact.email, "jean.exemple@example.org"); assert.strictEqual(cp.bien.reference, "12008358885_60396600");
  /* lead non automatisé : rien n'est écrit dans le CRM, même en mode réel */
  const ecrit = [];
  const crm = { creerContact: async (x) => { ecrit.push(x); return { id: 1 }; } };
  const r = await executer({ statut: "a_verifier", actions: [{ op: "creerContact", donnees: { email: "a@b.fr" } }] }, crm, { mode: "reel" });
  assert.strictEqual(ecrit.length, 0); assert.ok(r.non_automatise);
  await executer({ statut: "pret", actions: [{ op: "creerContact", donnees: { email: "a@b.fr" } }] }, crm, { mode: "reel" });
  assert.strictEqual(ecrit.length, 1, "lead complet : écrit");
  await executer({ statut: "a_verifier", actions: [{ op: "creerContact", donnees: { email: "a@b.fr" } }] }, crm, { mode: "reel", ecrireAVerifier: true });
  assert.strictEqual(ecrit.length, 2, "réglage : écrire aussi les leads à vérifier");
  /* Téléphone seul : l'absence d'e-mail ne bloque plus la création CRM. */
  const { traiter } = require("../src/lib/leads/traiter"); const M = require("../src/lib/leads/crm/memoire");
  const d = await traiter({ expediteur: "<pacontact@bellespierres.com>", objet: "Vous avez une demande d'appel", texte: "Vous avez une demande d'appel\nNom : Pion\nPrénom : Jean\nTéléphone : +33600112244\nRéférence de l'annonce :\n30123\n" + "x".repeat(60) }, M.creer({ biens: [{ id: 99, reference: "30123", negociateur_id: "500" }] }), conf);
  assert.ok(!d.motifs.some((m) => /sans e-mail/.test(m)), d.motifs.join(" | "));
  assert.ok(d.actions.some(a=>a.op==="creerContact" && a.donnees.telephone && !a.donnees.email));
  /* casse des noms et pseudos */
  const n1 = { prenom: "NICOLAS", nom: "fontaine" }; nettoyerNoms(n1); assert.deepStrictEqual([n1.prenom, n1.nom], ["Nicolas", "Fontaine"]);
  const n2 = { prenom: "Sebastien", nom: "Sebastien" }; nettoyerNoms(n2); assert.ok(n2.prenom && !n2.nom, "un seul mot : prénom");
  const n3 = { nom: "Marc81200" }; nettoyerNoms(n3); assert.ok(!n3.nom, "pseudo avec chiffres : pas un nom");
  const n4 = { prenom: "Jean-pierre", nom: "de La Tour" }; nettoyerNoms(n4); assert.deepStrictEqual([n4.prenom, n4.nom], ["Jean-pierre", "de La Tour"], "casse mêlée gardée");
  console.log("corrections de l'audit OK : téléphones de l'équipe, e-mail collé, noms de service, texte à trous, CessionPME, CRM non écrit pour un lead non automatisé");
})().catch((e) => { console.error(e); process.exit(1); });
