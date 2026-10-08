/* Lecture « à vérifier » validée automatiquement quand tout est prouvé ; référence + suffixe (-EXCL). */
const assert = require("assert");
const T = require("../src/lib/leads/traiter");
const { variantes, rapprocher } = require("../src/lib/leads/rapprochement");

const MAIL = "Demande d'information concernant un bien - AGENCE HAMILTON\n\"Maisons & Appartements\" <demandeinfo@maisonsetappartements.fr>\n" +
  "Nom : Durand Prénom : Claire Téléphone : +44 7700 900123 E-mail : claire.durand@example.org " +
  "Cette demande concerne le bien suivant : Maison à vendre - Bidache Référence : 64000000001 Prix : 1 895 000 € 64520";
const MOTIF = "nouvel expéditeur « maisonsetappartements.fr » : lu par les règles générales";
const dossier = (o = {}) => ({
  extraction: { nature: "lead", contact: { nom: "Durand", prenom: "Claire", email: "claire.durand@example.org", telephone: "+447700900123" },
    bien: { reference: "64000000001", prix: 1895000, code_postal: "64520" }, ...(o.extraction || {}) },
  motifs: [MOTIF, ...(o.motifs || [])], alertes: [], actions: [],
  bien: { id: 60000001, prix: 1895000, code_postal: "64520", ...(o.bien || {}) }, rapprochement: { confiance: "haute" },
  negociateur: "negociateur" in o ? o.negociateur : "900001", contact: { action: "creer" },
  interne: { texte_mail: o.texte ?? MAIL, motif_lecture: MOTIF },
});
const fin = (d) => T.etapeDestinataires(d, { etapes: { notification: false } });

(async () => {
  /* 1. tout est prouvé : le lead passe, la raison est gardée en alerte */
  let d = fin(dossier());
  assert.strictEqual(d.statut, "pret", "lecture prouvée → prêt");
  assert.ok(d.alertes.some((a) => /validé automatiquement/.test(a)) && !d.motifs.length, "motif devenu alerte");
  /* 2. une valeur lue n'est pas dans le mail */
  d = fin(dossier({ texte: MAIL.replace("claire.durand@example.org", "") }));
  assert.strictEqual(d.statut, "a_verifier"); assert.ok(/valeur lue absente du mail : e-mail/.test(d.motifs[0]), d.motifs[0]);
  /* 3. le prix du mail contredit le bien choisi (cas réel du lead 12339) */
  d = fin(dossier({ bien: { prix: 299900 } }));
  assert.strictEqual(d.statut, "a_verifier"); assert.ok(/prix du mail 1 895 000 € ≠ prix du bien 299 900 €/.test(d.motifs[0].replace(/ /g, " ")), d.motifs[0]);
  /* 4. code postal différent, pas de négociateur, bien trouvé sur deux critères */
  assert.ok(/code postal du mail 64520 ≠/.test(fin(dossier({ bien: { code_postal: "64200" } })).motifs[0]));
  assert.ok(/aucun négociateur/.test(fin(dossier({ negociateur: null })).motifs.join(" ")));
  const basse = dossier(); basse.rapprochement.confiance = "basse";
  assert.strictEqual(fin(basse).statut, "a_verifier", "bien sur deux critères : pas de validation automatique");
  /* 5. un autre doute garde la main humaine, même si la lecture est prouvée */
  d = fin(dossier({ motifs: ["à vérifier : le mail vient du propriétaire du bien (vendeur), pas d'un acquéreur"] }));
  assert.strictEqual(d.statut, "a_verifier"); assert.strictEqual(d.motifs.length, 2);
  /* 6. sans motif de lecture : rien ne change */
  const neutre = dossier(); neutre.motifs = []; neutre.interne.motif_lecture = null;
  assert.strictEqual(fin(neutre).statut, "pret");

  /* 7. référence + suffixe : « 33074 » du mail = « 33074-EXCL » du CRM */
  assert.ok(variantes("33074").some((v) => v.valeur === "33074-EXCL" && v.etape === "reference_suffixe"));
  assert.ok(!variantes("33074-EXCL").some((v) => /EXCL-EXCL/i.test(v.valeur)), "pas de double suffixe");
  const CATALOGUE = [{ id: 61000001, reference: "33074-EXCL", prix: 179000, ville: "SAINTE CROIX", code_postal: "81150", type: "maison" }];
  const crm = { bienParId: async () => null, biensParCriteres: async () => [],
    biensParReference: async (ref) => CATALOGUE.filter((b) => b.reference.toLowerCase() === String(ref).toLowerCase()) }; // recherche exacte, comme Immofacile
  let r = await rapprocher({ bien: { reference: "33074", ville: "STE-CROIX", code_postal: "81150" } }, crm);
  assert.strictEqual(r.bien && r.bien.id, 61000001, "trouvé par la référence + suffixe"); assert.strictEqual(r.methode, "reference_suffixe");
  r = await rapprocher({ bien: { reference: "33074", code_postal: "75001" } }, crm);
  assert.ok(!r.bien, "suffixe mais code postal contraire : refusé");
  r = await rapprocher({ bien: { reference: "33074" } }, crm);
  assert.ok(!r.bien, "suffixe sans aucun fait pour confirmer : refusé");
  r = await rapprocher({ bien: { reference: "33074" } }, crm, { texte: "Je suis intéressée par la maison (réf. 33074-excl, 179 000 €)" });
  assert.strictEqual(r.bien && r.bien.id, 61000001, "référence + suffixe écrite telle quelle dans le mail : preuve suffisante");
  console.log("validation automatique de la lecture OK : valeurs ancrées dans le mail, prix et code postal du bien, négociateur, autre doute ; référence + suffixe -EXCL confirmée par un fait");
})().catch((e) => { console.error(e); process.exit(1); });
