/* Verrous partagés entre tous les processus et tous les serveurs (Postgres, verrous consultatifs).
   - sous(cle, fn) : exécute fn seul pour cette clé (ex. un dossier) ; les autres attendent (délai borné) ;
   - prendre(cle) : essaie de prendre un verrou qu'on garde longtemps (ex. l'écouteur d'une boîte :
     un seul serveur la tient ; si ce serveur tombe, sa connexion se ferme et le verrou se libère).
   Clés préfixées par le schéma du client (multi-tenant). Sans Postgres (SQLite, tests) : verrou en mémoire. */
"use strict";
const G = globalThis[Symbol.for("dysizz-flow.verrous")] || (globalThis[Symbol.for("dysizz-flow.verrous")] = { files: new Map(), tenus: new Set() });

const base = () => { try { return require("@saltcorn/data/db"); } catch (e) { return null; } };
const postgres = (db) => db && typeof db.getClient === "function" && !db.isSQLite;
const cleComplete = (db, cle) => { let t = "public"; try { t = db.getTenantSchema(); } catch (e) { /* rien */ } return `${t}:${cle}`; };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* File d'attente en mémoire (un seul processus) */
const enMemoire = async (cle, fn) => {
  const avant = G.files.get(cle) || Promise.resolve();
  let fini; const tour = new Promise((r) => { fini = r; });
  G.files.set(cle, avant.then(() => tour));
  await avant.catch(() => {});
  try { return await fn(); } finally { fini(); if (G.files.get(cle) === tour) G.files.delete(cle); }
};

const sous = async (cle, fn, { attente_ms = 30000 } = {}) => {
  const db = base();
  if (!postgres(db)) return enMemoire(cle, fn);
  const k = cleComplete(db, cle);
  const client = await db.getClient();
  let pris = false;
  try {
    const fin = Date.now() + attente_ms;
    while (!pris) {
      const r = await client.query("select pg_try_advisory_lock(hashtext($1)) as ok", [k]);
      pris = !!(r.rows[0] && r.rows[0].ok);
      if (!pris) { if (Date.now() > fin) throw Object.assign(new Error(`verrou « ${cle} » occupé depuis plus de ${attente_ms / 1000} s`), { temporaire: true }); await pause(100 + Math.random() * 200); }
    }
    return await fn();
  } finally {
    if (pris) await client.query("select pg_advisory_unlock(hashtext($1))", [k]).catch(() => {});
    client.release();
  }
};

/* Verrou gardé : rend { rendre() } ou null si un autre serveur le tient déjà. */
const prendre = async (cle) => {
  const db = base();
  if (!postgres(db)) { if (G.tenus.has(cle)) return null; G.tenus.add(cle); return { rendre: async () => { G.tenus.delete(cle); } }; }
  const k = cleComplete(db, cle);
  const client = await db.getClient();
  try {
    const r = await client.query("select pg_try_advisory_lock(hashtext($1)) as ok", [k]);
    if (!(r.rows[0] && r.rows[0].ok)) { client.release(); return null; }
  } catch (e) { client.release(); throw e; }
  let rendu = false;
  return { rendre: async () => { if (rendu) return; rendu = true; await client.query("select pg_advisory_unlock(hashtext($1))", [k]).catch(() => {}); client.release(); } };
};

module.exports = { sous, prendre, enMemoire };
