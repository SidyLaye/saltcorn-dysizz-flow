"use strict";
const assert = require("node:assert/strict");
const { candidatsCrm, echecsCrm } = require("../src/lib/leads/tables/reprise_crm");

const row = (id, date, op, error = true) => ({ id, mail_id: id + 100, recu_le: date,
  mode: "reel", dossier: JSON.stringify({ execution: { resultats: [
    { op, fait: !error, ...(error ? { erreur: "HTTP 422" } : {}) },
  ] } }) });
const rows = [
  row(1, "2026-10-01T03:59:59Z", "ajouterConsentement"),
  row(2, "2026-10-01T04:00:00Z", "ajouterConsentement"),
  row(3, "2026-10-01T05:00:00Z", "creerContact"),
  row(4, "2026-10-01T05:30:00Z", "ajouterConsentement", false),
  row(5, "2026-10-01T06:00:00Z", "envoyerEmail"),
  {id:6,mail_id:106,mode:"reel",nature:"lead",bien_crm:"42",contact_crm:"",recu_le:"2026-10-01T06:00:00Z",dossier:"{}"},
];
assert.deepEqual(candidatsCrm(rows, new Date("2026-10-01T04:00:00Z"), new Date("2026-10-01T07:00:00Z"))
  .map((x) => x.id), [2, 3, 6]);
assert.deepEqual(echecsCrm(rows[2]).map((x) => x.op), ["creerContact"]);
console.log("reprise CRM : fenêtre et sélection des seuls échecs CRM OK");
