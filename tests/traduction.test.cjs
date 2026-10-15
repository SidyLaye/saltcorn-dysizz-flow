"use strict";
/* valeurs d'annonce Immofacile → anglais (relevées sur 739 biens réels le 15/10) ; une valeur non traduisible entière → null */
const assert = require("node:assert/strict");
const { traduireValeur } = require("../src/lib/leads/traduction");
assert.equal(traduireValeur("Bois"), "wood");
assert.equal(traduireValeur("Bois + Electrique"), "wood + electric");
assert.equal(traduireValeur("Pierre"), "stone");
assert.equal(traduireValeur("Pierre de taille"), "dressed stone");
assert.equal(traduireValeur("Dégagée, Panoramique, Forêt, Village, Campagne"), "open, panoramic, forest, village, countryside");
assert.equal(traduireValeur("Aerien_Couvert"), "outdoor, covered");
assert.equal(traduireValeur("GarageFerme"), "closed garage");
assert.equal(traduireValeur("Américaine Amenagée Equipée"), "open-plan, fitted, equipped");
assert.equal(traduireValeur("Bon Etat"), "good condition");
assert.equal(traduireValeur("Pompe à chaleur air/eau"), "air-to-water heat pump");
assert.equal(traduireValeur("Sud-est"), "south-east");
assert.equal(traduireValeur("D"), "D", "une lettre (DPE) ou un nombre passe tel quel");
assert.equal(traduireValeur("1800"), "1800");
assert.equal(traduireValeur("oui"), "yes");
assert.equal(traduireValeur("vue sur cours depuis le séjour et la cuisine"), null, "texte libre non traduit : rien plutôt que du français");
const B = require("../src/lib/leads/bot");
const an = B.annonce({ criteres: [{ id: 1, nom: "Mode Chauffage", valeur: "Bois", nature: "texte" }, { id: 2, nom: "Vue", valeur: "Jardin, Etang", nature: "texte" },
  { id: 3, nom: "Commentaire vue", valeur: "vue sur cours depuis le séjour", nature: "texte" }] });
assert.deepEqual(an.details_en, { "Mode Chauffage": "wood", "Vue": "garden, pond" }, "details_en : seulement ce qui se traduit entièrement");
console.log("traduction des valeurs d'annonce OK");
/* statut de vente (tâche 4) : un bien fictif vit seulement dans l'application, son statut vaut lecture du moment */
{
  const { enVente } = require("../src/lib/leads/bot");
  const vieux = new Date(Date.now() - 86400000);
  assert.equal(enVente({ statut: "EnCours", synchro_le: vieux }).statut_lu_le, vieux.toISOString(), "bien du CRM : date de sa lecture");
  assert.ok(Date.now() - new Date(enVente({ statut: "EnCours", fictif: true, synchro_le: vieux }).statut_lu_le) < 5000, "bien fictif : maintenant");
  assert.equal(enVente({ statut: "NonDiffuse" }).en_vente, false);
  assert.deepEqual(enVente({}), { en_vente: null });
  const B2 = require("../src/lib/leads/bot");
  assert.ok(B2.plan([{ type: "bien_plus_en_vente", donnees: { reference: "X" } }], {}).avis.length === 1, "l'équipe est prévenue d'un intérêt pour un bien plus en vente");
  console.log("statut de vente OK");
}
