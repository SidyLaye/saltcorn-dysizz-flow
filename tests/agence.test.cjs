/* Agence d'un lead : quand le CRM ne renvoie pas l'agence du bien, on prend celle de son négociateur,
   pas celle de la boîte centrale qui a reçu le mail. Données fictives. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { trouverAgence } = require("../src/lib/leads/traiter");

const CONF = {
  agences: [
    { id: "100", nom: "Agence Nord", boites: ["contact@exemple.fr"] },   // déclare la boîte centrale
    { id: "200", nom: "Agence Sud", boites: ["sud@exemple.fr"] },
  ],
  routage: { personnes: [{ id: "900", nom: "Négociateur Sud", agence_id: "200" }, { id: "901", nom: "Sans agence" }] },
};
const centrale = { destinataire: "contact@exemple.fr" };

// l'incident : bien trouvé mais sans agence, mail reçu sur la boîte centrale
let r = trouverAgence(centrale, { id: 1, negociateur_id: "900", agence_id: null }, CONF);
assert.strictEqual(r.agence.id, "200", "agence du négociateur, pas celle de la boîte centrale");
assert.strictEqual(r.par, "négociateur du bien");

// l'agence du bien reste prioritaire
r = trouverAgence(centrale, { id: 1, negociateur_id: "900", agence_id: "100" }, CONF);
assert.strictEqual(r.agence.id, "100"); assert.strictEqual(r.par, "bien");

// négociateur sans agence connue, ou pas de bien : on retombe sur la boîte
r = trouverAgence(centrale, { id: 1, negociateur_id: "901", agence_id: null }, CONF);
assert.strictEqual(r.par, "boîte de réception");
r = trouverAgence(centrale, null, CONF);
assert.strictEqual(r.agence.id, "100"); assert.strictEqual(r.par, "boîte de réception");

console.log("agence : ok");
