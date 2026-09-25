/* Leads immobiliers + OVHcloud : sans Saltcorn ni réseau (fetch simulé).
   Les mails ci-dessous sont fictifs (mêmes mises en page que les vrais portails). */
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { extraire } = require("../src/lib/leads/extraire");
const V = require("../src/lib/leads/valeurs");
const { rapprocher, variantes, comparer } = require("../src/lib/leads/rapprochement");
const { resoudreContact, completer } = require("../src/lib/leads/contact");
const { destinataires, absentsSemaine } = require("../src/lib/leads/routage");
const { traiter, executer } = require("../src/lib/leads/traiter");
const M = require("../src/lib/leads/crm/memoire");
const { creerCrm } = require("../src/lib/leads/crm");
const { BLOCKS } = require("../src/blocks");
const B = (n) => BLOCKS.find((b) => b.name === n);

const CONF = {
  domaines_agence: ["agence-exemple.fr", "maison-exemple.com"],
  sites: [{ domaine: "agence-exemple.fr", noms: ["AGENCE EXEMPLE"], origine: "site_agence_exemple" }, { domaine: "maison-exemple.com", noms: ["MAISON EXEMPLE"], origine: "site_maison_exemple" }],
  id_crm_liens: ["immo-facile-(\\d{6,})"],
  objets_campagnes: ["Notre sélection de la semaine"],
};

const MAILS = {
  leboncoin: { expediteur: '"Paul via leboncoin" <abc123@messagerie.leboncoin.fr>', destinataire: "cahors@agence-exemple.fr", objet: 'Nouveau message pour "Maison 5 pièces 120 m²" sur leboncoin',
    texte: "Bonjour Martin Durand - Agence Exemple,\nVous avez un nouveau message.\nE-mail : paul.test@example.org\nPaul Lefèvre\n« Bonjour, est-il possible de visiter samedi ? »\nRépondre dans la messagerie\nMaison 5 pièces 120 m²\n245000 €\nRéférence : 30123\nLien : https://www.leboncoin.fr/ad/ventes_immobilieres/1\nL'équipe leboncoin\n" + "x".repeat(40) },
  seloger: { expediteur: "<noreply@lead.seloger.com>", objet: "Un acquéreur est intéressé par un de vos biens",
    texte: "Un acquéreur est intéressé par un de vos biens\nJeanne Martin s'intéresse à ce\n bien\n240 000 €\nCARDAILLAC\n,\n46100\nMaison\n• 5 pièces\n• 105 m²\nRef. de l'annonce :\n 28936\nJeanne Martin\nmailto:jeanne.m@example.org\njeanne.m@example.org\nDécouvrir\n son\n projet\nBonjour, votre bien m'intéresse ! Merci\nmailto:jeanne.m@example.org\nRépondre\ntel:+33611223344\n" },
  figaro: { expediteur: "<contact@immobilier.lefigaro.fr>", objet: "Figaro Immobilier vous adresse un contact - Annonce 2025-32831",
    texte: "Bonjour,\nUn internaute vous contacte pour votre annonce 2025-32831 visible sur [Figaro Immobilier](http://immobilier.lefigaro.fr) :\nmaison\n46600\n141m²\t\t6 Pièces\n199 000€ 1411.35€/m²\nVoici ses coordonnées :\nEmail :\nbrice.test@example.org\nNom :\nGouy\nTéléphone :\n[06 24 47 02 41](tel:06 24 47 02 41)\nSon message :\nBonjour, je suis intéressé par ce bien.\nConseil : La réactivité…\nTransaction :\nvente\nBudget max. :\n219 000\n" },
  french: { expediteur: "<enquiries@french-property.com>", objet: "French-Property.com Enquiry: Heather Walker (119)",
    texte: "Dear Agency,\n----- Enquiry - Ref: 119 -----\nName: Heather Walker\nEmail Address: heather@example.co.uk\nPhone Number: +44 7388 927457\nMessage:\nRequests:\n* More photos\n* Floorplan\nPurchase Timescale: 6-12 months\nProperty Details - Ref: 119\nLovely stone house\n€349,500\nLocation: Poitou-Charentes, Deux-Sèvres (79), Valdelaume\n####\n" },
  ac3: { expediteur: "<no-reply@ac3-groupe.com>", objet: "Demande auprès de AGENCE EXEMPLE", destinataire: "info@agence-exemple.fr",
    texte: "[logo AGENCE EXEMPLE]\nCréation de compte Client sur le site AGENCE EXEMPLE Nego : AGENCE EXEMPLE CAHORS Client : Durand - Célia Email: celia.d@example.org Téléphone : 0652723071\nMessage du client :\nBonjour, cette maison nous intéresse.\nBiens maison à sanilhac (reference : 2289)\n", html: '<a href="https://www.agence-exemple.fr/catalog/">x</a>' },
  green: { expediteur: "<noreply@email.green-acres.com>", objet: "Demande d’information - Maison - Achat - Carcassonne 202m² 599 000 €",
    texte: "Nouveau contact sur votre mandat\nManent Monique - 03/09/2026 à 11:37\nBonjour, est-elle toujours en vente\nMerci\nVos coordonnées ont été transmises.\nManent Monique\n☎\n07 83 73 80 82\n✉\nmonique-ddfd@email.green-acres.com\nAnalyse du profil\nVilla contemporaine\n599 000 €\nCarcassonne (11000)\n202 m² – 6 pièces – 4 chambres\nRéférence : 32129\n" },
  bienici: { expediteur: "<noreply@bienici.com>", objet: "Contact prospect-acquéreur pour votre annonce 32445 à GINALS",
    texte: "Un prospect-acquéreur est intéressé par votre annonce 32445\nSes coordonnéesfasquel jfTéléphone : 06 23 22 23 14\nE-mail : jf@example.fr\nRappel de l’annoncePhoto\nMaison 4 pièces 75 m²\n82330 GINALS\n143 000 €\nRÉFÉRENCE : 32445\n", html: '<a href="https://pro.bienici.com/annonce/immo-facile-60473997?x=1">v</a>' },
  auto: { expediteur: "Bob <bob@example.org>", objet: "Réponse automatique : Notre sélection de la semaine", texte: "Je suis absent jusqu'au 12." },
  spam: { expediteur: "<vendeur@example.org>", objet: "Nettoyage de vitres pour votre agence", texte: "Nous proposons nos services de nettoyage pour vos locaux." },
  transfert: { expediteur: '"info" <info@agence-exemple.fr>', objet: "TR: Nouveau message sur Properstar (#ABC)", texte: "De: \"Properstar\" <x1@reply.properstar.com>\nEnvoyé: lundi\nObjet: Nouveau message sur Properstar (#ABC)\n= Nouveau message de Anna Berg =\nBonjour, je voudrais visiter.\n== Annonce désirée ==\nAppartement 3 pièce(s) 72 m2\n Appartement · 3 Pièces · 2 Chambres · 72 m²\n EUR 118 000\nTéléphone\n+46701234567\nE-mail\nanna@example.se\nID de ton CRM: 61355003\nRéférence: 31000\nCode postal: 87000\nLocalité: Limoges\n" },
};

(async () => {
  /* ---- valeurs ---- */
  assert.strictEqual(V.telephone("06 24 47 02 41"), "+33624470241");
  assert.strictEqual(V.telephone("00 353 87 231 8049"), "+353872318049");
  assert.strictEqual(V.telephone("+44 (0)7388 927457"), "+447388927457");
  assert.strictEqual(V.prix("199 000€ 1411.35€/m²"), 199000);
  assert.strictEqual(V.prix("Reference 693 115,000 euros"), 115000);
  assert.strictEqual(V.prix("€379,000"), 379000);
  assert.strictEqual(V.surface("maison 46600 141m² 6 Pièces"), 141);
  assert.deepStrictEqual(V.decouperNom("TAURISSON Célia"), { nom: "TAURISSON", prenom: "Célia" });
  assert.deepStrictEqual(V.decouperNom("Heather Walker"), { prenom: "Heather", nom: "Walker" });
  assert.deepStrictEqual(V.decouperNom("Manent Monique"), { nom: "Manent", prenom: "Monique" });

  /* ---- extraction ---- */
  const lbc = extraire(MAILS.leboncoin, CONF);
  assert.strictEqual(lbc.portail, "leboncoin"); assert.strictEqual(lbc.nature, "lead");
  assert.strictEqual(lbc.contact.email, "paul.test@example.org"); assert.strictEqual(lbc.contact.prenom, "Paul");
  assert.strictEqual(lbc.bien.reference, "30123"); assert.strictEqual(lbc.bien.prix, 245000); assert.strictEqual(lbc.bien.pieces, 5); assert.strictEqual(lbc.bien.surface, 120);
  assert.strictEqual(lbc.message, "Bonjour, est-il possible de visiter samedi ?");
  assert.strictEqual(lbc.contact.email_relais, "abc123@messagerie.leboncoin.fr");

  const sl = extraire(MAILS.seloger, CONF);
  assert.strictEqual(sl.contact.nom_complet, "Jeanne Martin"); assert.strictEqual(sl.bien.reference, "28936"); assert.strictEqual(sl.bien.code_postal, "46100");
  assert.strictEqual(sl.contact.telephone, "+33611223344"); assert.strictEqual(sl.bien.prix, 240000);

  const fg = extraire(MAILS.figaro, CONF);
  assert.strictEqual(fg.bien.reference, "2025-32831"); assert.strictEqual(fg.bien.surface, 141); assert.strictEqual(fg.bien.prix, 199000);
  assert.strictEqual(fg.contact.telephone, "+33624470241"); assert.strictEqual(fg.recherche.budget_max, 219000);

  const fp = extraire(MAILS.french, CONF);
  assert.strictEqual(fp.bien.reference, "119"); assert.strictEqual(fp.bien.prix, 349500); assert.strictEqual(fp.bien.ville, "Valdelaume"); assert.strictEqual(fp.bien.departement, "79");
  assert.ok(/Floorplan/.test(fp.message));

  const ac = extraire(MAILS.ac3, CONF);
  assert.strictEqual(ac.portail, "site_agence"); assert.strictEqual(ac.site, "agence-exemple.fr"); assert.strictEqual(ac.site_origine, "site_agence_exemple");
  assert.deepStrictEqual([ac.contact.nom, ac.contact.prenom, ac.contact.email, ac.contact.telephone], ["Durand", "Célia", "celia.d@example.org", "+33652723071"]);
  assert.strictEqual(ac.bien.reference, "2289"); assert.strictEqual(ac.bien.ville, "sanilhac");

  const ga = extraire(MAILS.green, CONF);
  assert.strictEqual(ga.contact.nom, "Manent"); assert.strictEqual(ga.contact.email_relais, "monique-ddfd@email.green-acres.com"); assert.ok(!ga.contact.email);
  assert.strictEqual(ga.bien.reference, "32129"); assert.strictEqual(ga.bien.code_postal, "11000"); assert.strictEqual(ga.bien.pieces, 6);
  assert.ok(!ga.manquants.includes("email"), "le relais évite le manque d'e-mail");

  const bi = extraire(MAILS.bienici, CONF);
  assert.strictEqual(bi.bien.id_crm, "60473997"); assert.strictEqual(bi.contact.telephone, "+33623222314"); assert.strictEqual(bi.contact.email, "jf@example.fr");

  assert.strictEqual(extraire(MAILS.auto, CONF).nature, "auto_reponse");
  assert.strictEqual(extraire(MAILS.spam, CONF).nature, "inconnu");
  const tr = extraire(MAILS.transfert, CONF);
  assert.strictEqual(tr.portail, "properstar"); assert.strictEqual(tr.preuves.transfert, "deballe");
  assert.strictEqual(tr.contact.email, "anna@example.se"); assert.strictEqual(tr.bien.id_crm, "61355003"); assert.strictEqual(tr.bien.type, "appartement");

  /* ---- rapprochement ---- */
  assert.deepStrictEqual(variantes("985_985_60945370").map((v) => v.valeur), ["985_985_60945370", "985_985_6094537", "60945370", "985"]);
  const biens = [
    { id: 1, reference: "30123", prix: 245000, surface: 120, pieces: 5, type: "maison", ville: "Cahors", code_postal: "46000", negociateur_id: "n1", agence_id: "a1" },
    { id: 2, reference: "3012", prix: 90000, surface: 60, pieces: 3, type: "maison", ville: "Figeac", code_postal: "46100", negociateur_id: "n2" },
    { id: 3, reference: "60945370", prix: 530000, surface: 62, pieces: 3, type: "appartement", ville: "Cannes", code_postal: "06400", negociateur_id: "n2" },
  ];
  const crm = M.creer({ biens });
  let r = await rapprocher({ bien: { reference: "30123", prix: 245000, surface: 120 } }, crm);
  assert.strictEqual(r.bien.id, 1); assert.strictEqual(r.methode, "reference_complete");
  r = await rapprocher({ bien: { reference: "30124", prix: 90000, surface: 60 } }, crm);
  assert.strictEqual(r.bien.id, 2, "référence moins le dernier caractère");
  r = await rapprocher({ bien: { reference: "3012X", prix: 400000, surface: 200 } }, crm);
  assert.strictEqual(r.bien, null, "contradiction : rejet"); assert.ok(/contredit/.test(r.motif));
  r = await rapprocher({ bien: { reference: "985_985_60945370", prix: 530000, surface: 62, ville: "Cannes" } }, crm);
  assert.strictEqual(r.bien.id, 3); assert.strictEqual(r.methode, "segment_1");
  r = await rapprocher({ bien: { reference: "30123", prix: 199000, surface: 120, pieces: 5, code_postal: "46000" } }, crm);
  assert.strictEqual(r.bien.id, 1, "un seul écart toléré sur référence exacte"); assert.ok(r.alertes[0].startsWith("prix"));
  r = await rapprocher({ bien: { type: "maison", pieces: 3, surface: 60, prix: 90000 } }, crm);
  assert.strictEqual(r.bien.id, 2); assert.ok(r.methode.startsWith("criteres"));
  assert.deepStrictEqual(comparer({ code_postal: "46100" }, { code_postal: "11000" }).conflits, ["code_postal"]);

  /* ---- contact : priorité à l'e-mail, puis le plus récent ---- */
  const cc = M.creer({ contacts: [
    { id: 10, email: "a@x.fr", telephone: "+33600000001", cree_le: "2024-01-01" },
    { id: 11, email: "a@x.fr", cree_le: "2026-05-01" },
    { id: 12, email: "b@x.fr", telephone: "+33600000002", cree_le: "2026-06-01" },
  ] });
  let rc = await resoudreContact({ email: "a@x.fr", telephone: "+33600000002" }, cc);
  assert.strictEqual(rc.contact.id, 11); assert.ok(rc.trace.some((t) => /priorité à l'e-mail/.test(t)));
  rc = await resoudreContact({ telephone: "+33600000001" }, cc);
  assert.strictEqual(rc.contact.id, 10); assert.strictEqual(rc.par, "telephone");
  rc = await resoudreContact({ email: "new@x.fr", telephone: "+33600000002" }, cc);
  assert.strictEqual(rc.action, "creer");
  assert.deepStrictEqual(completer({ prenom: "Jo", nom: "", telephone: "+33511" }, { prenom: "Jean", nom: "Dupont", telephone: "+33612345678" }), { nom: "Dupont", mobile: "+33612345678" });

  /* ---- destinataires : règles, congés, mi-temps, chaîne, boucle, siège ---- */
  const R = {
    personnes: [
      { id: "n1", nom: "Nadia", email: "nadia@ex.fr", role: "negociateur", assistante_id: "s1", temps: "mi_temps", jours: [1, 2, 3], remplacant_hors_jours: { personne: "n2" } },
      { id: "n2", nom: "Omar", email: "omar@ex.fr", role: "negociateur", assistante_id: "s1" },
      { id: "n3", nom: "Lina", email: "lina@ex.fr", role: "negociateur" },
      { id: "s1", nom: "Sophie", email: "sophie@ex.fr", role: "assistante" },
      { id: "s2", nom: "Gemma", email: "gemma@ex.fr", role: "assistante" },
    ],
    regles: [{ id: "r1", cible: { negociateurs: ["n3"] }, couper_negociateur: true, assistante: "remplacer", assistante_remplacante: { personne: "s2" }, adresses_libres: ["coach@ex.fr"] }],
    absences: [{ personne_id: "n2", debut: "2026-09-21", fin: "2026-09-27", remplacant: { email: "relais@ex.fr" }, motif: "congés" }, { personne_id: "s1", debut: "2026-10-01", fin: "2026-10-02", remplacant: { personne: "s1" } }],
    siege: ["siege@ex.fr"],
  };
  const emails = (d) => d.liste.map((x) => x.email).sort();
  assert.deepStrictEqual(emails(destinataires("n1", new Date("2026-09-14T10:00:00Z"), R)), ["nadia@ex.fr", "siege@ex.fr", "sophie@ex.fr"]);
  const jeudi = destinataires("n1", new Date("2026-09-17T10:00:00Z"), R);
  assert.deepStrictEqual(emails(jeudi), ["omar@ex.fr", "siege@ex.fr", "sophie@ex.fr"], "mi-temps : Omar remplace Nadia le jeudi");
  const conge = destinataires("n1", new Date("2026-09-24T10:00:00Z"), R);
  assert.deepStrictEqual(emails(conge), ["relais@ex.fr", "siege@ex.fr", "sophie@ex.fr"], "chaîne : Nadia hors jours → Omar en congés → relais");
  assert.deepStrictEqual(emails(destinataires("n3", new Date("2026-09-14T10:00:00Z"), R)), ["coach@ex.fr", "gemma@ex.fr", "siege@ex.fr"]);
  const boucle = destinataires("n2", new Date("2026-10-01T10:00:00Z"), R);
  assert.ok(boucle.trace.some((t) => /boucle/.test(t))); assert.ok(emails(boucle).includes("siege@ex.fr"));
  assert.deepStrictEqual(emails(destinataires("inconnu", new Date(), R)), ["siege@ex.fr"]);
  const abs = absentsSemaine(R, new Date("2026-09-23T10:00:00Z"));
  assert.ok(abs.find((a) => a.personne === "Omar" && /congés → relais@ex.fr/.test(a.resume)));
  assert.ok(abs.find((a) => a.personne === "Nadia" && /hors jours/.test(a.resume)));

  /* ---- traitement complet en ombre : aucune écriture ---- */
  const conf = { ...CONF, agences: [{ id: "a1", nom: "Agence Exemple Cahors", boites: ["cahors@agence-exemple.fr"] }], origines: [{ id: 58893, code: "leboncoin", libelle: "Leboncoin" }], routage: R, consentement: { actif: true, libelle: "Demande de contact via {portail} du {date}" } };
  const d = await traiter({ ...MAILS.leboncoin, date: "2026-09-14T09:00:00Z" }, crm, conf);
  assert.strictEqual(d.statut, "pret", JSON.stringify(d.motifs));
  assert.strictEqual(d.bien.id, 1); assert.strictEqual(d.agence.id, "a1"); assert.strictEqual(d.origine.id, 58893);
  const cons = d.actions.find((a) => a.op === "ajouterConsentement");
  assert.strictEqual(cons.motif, "Demande de contact via Leboncoin du 14/09/2026");
  assert.ok(Buffer.from(cons.preuves[0].base64, "base64").toString().includes("Subject: Nouveau message pour"));
  const ex = await executer(d, crm, { mode: "ombre" });
  assert.ok(ex.resultats.every((x) => x.fait === false)); assert.strictEqual(crm.ecritures.length, 0);

  /* ---- Immofacile : jeton, recherche, garde lecture seule ---- */
  const appels = [];
  const fake = async (url, o = {}) => {
    appels.push(`${o.method || "GET"} ${url}`);
    const J = (x, s = 200) => ({ ok: s < 400, status: s, headers: new Map(), text: async () => JSON.stringify(x) });
    if (/client\/token\/site/.test(url)) { assert.ok(/^Basic /.test(o.headers.Authorization)); return J({ access_token: "T", expires_in: 3600 }); }
    if (/criterias\/product\/all/.test(url)) return J({ data: [{ id: 5, xml: "Surface" }, { id: 6, xml: "NbPiece" }, { id: 7, xml: "CodePostalWeb" }] });
    if (/products\/search/.test(url)) return J({ data: [{ id: 99, model: "30123" }, { id: 98, model: "301234" }] });
    if (/products\/99/.test(url)) return J({ data: { id: 99, model: "30123", price: 245000, criteres_number: [{ critere_id: 5, critere_value: "120" }, { critere_id: 6, critere_value: "5" }], criteres_text: [{ critere_id: 7, critere_value: "46000" }], assigned_to: { id: 866 }, agency_id: 405 } });
    if (/customers\/search/.test(url)) return J({ data: [{ id: 1, email: "a@x.fr", created_at: "2026-01-01" }], meta: {} });
    return J({ erreur: "?" }, 404);
  };
  const imf = creerCrm("immofacile", { site_id: "123", fetch: fake, secret: async (k) => (k === "basic" ? "QUJD" : null) }, { mode: "ombre" });
  const bs = await imf.biensParReference("30123");
  assert.deepStrictEqual(bs.map((b) => [b.id, b.surface, b.pieces, b.code_postal, b.negociateur_id]), [[99, 120, 5, "46000", 866]]);
  assert.strictEqual((await imf.contactsParEmail("A@x.fr"))[0].id, 1);
  await imf.creerContact({ email: "z@x.fr" });
  assert.ok(!appels.some((a) => /^POST .*\/customers$/.test(a)), "mode ombre : aucune création envoyée");
  const brut = require("../src/lib/leads/crm/immofacile").creer({ site_id: "1", fetch: fake, secret: async () => "QUJD", lectureSeule: true });
  await assert.rejects(() => brut.creerContact({ email: "z@x.fr" }), /écriture bloquée/);

  /* ---- blocs ---- */
  const api = { secret: async (n) => ({ OVH_CLES: "AK:AS:CK" })[n] };
  const lu = await B("dzf_lead_extraire").run({ mail: { ...MAILS.seloger, corps_texte: MAILS.seloger.texte }, configuration: CONF }, {}, api);
  assert.strictEqual(lu.bien.reference, "28936");
  const qui = await B("dzf_lead_destinataires").run({ negociateur: "n1", date: "2026-09-17T10:00:00Z", routage: R }, {}, api);
  assert.deepStrictEqual(emails(qui), ["omar@ex.fr", "siege@ex.fr", "sophie@ex.fr"]);

  /* ---- OVH : signature, sous-domaine idempotent, rafraîchissement ---- */
  const vu = [];
  const zone = { records: [{ id: 1, fieldType: "A", subDomain: "crm", target: "1.2.3.4", ttl: 0 }] };
  global.fetch = async (url, o = {}) => {
    const u = String(url), m = o.method || "GET";
    vu.push(`${m} ${u.replace("https://eu.api.ovh.com/1.0", "")}`);
    const J = (x) => ({ ok: true, status: 200, text: async () => (typeof x === "string" ? x : JSON.stringify(x)), json: async () => x });
    if (/auth\/time/.test(u)) return J(String(Math.floor(Date.now() / 1000)));
    if (/cloudflare-dns/.test(u)) return J({ Answer: [{ data: "5.6.7.8" }] });
    assert.ok(/^\$1\$[0-9a-f]{40}$/.test(o.headers["X-Ovh-Signature"]), "signature OVH");
    if (m === "GET" && /\/record\?fieldType=A&subDomain=crm/.test(u)) return J(zone.records.map((r) => r.id));
    if (m === "GET" && /\/record\/1$/.test(u)) return J(zone.records[0]);
    if (m === "PUT" && /\/record\/1$/.test(u)) { zone.records[0].target = JSON.parse(o.body).target; return J(null); }
    if (m === "POST" && /\/refresh$/.test(u)) return J(null);
    return J([]);
  };
  const sd = await B("dzf_ovh_sous_domaine").run({ cles: "OVH_CLES", region: "ovh-eu", zone: "exemple.fr", sous_domaine: "crm", vers: "une adresse IP", cible: "5.6.7.8", verifier: true }, {}, api);
  assert.strictEqual(sd.etapes[0].action, "mis à jour"); assert.strictEqual(zone.records[0].target, "5.6.7.8");
  assert.ok(vu.includes("POST /domain/zone/exemple.fr/refresh")); assert.deepStrictEqual(sd.reponse_publique, ["5.6.7.8"]);
  const encore = await B("dzf_ovh_dns").run({ cles: "OVH_CLES", region: "ovh-eu", zone: "exemple.fr", action: "créer ou mettre à jour", type: "A", sous_domaine: "crm", cible: "5.6.7.8", ttl: 0 }, {}, api);
  assert.strictEqual(encore.action, "inchangé");

  console.log("leads + ovh : ok");
})().catch((e) => { console.error(e); process.exit(1); });
