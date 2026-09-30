/* Mémoire de Saltcorn : chaque processus du serveur garde la liste des tables et des déclencheurs.
   refresh_x(true) ne met à jour que le processus en cours : les autres ne voient la nouvelle table
   (ou le nouveau workflow) qu'après un redémarrage. Pendant une requête HTTP, la transaction n'est
   validée qu'à la fin : on met donc à jour ce processus tout de suite, puis on prévient tous les
   processus un peu plus tard, hors de la requête, quand les écritures sont visibles de tous. */
"use strict";
const rafraichir = async (quoi = ["tables"]) => {
  let st = null, db = null;
  try { db = require("@saltcorn/data/db"); st = require("@saltcorn/data/db/state").getState; } catch (e) { return; }
  for (const q of quoi) { try { await st()["refresh_" + q](true); } catch (e) { /* rien */ } }
  let schema = null;
  try { schema = db.getTenantSchema(); } catch (e) { schema = null; }
  if (!schema || typeof db.runWithTenant !== "function") return;
  for (const ms of [1500, 10000]) {
    const t = setTimeout(() => {
      Promise.resolve(db.runWithTenant(schema, async () => { for (const q of quoi) { try { await st()["refresh_" + q](); } catch (e) { /* rien */ } } })).catch(() => {});
    }, ms);
    if (t && t.unref) t.unref();
  }
};

/* Table.findOne lit la mémoire du processus : si la table existe en base mais pas dans cette mémoire
   (créée par un autre processus), on relit la liste avant de conclure qu'elle est absente. */
const trouverTable = async (nom) => {
  const Table = require("@saltcorn/data/models/table");
  let t = Table.findOne({ name: nom });
  if (t) return t;
  try {
    const db = require("@saltcorn/data/db");
    const r = await db.selectMaybeOne("_sc_tables", { name: nom });
    if (!r) return null;
    await require("@saltcorn/data/db/state").getState().refresh_tables(true);
    t = Table.findOne({ name: nom });
  } catch (e) { return null; }
  return t || null;
};

module.exports = { rafraichir, trouverTable };
