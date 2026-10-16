"use strict";
/* Calendrier des relances du bot WhatsApp (script V1.3, slide 21 ; parcours du 13/10, page 11) */
const assert = require("node:assert/strict");
const { planifier, dansLaPlage } = require("../src/lib/leads/relances");

const J = 86400000, T0 = new Date("2026-10-12T10:00:00+02:00").getTime();   // lundi 10 h (Paris)
const ev = (type, j, donnees = {}, noeud = "") => ({ type, noeud, quand: new Date(T0 + j * J), donnees });
const ouverture = ev("ouverture", 0, {}, "N0");

/* aucune réponse : R1 à J+2, R2 à J+5, R3 à J+10, puis clôture */
assert.deepEqual(planifier([ouverture], T0 + 1 * J), { code: "r1", quand: new Date(T0 + 2 * J) });
assert.equal(planifier([ouverture], T0 + 2 * J).code, "r1");
assert.deepEqual(planifier([ouverture, ev("relance", 2, { code: "r1" })], T0 + 3 * J), { code: "r2", quand: new Date(T0 + 5 * J) });
assert.deepEqual(planifier([ouverture, ev("relance", 2, { code: "r1" }), ev("relance", 5, { code: "r2" })], T0 + 6 * J).code, "r3");
assert.deepEqual(planifier([ouverture, ev("relance", 2, { code: "r1" }), ev("relance", 5, { code: "r2" }), ev("relance", 10, { code: "r3" })], T0 + 11 * J).code, "cloture");
assert.equal(planifier([ouverture, ev("relance", 2, { code: "r1" }), ev("relance", 5, { code: "r2" }), ev("relance", 10, { code: "r3" }), ev("relance", 12, { code: "cloture" })], T0 + 20 * J), null, "après la clôture : plus rien");
/* le silence se compte depuis le dernier message du bot : un lead qui a répondu repart pour un délai complet */
assert.deepEqual(planifier([ouverture, ev("inbound", 1), ev("message_bot", 1)], T0 + 2 * J).quand, new Date(T0 + 3 * J));
/* jamais après un STOP, une visite transmise ou un humain qui a la main */
assert.equal(planifier([ouverture, ev("optout", 1)], T0 + 5 * J), null);
assert.equal(planifier([ouverture, ev("sortie", 1, { code: "OUT-1" })], T0 + 5 * J), null);
assert.equal(planifier([ouverture, ev("sortie", 1, { code: "OUT-4" })], T0 + 5 * J), null);
/* rappel demandé (OUT-2) : R1 seulement (slide 18 : « pas de messages spontanés, sauf relance R1 ») ; documentation (OUT-3) : séquence complète */
assert.equal(planifier([ouverture, ev("sortie", 1, { code: "OUT-2" })], T0 + 4 * J).code, "r1");
assert.equal(planifier([ouverture, ev("sortie", 1, { code: "OUT-2" }), ev("relance", 3, { code: "r1" })], T0 + 9 * J), null);
assert.equal(planifier([ouverture, ev("sortie", 1, { code: "OUT-3" }), ev("relance", 3, { code: "r1" })], T0 + 9 * J).code, "r2");
/* une R2 sautée (bien plus en vente) n'est pas un message : la R3 se compte depuis la R1 */
assert.deepEqual(planifier([ouverture, ev("relance", 2, { code: "r1" }), ev("relance", 5, { code: "r2", saute: true })], T0 + 6 * J), { code: "r3", quand: new Date(T0 + 7 * J) });
/* une conversation plus ancienne du même numéro ne compte pas : seule la dernière ouverture */
assert.equal(planifier([ev("ouverture", -30, {}, "N0"), ev("relance", -28, { code: "r1" }), ouverture], T0 + 2 * J).code, "r1");
/* sans ouverture envoyée : rien */
assert.equal(planifier([ev("inbound", 0)], T0 + 5 * J), null);
/* délais réglables */
assert.deepEqual(planifier([ouverture], T0, { delais_jours: [1, 3, 7] }).quand, new Date(T0 + 1 * J));
/* plage d'envoi : du lundi au samedi, 9 h à 19 h, heure de Paris */
assert.equal(dansLaPlage(new Date("2026-10-14T10:00:00+02:00")), true, "mercredi 10 h");
assert.equal(dansLaPlage(new Date("2026-10-14T20:30:00+02:00")), false, "mercredi 20 h 30");
assert.equal(dansLaPlage(new Date("2026-10-14T08:30:00+02:00")), false, "mercredi 8 h 30");
assert.equal(dansLaPlage(new Date("2026-10-18T11:00:00+02:00")), false, "dimanche");
assert.equal(dansLaPlage(new Date("2026-10-17T11:00:00+02:00")), true, "samedi");
console.log("calendrier des relances OK");
