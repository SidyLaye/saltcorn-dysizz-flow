/* Nouveau portail jamais vu : l'IA lit les premiers mails, un gabarit s'apprend tout seul,
   puis les mails suivants sont lus sans IA. Si le portail change sa mise en page, le gabarit
   est suspendu et un nouveau s'apprend. Aucune déclaration manuelle. */
"use strict";
const assert = require("assert");
const L = require("../src/lib/leads");
const { lire } = L;
const IA = L.ia, A = L.apprentissage;

const GENS = [
  ["Jean", "Dupont", "jean.dupont@gmail.com", "06 12 34 56 78", "IN-2041"],
  ["Claire", "Martin", "c.martin@orange.fr", "07 88 11 22 33", "IN-3310"],
  ["Paul", "Bernard", "paul.b@yahoo.fr", "06 45 45 45 12", "IN-0077"],
  ["Sophie", "Petit", "sophie.petit@free.fr", "06 98 76 54 32", "IN-5120"],
  ["Luc", "Moreau", "luc.moreau@gmail.com", "07 01 02 03 04", "IN-9001"],
  ["Anne", "Roux", "anne.roux@gmail.com", "06 11 11 11 22", "IN-1111"],
  ["Marc", "Blanc", "marc.blanc@gmail.com", "06 22 22 22 33", "IN-2222"],
  ["Julie", "Faure", "julie.faure@gmail.com", "06 33 33 33 44", "IN-3333"],
  ["Hugo", "Girard", "hugo.girard@gmail.com", "06 44 44 44 55", "IN-4444"],
  ["Emma", "Andre", "emma.andre@gmail.com", "06 55 55 55 66", "IN-5555"],
];
const v1 = ([p, n, e, t, r]) => ({ expediteur: "ImmoNouveau <alertes@immo-nouveau.fr>", destinataire: "agence@test.fr", objet: "Une demande pour votre annonce",
  texte: `Bonjour,\nNouvelle demande reçue via ImmoNouveau pour votre annonce.\nNom du contact : ${p} ${n}\nCourriel : ${e}\nTél. : ${t}\nAnnonce réf : ${r}\nMessage : Bonjour, je souhaite visiter ce bien rapidement, merci.\nL'équipe ImmoNouveau vous remercie.` });
/* nouvelle mise en page : libellés changés */
const v2 = ([p, n, e, t, r]) => ({ ...v1([p, n, e, t, r]),
  texte: `Bonjour,\nNouvelle demande reçue via ImmoNouveau pour votre annonce.\nIdentité : ${p} ${n}\nAdresse électronique => ${e}\nMobile => ${t}\nRéférence du bien => ${r}\nSon message => Je voudrais plus d'informations.\nL'équipe ImmoNouveau vous remercie.` });

/* Fausse IA : lit comme le ferait un modèle et propose des motifs appuyés sur les libellés. */
const fausseIA = () => {
  let n = 0;
  const appeler = async (prompt) => {
    n++;
    const t = prompt.slice(prompt.lastIndexOf("<mail>"));
    const g = (re) => (t.match(re) || [])[1] || null;
    const nouveau = /Identité :/.test(t);
    const nomC = nouveau ? g(/Identité : (.+)/) : g(/Nom du contact : (.+)/);
    return JSON.stringify({
      nature: "lead", confiance_nature: 0.95, source: "ImmoNouveau",
      prenom: nomC.split(" ")[0], nom: nomC.split(" ").slice(1).join(" "),
      email: nouveau ? g(/électronique => (\S+)/) : g(/Courriel : (\S+)/),
      telephone: nouveau ? g(/Mobile => (.+)/) : g(/Tél\. : (.+)/),
      reference: nouveau ? g(/du bien => (\S+)/) : g(/Annonce réf : (\S+)/),
      message: nouveau ? g(/Son message => (.+)/) : g(/Message : (.+)/),
      motif_nom: nouveau ? "Identité\\s*:\\s*(.+)" : "Nom du contact\\s*:\\s*(.+)",
      motif_email: nouveau ? "électronique\\s*=>\\s*(\\S+)" : "Courriel\\s*:\\s*(\\S+)",
      motif_telephone: nouveau ? "Mobile\\s*=>\\s*(.+)" : "Tél\\.\\s*:\\s*(.+)",
      motif_reference: nouveau ? "du bien\\s*=>\\s*(\\S+)" : "Annonce réf\\s*:\\s*(\\S+)",
      motif_message: nouveau ? "Son message\\s*=>\\s*(.+)" : "Message\\s*:\\s*(.+)",
      signature_ancre: "Nouvelle demande reçue via ImmoNouveau",
      /* hallucination : une ville qui n'est pas dans le mail */
      ville: "Bordeaux",
    });
  };
  return { client: IA.creer({ appeler }), appels: () => n };
};

(async () => {
  const conf = { domaines_agence: ["test.fr"] };
  const store = A.memoire();
  const f = fausseIA();
  const opts = { ia: f.client, gabarits: store };

  /* 1. les 3 premiers mails passent par l'IA, le gabarit s'active au 3e */
  const faits = [];
  for (let i = 0; i < 3; i++) {
    const r = await lire(v1(GENS[i]), conf, opts);
    assert.ok(r.lu_par.includes("ia"), "mail " + i + " lu par l'IA " + JSON.stringify(r.lecture));
    assert.strictEqual(r.contact.email, GENS[i][2]);
    assert.strictEqual(r.bien.reference, GENS[i][4]);
    assert.ok(!r.bien.ville, "la ville inventée par l'IA est refusée");
    assert.ok(r.lecture.ia.rejets.includes("ville"));
    faits.push(r.lecture.apprentissage.fait);
  }
  assert.deepStrictEqual(faits, ["créé", "renforcé", "activé"], "apprentissage : " + faits.join(", "));
  const g = store.tous()[0];
  assert.strictEqual(g.statut, "actif");
  assert.ok(g.champs.some((c) => c.nom === "nom_complet"), "le nom complet est appris comme tel");
  assert.ok(!JSON.stringify(g).includes("Dupont") && !JSON.stringify(g).includes("gmail"), "aucune donnée personnelle dans le gabarit");

  /* 2. les suivants sont lus sans IA */
  const avant = f.appels();
  for (let i = 3; i < 5; i++) {
    const r = await lire(v1(GENS[i]), conf, opts);
    assert.deepStrictEqual(r.lu_par, ["regles", "gabarit"], "mail " + i + " : " + r.lu_par);
    assert.strictEqual(r.contact.email, GENS[i][2]);
    assert.strictEqual(r.contact.prenom, GENS[i][0]);
    assert.strictEqual(r.contact.nom, GENS[i][1]);
    assert.strictEqual(r.contact.telephone.replace(/\D/g, "").slice(-9), GENS[i][3].replace(/\D/g, "").slice(-9));
    assert.strictEqual(r.bien.reference, GENS[i][4]);
  }
  assert.strictEqual(f.appels(), avant, "aucun appel à l'IA une fois le gabarit actif");

  /* 3. le portail change sa mise en page : l'IA reprend, l'ancien gabarit est suspendu, un nouveau s'apprend */
  for (let i = 5; i < 10; i++) {
    const r = await lire(v2(GENS[i]), conf, opts);
    assert.strictEqual(r.contact.email, GENS[i][2], "nouvelle mise en page lue (" + r.lu_par + ")");
  }
  const G = store.tous();
  assert.ok(G.find((x) => x.id === g.id).nb_echecs >= 1, "les échecs de l'ancien gabarit sont comptés");
  const nouveau = G.find((x) => x.id !== g.id && x.statut === "actif");
  assert.ok(nouveau, "un nouveau gabarit est actif : " + JSON.stringify(G.map((x) => [x.id, x.statut, x.nb_observations, x.nb_echecs])));
  const n9 = f.appels();
  const r9 = await lire(v2(GENS[0]), conf, opts);
  assert.deepStrictEqual(r9.lu_par, ["regles", "gabarit"]);
  /* les deux mises en page coexistent : l'ancienne est toujours lue sans IA */
  const r10 = await lire(v1(GENS[1]), conf, opts);
  assert.deepStrictEqual(r10.lu_par, ["regles", "gabarit"]);
  assert.strictEqual(f.appels(), n9);
  /* un gabarit qui échoue 3 fois de suite est suspendu */
  const s3 = A.memoire([{ id: 1, statut: "actif", nb_echecs: 2 }]);
  assert.strictEqual(await A.echec(s3, s3.tous()[0]), "suspendu");

  /* 4. motif refusé s'il contient une donnée du mail ; motif coûteux refusé */
  assert.ok(A.motifSur("Nom : (Dupont)", { nom: "Dupont" }));
  assert.ok(A.motifSur("((a+)+)b", {}));
  assert.strictEqual(A.motifSur("Courriel\\s*:\\s*(\\S+)", { email: "x@y.fr" }), null);

  /* 5. l'IA n'est pas appelée pour un portail connu complet, ni au-delà du plafond */
  const f2 = fausseIA();
  const lbc = { expediteur: "Leboncoin <messagerie@messagerie.leboncoin.fr>", objet: "Nouveau message pour « Maison 5 pièces »", texte: "Vous avez un nouveau message\nPrénom : Léa\nNom : Garnier\nE-mail : lea.garnier@gmail.com\nTéléphone : 06 10 20 30 40\nRéférence : 12345\n« Bonjour, est-il toujours disponible ? » Répondre" };
  const rl = await lire(lbc, conf, { ia: f2.client, gabarits: A.memoire() });
  assert.ok(!rl.lu_par.includes("ia") && f2.appels() === 0, "portail connu : pas d'IA (" + rl.lu_par + ")");
  const rp = await lire(v1(GENS[0]), conf, { ia: fausseIA().client, gabarits: A.memoire(), budget: async () => false });
  assert.strictEqual(rp.lecture.ia.statut, "plafond");

  /* 6. l'IA en panne : le mail reste à relire, rien ne casse */
  const panne = IA.creer({ appeler: async () => { const e = new Error("HTTP 401"); e.status = 401; throw e; } });
  const rx = await lire(v1(GENS[0]), conf, { ia: panne });
  assert.strictEqual(rx.lecture.ia.statut, "erreur");

  /* 7. traiter() de bout en bout avec un CRM en mémoire */
  const crm = L.ADAPTATEURS.memoire.creer({ biens: [{ id: 77, reference: "IN-4444", prix: 250000, ville: "Rodez" }] });
  const d = await L.traiter(v1(GENS[8]), crm, conf, { ia: f.client, gabarits: store });
  assert.ok(d.bien && d.bien.id === 77, "bien trouvé par la référence lue par le gabarit : " + JSON.stringify([d.motifs, d.extraction.bien, d.extraction.lu_par, d.rapprochement]));
  /* gabarit pas encore assez confirmé par l'IA : à vérifier ; confirmé 3 fois sans échec : il lit seul (simple mention) */
  assert.ok(d.alertes.some((m) => /gabarit confirmé 3 fois/.test(m)) && !d.motifs.some((m) => /gabarit/.test(m)), JSON.stringify([d.motifs, d.alertes]));
  const gid = d.extraction.lecture.gabarit.id;
  await store.maj(gid, { nb_observations: 1, nb_echecs: 0 });
  const d2 = await L.traiter(v1(GENS[8]), crm, conf, { gabarits: store });
  assert.ok(d2.motifs.some((m) => /pas encore assez confirmé/.test(m)), JSON.stringify([d2.motifs, d2.alertes]));
  await store.maj(gid, { nb_observations: 3, nb_echecs: 0 });

  /* 8. import des anciens gabarits AMBS */
  const vieux = [{ id: 8, source: "seloger", nature: "lead", signature: '{"ancres":["s\'intéresse à ce bien"],"expediteur":"lead.seloger.com"}', champs: [{ nom: "reference", motif: "Ref\\. de l'annonce\\s*:\\s*(\\S+)" }], statut: "actif", version: "acquereur", nb_observations: 11 }, { id: 9, statut: "quarantaine" }];
  const im = A.depuisAmbs(vieux);
  assert.strictEqual(im.length, 1); assert.strictEqual(im[0].origine, "ambs:8:acquereur");
  assert.strictEqual(im[0].statut, "candidat", "un ancien gabarit n'est jamais cru sur parole"); assert.strictEqual(im[0].nb_observations, 0);
  console.log("apprentissage OK : nouveau portail appris en 3 mails, relu sans IA, changement de mise en page réappris");
})().catch((e) => { console.error(e); process.exit(1); });
