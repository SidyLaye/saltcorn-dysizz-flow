/* Bot WhatsApp des leads : ce qui sort vers le bot (champs publics seulement), qui est prévenu, et la fiche PDF.
   Données fictives. */
"use strict";
const assert = require("assert");
const B = require("../src/lib/leads/bot");
const { ecrirePdf, lireTextePdf } = require("../src/lib/pdf");
const M = require("../src/lib/leads/crm/memoire");
const { ombre } = require("../src/lib/leads/crm/ombre");

const BIEN = { id: 99, reference: "30123", prix: 1245000, surface: 120, pieces: 5, chambres: 3, type: "maison", ville: "Cahors", code_postal: "46000",
  ville_reelle: "Pradines", code_postal_reel: "46090", negociateur_id: "500", proprietaire_id: 777, agence_id: "405", adresse: "12 rue du Test", honoraires: 5 };
const CONF = { routage: { siege: ["siege@agence-exemple.fr"], absences: [{ personne_id: "502", debut: "2026-10-01", fin: "2026-10-31", remplacant: { personne: "500" } }],
  personnes: [{ id: "500", nom: "Martin Durand", email: "martin@agence-exemple.fr", telephone: "06 00 00 00 01", role: "negociateur", assistante_id: "501" },
    { id: "501", nom: "Julie Aide", email: "julie@agence-exemple.fr", role: "assistante" }, { id: "502", nom: "Paul Absent", email: "paul@agence-exemple.fr", role: "negociateur" }] } };
const QUAND = new Date("2026-10-13T10:00:00Z");

(async () => {
  /* le bot ne reçoit que les champs publics */
  assert.deepStrictEqual(Object.keys(B.bienPublic(BIEN)).sort(), [...B.CHAMPS_PUBLICS].sort());
  assert.strictEqual(B.bienPublic(null), null);
  assert.deepStrictEqual(["VILLEFRANCHE-DE-ROUERGUE", "L'ISLE-JOURDAIN", "SAINT-JEAN-D'ANGELY", "LA SALVETAT-SUR-AGOUT", "Rodez"].map(B.nomVille),
    ["Villefranche-de-Rouergue", "L'Isle-Jourdain", "Saint-Jean-d'Angely", "La Salvetat-sur-Agout", "Rodez"]);

  const dossier = { id: 7, negociateur: "500", portail: "leboncoin", nom: "Marie Test", email: "marie@exemple.fr" };
  const lead = { extraction: { contact: { prenom: "MARIE-LOU" }, recherche: { budget_max: 250000, localisation: "Cahors" } } };
  const c = B.contexte({ dossier, lead, bien: BIEN, conf: CONF, reglages: { entite: "Agence Exemple" }, etat: { fiche: true }, quand: QUAND });
  assert.strictEqual(c.prenom, "Marie-Lou");
  assert.deepStrictEqual(c.negociateur, { prenom: "", nom: "Martin Durand" });
  assert.deepStrictEqual(c.liens_whatsapp, {}, "pas de numéro direct sans accord du client");
  assert.strictEqual(c.fiche_annonce_envoyee, true);
  assert.ok(!/Pradines|46090|rue du Test|777|honoraires/.test(JSON.stringify(c)), "rien de privé dans le contexte");
  assert.strictEqual(B.contexte({ dossier, bien: BIEN, conf: CONF, reglages: { liens_directs: true }, quand: QUAND }).liens_whatsapp.negociateur, "https://wa.me/33600000001");
  /* négociateur absent : le nom donné est celui du remplaçant, qui reçoit vraiment */
  assert.strictEqual(B.contexte({ dossier: { ...dossier, negociateur: "502" }, bien: BIEN, conf: CONF, quand: QUAND }).negociateur.nom, "Martin Durand");
  assert.deepStrictEqual(B.contexte({ dossier: null, etat: { optout: true } }), { inconnu: true, optout: true });
  assert.deepStrictEqual(B.quiRecoit("500", CONF, BIEN, QUAND).liste.map((x) => x.email).sort(), ["julie@agence-exemple.fr", "martin@agence-exemple.fr", "siege@agence-exemple.fr"]);

  /* événements → écritures CRM et messages */
  const R = { couleurs: { HOT: 5 }, actions: { "OUT-1": 111, defaut: 222 } };
  const sortie = { type: "sortie", donnees: { code: "OUT-1", temperature: "HOT", lead_prioritaire: true, lead_financement: true, creneau: "samedi matin", scores: { provisoire: true, bien: 85, financement: 50, travaux: null, international: null }, qualification: { budget: "250 000", projet: "résidence principale" }, dernier_message: "Je veux visiter" } };
  const p = B.plan([{ type: "inbound", donnees: { texte: "bonjour" } }, { type: "prioritaire_vendeur", donnees: {} }, sortie], R);
  assert.deepStrictEqual(p.crm.map((a) => [a.op, a.couleur || a.action_id]), [["couleurContact", 5], ["ajouterAction", 111]]);
  assert.strictEqual(p.avis.length, 1, "un seul message quand la sortie porte déjà le caractère prioritaire");
  assert.deepStrictEqual(p.avis[0].referents, ["f"]);
  const stop = B.plan([{ type: "sortie", donnees: { code: "OUT-6" } }, { type: "optout", donnees: {} }], R);
  assert.ok(stop.optout && !stop.avis.length && stop.crm.length === 1, "désinscription : notée, sans message aux équipes ni couleur");
  assert.strictEqual(B.plan([{ type: "prioritaire_vendeur", donnees: { reponse: "oui" } }], {}).avis.length, 1);
  assert.deepStrictEqual(B.plan([sortie], {}).crm, [], "sans identifiants réglés, rien n'est écrit dans le CRM");

  const m = B.mailEquipe({ avis: p.avis[0], dossier, bien: BIEN, telephone: "33611111111", fil: [{ role: "prospect", texte: "<b>Je veux visiter</b>" }], aurait_recu: ["martin@agence-exemple.fr"] });
  /* réunion du 21/07 : le lead qualifié a un objet distinct du mail d'arrivée, avec synthèse, score et échange */
  assert.ok(m.objet.startsWith("[PRIORITAIRE] Lead qualifié WhatsApp · Demande de visite") && m.objet.includes("réf. 30123") && m.objet.includes("Marie Test"));
  assert.ok(m.html.includes("samedi matin") && m.html.includes("&lt;b&gt;Je veux visiter") && m.html.includes("moins de 3 mois") && m.html.includes("Essai : en service"));
  assert.ok(m.html.includes("Lead qualifié à l'issue de la conversation") && m.html.includes("bien 85/100 · financement 50/100 (barème provisoire)"));
  assert.strictEqual(B.texteScores(null), "");
  const alerte = B.mailEquipe({ avis: B.plan([{ type: "prioritaire_vendeur", donnees: {} }], {}).avis[0], dossier, bien: BIEN });
  assert.ok(alerte.objet.startsWith("[PRIORITAIRE] WhatsApp · Le prospect a un bien à vendre"), "une alerte en cours de conversation n'est pas un lead qualifié");

  /* annonce : tout ce qui est public sort ; jamais mandat, adresse, cadastre, honoraires, estimation, secteur, coordonnées, documents */
  const brute = { criteres: [
    { id: 36, nom: "Surface terrain", valeur: 5505, nature: "nombre" }, { id: 43, nom: "Salle(s) de bains", valeur: 1, nature: "nombre" }, { id: 39, nom: "Etage", valeur: 0, nature: "nombre" },
    { id: 1831, nom: "Consommation énergie primaire", valeur: "D", nature: "texte" }, { id: 99, nom: "Mode Chauffage", valeur: "Bois", nature: "texte" },
    { id: 246, nom: "ADSL possible", valeur: true, nature: "case" }, { id: 2188, nom: "Biens d'exception", valeur: false, nature: "case" },
    { id: 26, nom: "N° Mandat", valeur: "99001", nature: "texte" }, { id: 122, nom: "Adresse", valeur: "12 chemin des Essais", nature: "texte" }, { id: 207, nom: "Numéro cadastre", valeur: "zo", nature: "texte" },
    { id: 1929, nom: "Honoraires Vendeur", valeur: 23000, nature: "nombre" }, { id: 2019, nom: "Prix Estimé", valeur: 315000, nature: "nombre" }, { id: 123, nom: "Secteur", valeur: "AGENCE EXEMPLE", nature: "texte" },
    { id: 9999, nom: "Date de mise en vente", valeur: "01/01/2026", nature: "texte" }, { id: 2645, nom: "Justificatif d'identité", valeur: 1, nature: "nombre" },
    { id: 30, nom: "Prix", valeur: 313000, nature: "nombre" }, { id: 501, nom: "Cause vente/location", valeur: "Divorce", nature: "texte" },
    { id: 502, nom: "N° Digicode", valeur: "1234A", nature: "texte" }, { id: 503, nom: "Points faibles", valeur: "Route passante", nature: "texte" },
    { id: 504, nom: "Diagnostic Plomb", valeur: true, nature: "case" }, { id: 505, nom: "Bien occupé", valeur: true, nature: "case" },
    { id: 2736, nom: "Montant minimum estimé des dépenses annuelles d'énergie pour un usage standard", valeur: 3060, nature: "nombre" }],
    descriptions: [{ langue: "fr", titre: "Ensemble de charme", texte: "Belle maison au calme. Située au 12 rue des Lilas. Honoraires à la charge du vendeur. Appelez le 06 11 22 33 44 ou agent@agence.fr. Vue dégagée." },
      { langue: "es", titre: "Casa", texte: "Bonita casa." }],
    pieces: [{ piece: "Séjour", surface: 27, niveau: "RDC", commentaire: "Tomettes" }] };
  const an = B.annonce(brute);
  assert.deepStrictEqual(an.details, { "Surface terrain": "5505 m²", "Salle(s) de bains": "1", "Consommation énergie primaire": "D", "Mode Chauffage": "Bois", "ADSL possible": "oui" },
    "slide 07 : seul le prix de l'annonce est communicable, aucun autre montant (dépenses d'énergie, taxe, charges)");
  assert.ok(!/Divorce|1234A|passante|Plomb|occupé/.test(JSON.stringify(an)), "ni cause de vente, ni code d'accès, ni point faible, ni état des documents, ni occupation");
  assert.strictEqual(an.description_annonce.fr, "Belle maison au calme. Vue dégagée.", "ni adresse, ni honoraires, ni téléphone, ni mail");
  assert.ok(!an.description_annonce.es, "français et anglais seulement"); assert.deepStrictEqual(an.pieces_detail, ["Séjour · 27 m² · RDC · Tomettes"]);
  assert.ok(!/99001|Essais|zo"|23000|315000|EXEMPLE|2026|Justificatif/.test(JSON.stringify(an)));
  assert.deepStrictEqual(B.annonce(null), {});
  /* projet connu du lead : mail de la phase 1 d'abord, puis recherches du CRM (sans commentaire) */
  assert.deepStrictEqual(B.dejaConnu({ recherche: { budget_max: 200000 } }, { projets: [{ budget_min: 85000, budget_max: 160000, zone: "09000 FOIX", rayon_km: 20, terrain_min: 500, delai: "3 à 6 mois", revente: true }] }),
    { budget: 200000, budget_min: 85000, zone: "09000 FOIX", rayon_km: 20, surface_min: null, terrain_min: 500, pieces_min: null, delai: "3 à 6 mois", bien_a_vendre: true, usage: null, motif: null });
  const cx = B.contexte({ dossier, bien: { ...BIEN, annonce: brute }, conf: CONF, quand: QUAND, lead: { extraction: { message: "Je voudrais visiter samedi", nature: "lead" } } });
  assert.strictEqual(cx.bien_public.details["Surface terrain"], "5505 m²"); assert.strictEqual(cx.demande.message, "Je voudrais visiter samedi");
  assert.ok(!/99001|Essais|23000/.test(JSON.stringify(cx)), "rien de réservé dans le contexte");
  assert.ok(B.blocsFiche({ ...BIEN, annonce: brute }).some((x) => x.tableau && x.tableau.some(([l, v]) => l === "Surface terrain" && v === "5505 m²")), "la fiche PDF reprend les caractéristiques publiques");

  /* fiche PDF : champs publics, aucune marque */
  assert.strictEqual(B.blocsFiche(null), null);
  const blocs = B.blocsFiche(BIEN, QUAND);
  const buf = await ecrirePdf(blocs, { titre: "Fiche annonce", pied: false, producteur: "", couleur: "#374151" });
  const texte = lireTextePdf(buf) + buf.toString("latin1");
  assert.ok(/Maison 5 pi.ces . Cahors/.test(texte) && texte.includes("1 245 000") && texte.includes("13/10/2026"), "contenu de la fiche");
  assert.ok(!/Pradines|46090|rue du Test|dysizz|agence/i.test(texte), "ni adresse réelle ni marque dans la fiche");

  /* la couleur est une écriture : notée en mode ombre, jamais envoyée */
  const o = ombre(M.creer({}));
  await o.couleurContact(1, 5);
  assert.deepStrictEqual(o.notees, [{ op: "couleurContact", args: [1, 5] }]);
  /* photos : seulement celles fournies (dossier d'images choisi par le client), en https, 10 au plus ; aucune par défaut */
  assert.ok(!("photos_publiques" in B.contexte({ dossier, bien: BIEN, conf: CONF, quand: QUAND }).bien_public), "sans réglage, aucune photo");
  const ph = B.contexte({ dossier, bien: BIEN, conf: CONF, quand: QUAND, photos: ["http://x.fr/a.jpg", ...Array.from({ length: 12 }, (_, i) => `https://x.fr/${i}.jpg`)] }).bien_public.photos_publiques;
  assert.strictEqual(ph.length, 10); assert.ok(ph.every((u) => u.startsWith("https://")));
  const M2 = require("../src/lib/leads/crm/memoire").creer({ biens: [{ id: 7, photos: ["https://x.fr/p.jpg"] }] });
  assert.deepStrictEqual(await M2.photosBien(7), ["https://x.fr/p.jpg"]);
  console.log("bot : OK");
})().catch((e) => { console.error(e); process.exit(1); });
