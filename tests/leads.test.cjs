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

const { CONF, MAILS } = require("./fixtures-leads.cjs");

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
  assert.strictEqual(ac.portail, "site_agence");
  assert.strictEqual(ac.site, "agence-exemple.fr");
  assert.strictEqual(ac.site_origine, "site_agence_exemple");
  assert.deepStrictEqual([ac.contact.nom, ac.contact.prenom, ac.contact.email, ac.contact.telephone], ["Durand", "Célia", "celia.d@example.org", "+33652723071"]);
  assert.strictEqual(ac.bien.reference, "2289"); assert.strictEqual(ac.bien.ville, "sanilhac");

  /*
   * Le parseur conserve "site_agence" comme canal technique,
   * mais le traitement métier expose le véritable site/agence.
   */
  const acMetier = await traiter(
    MAILS.ac3,
    M.creer({
      biens: [
        {
          id: 2289,
          reference: "2289",
          type: "maison",
          ville: "sanilhac"
        }
      ],
      contacts: []
    }),
    {
      ...CONF,

      origines: [
        {
          id: 83748,
          code: "site_agence_exemple",
          libelle: "agence-exemple.fr"
        }
      ],

      consentement: {
        actif: false
      },

      routage: {
        personnes: [],
        regles: [],
        absences: [],
        siege: []
      },

      etapes: {
        notification: false,
        projet: false,
        consentement: false,
        action: false
      }
    }
  );

  assert.strictEqual(
    acMetier.extraction.portail,
    "site_agence"
  );

  assert.strictEqual(
    acMetier.portail,
    "Agence Exemple"
  );

  assert.strictEqual(
    acMetier.source,
    "Agence Exemple"
  );

  assert.strictEqual(
    acMetier.origine.id,
    83748
  );

  assert.strictEqual(
    acMetier.origine.libelle,
    "Agence Exemple"
  );


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
    if (/criterias\/product\/all/.test(url)) return J({ data: [{ id: 5, xml: "Surface" }, { id: 6, xml: "NbPieces" }, { id: 7, xml: "CodePostalWeb" }, { id: 27, xml: "TypeBien" }] });
    if (/criterias\/product\/27\/values/.test(url)) return J({ data: [{ id: 1, model: "Appartement", label: "Appartement" }, { id: 2, model: "Maison", label: "Maison" }] });
    if (/products\/search\?fetch=/.test(url)) {
      const b = JSON.parse(o.body);
      if (b.criterias) { assert.deepStrictEqual(b.criterias.map((c) => c.id), ["TypeBien", "NbPieces"]); assert.strictEqual(b.criterias[0].value, "Maison"); }
      return J({ data: [{ id: 99, model: "30123", price: 245000, criteres_number: [{ critere_id: 5, critere_value: "120" }, { critere_id: 6, critere_value: "5" }], criteres_text: [{ critere_id: 7, critere_value: "46000" }], assigned_to: { id: 866 }, agency_id: 405 }, { id: 98, model: "301234", criteres_text: [] }], next_cursor: null, has_more: false });
    }
    if (/customers\/search/.test(url)) return J({ data: [{ id: 1, email: "a@x.fr", createdAt: "2026-01-01", mobilePhone: "+33611111111" }], meta: { next_cursor: null } });
    return J({ erreur: "?" }, 404);
  };
  const imf = creerCrm("immofacile", { site_id: "123", fetch: fake, secret: async (k) => (k === "basic" ? "QUJD" : null) }, { mode: "ombre" });
  const bs = await imf.biensParReference("30123");
  assert.deepStrictEqual(bs.map((b) => [b.id, b.surface, b.pieces, b.code_postal, b.negociateur_id]), [[99, 120, 5, "46000", 866]]);
  assert.strictEqual((await imf.contactsParEmail("A@x.fr"))[0].id, 1);
  assert.deepStrictEqual((await imf.biensParCriteres({ type: "maison", pieces: 5 })).map((b) => b.id), [99, 98], "deux biens → le rapprochement les jugera ambigus");
  assert.strictEqual((await imf.contactsParTelephone("+33611111111"))[0].id, 1);
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

  /* Variantes trouvées dans l'audit des 7 658 mails AMBS (données fictives, même mise en page) */
  {
    const C2 = { ...CONF, id_crm_liens: ["immo-facile-(\\d{8})\\b"] };
    const pv = extraire({ expediteur: '"ParuVendu.fr" <contact@paruvendupro.fr>', objet: "Vous avez un contact - réf. : 60999999_32000 - Vente - Maison - 250000€ - AB12",
      texte: "Réf. Pro : 60999999_32000\n250 000€\nCahors (46000) Maison - 5 pièce(s) - 120 m²\nRépondez à ce contact au plus vite :\n(dans la journée)\nM DURAND\nTéléphone : 0611223344\nEmail : durand@example.org\nVoici son message :\nBonjour, je souhaite visiter." }, C2);
    assert.strictEqual(pv.nature, "lead"); assert.strictEqual(pv.bien.id_crm, "60999999"); assert.strictEqual(pv.bien.reference, "32000");
    const loc = extraire({ expediteur: "\"Bien'ici\" <no_reply@bienici.com>", objet: "Contact candidat locataire pour votre annonce 1201 à PELLEGRUE",
      texte: "Ses coordonnéesHervé Test Téléphone : 07 00 00 00 01\nE-mail : herve@example.org\nRappel de l’annoncePhoto\nMaison 5 pièces 89 m²\n33790 PELLEGRUE\n600 €par mois charges comprises\nRÉFÉRENCE : 1201",
      html: '<a href="https://pro.bienici.com/?at_id_compte=immo-facile-405876&x=1">b</a>' }, C2);
    assert.strictEqual(loc.nature, "lead"); assert.strictEqual(loc.agence_crm, "405876"); assert.ok(!loc.bien.id_crm, "le compte Bien'ici n'est pas un bien");
    const appel = extraire({ expediteur: "\"Bien'ici\" <no_reply@bienici.com>", objet: "Un prospect-acquéreur a tenté de vous contacter par téléphone. Rappelez-le au 06 47 00 00 71 !", texte: "Vous pouvez le rappeler à ce numéro :\n06 47 00 00 71" }, C2);
    assert.strictEqual(appel.nature, "lead"); assert.strictEqual(appel.contact.telephone, "+33647000071");
    const tr = extraire({ expediteur: '"Agence" <quarantaine@agence-exemple.fr>', objet: 'TR: Nouveau message pour "Local 45 m² RODEZ" sur leboncoin',
      texte: "De : info@agence-exemple.fr <info@agence-exemple.fr>\nEnvoyé : mardi 18 août 2026 17:46\nÀ : quarantaine@agence-exemple.fr\nObjet : Nouveau message pour \"Local 45 m² RODEZ\" sur leboncoin\nBonjour,\nYann vous a contacté sur leboncoin.\nPrénom : yann\nNom : TEST\nE-mail : yann@example.org\nTéléphone : +33600000041\n« Est-il disponible ? »\nRéférence : 12027400400\nL'équipe leboncoin" }, C2);
    assert.strictEqual(tr.nature, "lead"); assert.strictEqual(tr.portail, "leboncoin"); assert.strictEqual(tr.contact.email, "yann@example.org"); assert.ok(!/:/.test(tr.contact.nom_complet || ""));
    const ga = extraire({ expediteur: '"Dupont Alphée via Green-Acres" <alphee.dupont-84cd@email.green-acres.com>', objet: "Nouveau contact pour AGENCE EXEMPLE",
      texte: "Nouveau contact\nDupont Alphée - 18/08/2026\nBonjour,\nLa référence de l'annonce est: 615\nMerci\nRépondez à cet email pour lui écrire directement.\n✉\nagence-84cd95c2@email.green-acres.com" }, C2);
    assert.strictEqual(ga.nature, "lead"); assert.strictEqual(ga.bien.reference, "615"); assert.strictEqual(ga.contact.email_relais, "alphee.dupont-84cd@email.green-acres.com");
    assert.strictEqual(extraire({ expediteur: "<email@huisenaanbod.nl>", objet: "Nouvelle demande d'information via HUISenAANBOD.nl !", texte: "Nom: #Naamaanvrager\nMessage du demandeur: #Vraag" }, C2).nature, "non_lead");
    const lux = extraire({ expediteur: "<contact@lead.seloger.com>", objet: "Un acquéreur est intéressé par un de vos biens",
      texte: "Identifiant client : RC-1\nNouveau contact sur votre annonce 32129\nMaison\n• 6 pièces\n• 202 m²\nCARCASSONNE, 11000\n599 000 €\nRef. de l'annonce : 32129\nMessage du contact\nBonjour\nNom : Jean TESTEUR\nEmail : jean@example.org\nCet email vous est adressé par X, S.A.S au capital de 642 609 233 €" }, C2);
    assert.strictEqual(lux.bien.ville, "CARCASSONNE"); assert.strictEqual(lux.bien.code_postal, "11000"); assert.strictEqual(lux.bien.prix, 599000); assert.strictEqual(lux.contact.nom, "TESTEUR"); assert.strictEqual(lux.contact.prenom, "Jean");
    const b2b = await traiter({ expediteur: "Léa <lea@salon-exemple.com>", objet: "Rencontrez des maires au salon", texte: "Bonjour, nous vous proposons un stand, intéressé ? prix spécial." }, M.creer({}), C2);
    assert.notStrictEqual(b2b.statut, "pret");
    /* preuve faible : « 2162 » moins le dernier caractère = « 216 », bien d'une autre ville sans prix → rejeté */
    const crmX = M.creer({ biens: [{ id: 1, reference: "216", prix: 0, surface: 0, pieces: 6, type: "maison", ville: "RODEZ", code_postal: "12000" }] });
    const rx = await rapprocher({ bien: { reference: "2162", ville: "Raulhac", pieces: 6, type: "maison", prix: 89500 } }, crmX);
    assert.strictEqual(rx.bien, null, "une référence tronquée ne suffit pas sans fait distinctif");
    const r8 = await rapprocher({ bien: { reference: "985_985_61000001", prix: 530000, type: "appartement" } }, M.creer({ biens: [{ id: 61000001, reference: "985_985", prix: 510000, type: "appartement", ville: "Cannes" }, { id: 7, reference: "985", prix: 4800000, type: "maison" }] }));
    assert.strictEqual(r8.bien && r8.bien.id, 61000001, "identifiant Immofacile caché dans la référence");
  }

  /* Portail déclaré par le client : par domaine, ou par adresse complète (le formulaire du site écrit depuis le domaine de l'agence ;
     les autres adresses de ce domaine restent des mails de l'équipe). */
  {
    const dom = (CONF.domaines_agence || ["agence-exemple.fr"])[0];
    const cf = { ...CONF, domaines_agence: [dom], portails: [
      { id: "declare_1", nom: "Portail Exemple", domaines: ["portail-exemple.fr"], objets_lead: ["nouveau contact"] },
      { id: "declare_2", nom: "Agence Exemple", domaines: ["formulaire@" + dom], objets_lead: ["contact depuis le site"] }] };
    const corps = "Nom : Paul Martin\nEmail : paul.martin@example.org\nTéléphone : 06 11 22 33 44\nSon message : Bonjour, je souhaite visiter.\nRéférence : 30123";
    const p1 = extraire({ expediteur: "Portail <contact@portail-exemple.fr>", destinataire: "rodez@" + dom, objet: "Nouveau contact RDZ30123", texte: corps }, cf);
    assert.strictEqual(p1.portail, "declare_1"); assert.strictEqual(p1.nature, "lead"); assert.strictEqual(p1.contact.email, "paul.martin@example.org");
    const p2 = extraire({ expediteur: `Site <formulaire@${dom}>`, destinataire: "rodez@" + dom, objet: "Contact depuis le site - RDZ30123", texte: corps }, cf);
    assert.strictEqual(p2.portail, "declare_2", "le formulaire du site est une source, pas un mail de l'équipe"); assert.strictEqual(p2.portail_nom, "Agence Exemple"); assert.strictEqual(p2.nature, "lead");
    const p3 = extraire({ expediteur: `Martin <martin@${dom}>`, destinataire: "rodez@" + dom, objet: "Point sur le dossier", texte: "Bonjour, je te rappelle demain." }, cf);
    assert.notStrictEqual(p3.portail, "declare_2"); assert.strictEqual(p3.nature, "interne", "une autre adresse de l'agence reste un mail de l'équipe");
  }

  /* Portail connu dont l'objet a changé : coordonnées du prospect + bien = lead, jamais écarté ; une notification sans prospect reste écartée. */
  {
    const corps = "Un prospect est intéressé par votre annonce\nNom : Paul Martin\nEmail : paul.martin@example.org\nTéléphone : 06 11 22 33 44\nRéférence : 30123\nPrix : 245 000 €";
    const n1 = extraire({ expediteur: "Bien'ici <contact@bienici.com>", destinataire: "rodez@agence-exemple.fr", objet: "Un objet jamais vu 30123", texte: corps }, CONF);
    assert.strictEqual(n1.nature, "lead", "coordonnées + bien : lead"); assert(n1.nature_corrigee); assert.strictEqual(n1.contact.email, "paul.martin@example.org");
    const n2 = extraire({ expediteur: "Bien'ici <no-reply@bienici.com>", destinataire: "rodez@agence-exemple.fr", objet: "Votre annonce a été publiée", texte: "Votre annonce réf. 30123 est en ligne.\nRéférence : 30123" }, CONF);
    assert.strictEqual(n2.nature, "non_lead", "sans prospect : reste écarté");
  }

  /* Mail AC3 sans site déclaré : la source est l'agence nommée dans l'objet, jamais « AC3 » */
  {
    const d0 = await traiter(MAILS.ac3, M.creer({}), { ...CONF, sites: [] });
    assert(!/ac3/i.test(d0.portail || ""), "source sans AC3 : " + d0.portail);
    assert.strictEqual(d0.portail, "Agence Exemple");
    /* dans le CRM aussi, l'origine est l'agence (son site), trouvée par son nom */
    const origines = [{ id: 11, code: "leboncoin", libelle: "Leboncoin" }, { id: 12, code: "agence_exemple_fr", libelle: "agence-exemple.fr" }, { id: 13, code: "ambs", libelle: "Autre" }];
    const d1 = await traiter(MAILS.ac3, M.creer({}), { ...CONF, sites: [], origines, origine_defaut: "ambs" });
    assert.strictEqual(d1.origine && d1.origine.id, 12, "origine CRM = le site de l'agence : " + JSON.stringify(d1.origine));
    assert(!/ac3/i.test(JSON.stringify(d1.origine)));
  }

  /* AC3, création de compte : lead avec client ET bien, sinon non */
  {
    const avec = extraire({ ...MAILS.ac3, objet: "Création compte sur AGENCE EXEMPLE" }, CONF);
    assert.strictEqual(avec.nature, "lead", "client + bien : lead");
    const sansBien = extraire({ ...MAILS.ac3, objet: "Création compte sur AGENCE EXEMPLE", texte: MAILS.ac3.texte.replace(/Biens maison.*\n/, ""), html: "" }, CONF);
    assert.strictEqual(sansBien.nature, "non_lead", "sans bien : pas un lead");
    const sansClient = extraire({ ...MAILS.ac3, objet: "Création compte sur AGENCE EXEMPLE", texte: MAILS.ac3.texte.replace(/Client :.*?\n/, "\n") }, CONF);
    assert.strictEqual(sansClient.nature, "non_lead", "sans client : pas un lead");
    assert.strictEqual(extraire(MAILS.ac3, CONF).nature, "lead", "une demande reste un lead");
  }

  /* Zefir : un acheteur, pas une estimation */
  {
    const z = extraire({ expediteur: "Zefir <agent@zefir.fr>", destinataire: "rodez@agence-exemple.fr", objet: "Un acheteur Zefir souhaite visiter l’un de vos biens !",
      texte: "Bonjour,\nVous avez reçu une demande de contact pour le bien situé à Rodez (12000).\nCoordonnées de Paul Martin :\n📞 06 11 22 33 44\n📧 paul.martin@example.org\nMaison à vendre - Maison - 5 pièces - 120 m²\n245 000 € - 120 m²\n🗺️ Rodez (12000)" }, CONF);
    assert.strictEqual(z.nature, "lead", "Zefir acheteur = lead");
    assert.strictEqual(z.contact.email, "paul.martin@example.org"); assert(/0611223344$|611223344$/.test(String(V.telephone(z.contact.telephone)).replace(/\D/g, "")));
    assert.strictEqual(z.bien.code_postal, "12000"); assert.strictEqual(z.bien.prix, 245000);
  }
  /* Références lues d'après les vrais mails (banc) : French-Property (référence du bien, identifiant, prix), Arkadia, Kyero, Moulin */
  {
    const fp = extraire({ expediteur: "French-Property <enquiries@french-property.com>", destinataire: "rodez@agence-exemple.fr", objet: "Demande de renseignements : Maison (12345)",
      texte: "Bonjour,\nVous avez reçu une demande concernant votre bien 12345\n----- Demande de renseignements - Réf. : 987654 -----\nNom : Jean Test\nAdresse e-mail : j@example.org\nNuméro de téléphone : 0611223344\nMessage :\nBonjour\nDétails du bien - Réf. : 12345\nRéf. agence 61234567\nPropriété avec piscine\n250 000 €\nLieu : Occitanie, Aude (11), Limoux\n" }, CONF);
    assert.strictEqual(fp.bien.reference, "12345", "référence du bien, pas celle de la demande"); assert.strictEqual(fp.bien.reference_portail, "987654");
    assert.strictEqual(fp.bien.id_crm, "61234567"); assert.strictEqual(fp.bien.prix, 250000, "l'identifiant n'est pas lu comme un prix");
    assert.strictEqual(fp.bien.ville, "Limoux"); assert.strictEqual(fp.bien.titre, "Propriété avec piscine");
    const ar = extraire({ expediteur: "Arkadia <noreply@arkadia.com>", destinataire: "rodez@agence-exemple.fr", objet: "Au sujet de l'annonce ABCD-T4521 / B7ACE2A9C1C sur Arkadia [key:3b9da1-b2d]",
      texte: "La personne vous envoie une demande\nconcernant votre annonce sur Arkadia ABCD-T4521 / B7ACE2A9C1C\nNom: Jan Test\nPrénom:\nE-mail: jan@example.org\nTel: 0612345678\nMessage:\n" }, CONF);
    assert.strictEqual(ar.bien.reference, "B7ACE2A9C1C"); assert.strictEqual(ar.bien.reference_portail, "ABCD-T4521");
    const ky = extraire({ expediteur: "Kyero <leads@kyero.com>", destinataire: "rodez@agence-exemple.fr", objet: "Nouvelle demande : F3FB2CD4ED5/", texte: "**Vous avez une demande sur : **[F3FB2CD4ED5] **\njan@example.org\n" }, CONF);
    assert.strictEqual(ky.bien.reference, "F3FB2CD4ED5");
    const mo = extraire({ expediteur: "Moulin <info@moulin.nl>", destinataire: "rodez@agence-exemple.fr", objet: "(staff copy) Property request: '12 Moulin à eau à vendre. Aveyron. (SEHA4567)' by Jan",
      texte: "Hello Habitat,\nFrom:\nNom: Jan Test\nEmail: jan@example.org\nTéléphone: 0611223344\nRequest for Property:\nID: 8812\nObject: 12 Moulin à eau à vendre. Aveyron.\nURL:\n" }, CONF);
    assert.strictEqual(mo.bien.reference, "SEHA4567"); assert.strictEqual(mo.bien.reference_portail, "8812"); assert(/Moulin/.test(mo.bien.titre));
  }
  /* Un rôle n'est jamais un nom : « Coordonnées de l'acheteur : » suivi du vrai nom (Zefir) ; « Nom : Acquéreur » effacé */
  {
    const z2 = extraire({ expediteur: "Zefir <agent@zefir.fr>", destinataire: "rodez@agence-exemple.fr", objet: "Cet acheteur attend votre réponse",
      texte: "Rappel\nVous avez reçu une demande de contact pour le bien situé au Rodez (12000).\nCoordonnées de l’acheteur :\nPaul Martin\n📞 06 11 22 33 44\n📧 paul.martin@example.org Merci\nMaison à vendre - Maison - 5 pièces -...\n245 000 € - 120 m²\n🗺️ Rodez (12000)" }, CONF);
    assert.strictEqual(z2.contact.prenom, "Paul"); assert.strictEqual(z2.contact.nom, "Martin");
    const { nettoyerNoms } = require("../src/lib/leads/extraire");
    assert.deepStrictEqual(nettoyerNoms({ nom: "Acquéreur", email: "x@example.org" }), { email: "x@example.org" });
    assert.strictEqual(nettoyerNoms({ nom_complet: "l'acheteur" }).nom_complet, undefined);
  }
  /* Référence très courte : jamais une preuve seule (elle peut désigner un autre bien) ; Giraffe : référence accolée à des lettres */
  {
    const { rapprocher } = require("../src/lib/leads/rapprochement");
    const crmC = require("../src/lib/leads/crm/memoire").creer({ biens: [{ id: 1, reference: "12", ville: "Rodez", code_postal: "12000" }, { id: 2, reference: "AGX12345", ville: "Albi" }] });
    assert.strictEqual((await rapprocher({ bien: { reference: "12" } }, crmC)).bien, null, "référence de 2 caractères seule : pas de bien");
    assert.strictEqual((await rapprocher({ bien: { reference: "12", ville: "Rodez", code_postal: "12000" } }, crmC)).bien.id, 1, "confirmée par la ville et le code postal");
    const gi = extraire({ expediteur: "Giraffe360 <noreply@giraffe360.com>", destinataire: "rodez@agence-exemple.fr", objet: "Nouveau prospect – Demande d'accès à une visite virtuelle",
      texte: "Vous avez reçu une nouvelle demande\nNom : Jan Test\nEmail : jan@example.org\nTéléphone : 0611223344\nNouveau prospect pour le projet : Maison AGX12345 (11000, France)\n" }, CONF);
    assert.strictEqual(gi.bien.reference, "AGX12345");
  }
  /* Réponse d'absence reconnue au texte (deux signes), jamais un prospect qui dit juste être absent */
  {
    const abs = extraire({ expediteur: "Claire <claire@example.org>", destinataire: "rodez@agence-exemple.fr", objet: "Re : Demande auprès de AGENCE EXEMPLE",
      texte: "Madame, Monsieur,\nJe suis absente jusqu'au 25 août. Pour toute demande urgente, veuillez contacter le 05 00 00 00 00.\nCordialement" }, CONF);
    assert.strictEqual(abs.nature, "auto_reponse", "réponse d'absence");
    const pro = extraire({ expediteur: "Claire <claire@example.org>", destinataire: "rodez@agence-exemple.fr", objet: "Re : maison réf. 30123",
      texte: "Bonjour, je serai absente le 12 mais la maison réf. 30123 m'intéresse, pouvez-vous me rappeler au 06 11 22 33 44 ?" }, CONF);
    assert.notStrictEqual(pro.nature, "auto_reponse", "un prospect absent un jour n'est pas une réponse automatique");
  }
  /* Un acheteur qui demande une brochure ou cite le site internet n'est pas du démarchage */
  {
    const b = extraire({ ...MAILS.leboncoin, texte: MAILS.leboncoin.texte.replace(/« .*? »/s, "« Bonjour, vu sur votre site internet, pouvez-vous m'envoyer la brochure ? »") }, CONF);
    assert(!b.suspect, "acheteur, pas démarchage : " + b.suspect);
    const d2 = extraire({ ...MAILS.leboncoin, texte: MAILS.leboncoin.texte.replace(/« .*? »/s, "« Bonjour, je vous propose mes services de photographe et de création de votre site internet. »") }, CONF);
    assert(/démarchage/.test(d2.suspect || ""), "démarchage toujours repéré");
  }

  console.log("leads + ovh : ok");
})().catch((e) => { console.error(e); process.exit(1); });
