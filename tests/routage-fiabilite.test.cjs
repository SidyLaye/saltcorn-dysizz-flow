"use strict";
const assert = require("node:assert/strict");
const { destinataires, absentsSemaine } = require("../src/lib/leads/routage");
const conf = {
  fuseau_horaire: "Europe/Paris",
  personnes: [
    { id: 1, nom: "Alex", email: "alex@example.test", temps: "mi_temps", jours: [1], remplacant_hors_jours: { personne: 2 } },
    { id: 2, nom: "Alex", email: "relais@example.test" },
  ],
  siege: ["siege@example.test"],
};
const emails = (c, date, id = 1) => destinataires(id, date, c).liste.map(r => r.email);
// Le lundi commence le dimanche à 22 h UTC à Paris en été.
assert.deepEqual(emails(conf, "2026-09-27T22:30:00Z"), ["alex@example.test", "siege@example.test"]);
assert.deepEqual(emails(conf, "2026-09-28T22:30:00Z"), ["relais@example.test", "siege@example.test"]);
// Deux personnes de même nom ne constituent pas une boucle.
assert.deepEqual(emails(conf, "2026-09-29"), ["relais@example.test", "siege@example.test"]);
const cycle = structuredClone(conf);
cycle.personnes[1].actif = false;
cycle.personnes[1].remplacant_inactif = { personne: 1 };
assert.deepEqual(emails(cycle, "2026-09-29"), ["siege@example.test"]);
assert(destinataires(1, "2026-09-29", cycle).trace.some(t => t.includes("boucle")));
// Début et fin de congés inclus, calculés dans le fuseau configuré.
const vacances = { ...conf, absences: [{ personne_id: 1, debut: "2026-09-28", fin: "2026-09-28", remplacant: { email: "conges@example.test" } }] };
assert.deepEqual(emails(vacances, "2026-09-27T22:30:00Z"), ["conges@example.test", "siege@example.test"]);
assert.deepEqual(emails(vacances, "2026-09-28T21:59:59Z"), ["conges@example.test", "siege@example.test"]);
assert.deepEqual(emails(vacances, "2026-09-28T22:00:00Z"), ["relais@example.test", "siege@example.test"]);
// Une date saisie comme date reste littérale, même dans un fuseau négatif.
assert.deepEqual(emails({ ...conf, fuseau_horaire: "America/New_York" }, "2026-09-28"), ["alex@example.test", "siege@example.test"]);
// Passage à l'heure d'hiver : la frontière locale reste à minuit.
const hiver = { ...conf, absences: [{ personne_id: 1, debut: "2026-10-26", fin: "2026-10-26", remplacant: { email: "hiver@example.test" } }] };
assert.deepEqual(emails(hiver, "2026-10-25T23:30:00Z"), ["hiver@example.test", "siege@example.test"]);
const vide = structuredClone(conf);
vide.personnes[0].jours = [];
assert.deepEqual(emails(vide, "2026-09-28"), ["relais@example.test", "siege@example.test"]);
const priorites = { ...conf, regles: [
  { id: 8, cible: { negociateurs: [1, 2] }, couper_negociateur: true },
  { id: 9, cible: { negociateurs: [1] }, couper_negociateur: false },
] };
assert.equal(destinataires(1, "2026-09-28", priorites).regle, 9);
assert.deepEqual(emails(priorites, "2026-09-28"), ["alex@example.test", "siege@example.test"]);
const semaine = absentsSemaine(conf, "2026-09-27T22:30:00Z");
assert.equal(semaine[0].jours[0].jour, "2026-09-29");
assert.equal(semaine[0].jours.at(-1).jour, "2026-10-04");
assert.throws(() => destinataires(1, "2026-02-30", conf), /invalide/);
console.log("Routage : minuit local, heure d’hiver, dates littérales, homonymes, cycles, jours vides et priorité individuelle vérifiés.");
