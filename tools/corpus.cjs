#!/usr/bin/env node
/* Non-régression sur un corpus réel de mails (jamais versionné : données personnelles).
   node tools/corpus.cjs --mails mails.jsonl --conf conf.json [--biens biens.json] [--reference ref.json] [--ecrire-reference]
   - mails.jsonl : une ligne JSON par mail { id, expediteur, destinataire, objet, date_envoi, corps_texte, corps_html }
   - biens.json : catalogue [{ id, reference, prix, surface, pieces, type, ville, code_postal, agence_id, negociateur_id }]
   Sortie : chiffres agrégés par portail (aucune donnée personnelle), comparés à la référence.
   Code de sortie 1 si un taux de remplissage baisse de plus de 1 point sur un portail d'au moins 20 mails,
   ou si la part d'une nature bouge de plus de 2 points. */
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const L = path.join(__dirname, "..", "src", "lib", "leads");
const { traiter, executer } = require(path.join(L, "traiter"));
const M = require(path.join(L, "crm", "memoire"));
const { memoire } = require(path.join(L, "dossiers"));

const arg = (k, def) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : def; };
const drapeau = (k) => process.argv.includes("--" + k);
if (!arg("mails")) { console.error("usage : node tools/corpus.cjs --mails mails.jsonl --conf conf.json [--biens biens.json] [--reference ref.json] [--ecrire-reference]"); process.exit(2); }

const CHAMPS = { email: (r) => r.contact.email || r.contact.email_relais, telephone: (r) => r.contact.telephone, nom: (r) => r.contact.nom || r.contact.nom_complet, reference: (r) => r.bien.reference || r.bien.id_crm, prix: (r) => r.bien.prix || r.bien.loyer, ville: (r) => r.bien.ville || r.bien.code_postal, message: (r) => r.message };

(async () => {
  const conf = JSON.parse(fs.readFileSync(arg("conf"), "utf8"));
  const biens = arg("biens") ? JSON.parse(fs.readFileSync(arg("biens"), "utf8")) : [];
  const crm = M.creer({ biens }), dossiers = memoire();
  const mails = fs.readFileSync(arg("mails"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => String(a.date_envoi).localeCompare(String(b.date_envoi)));
  const P = {}, natures = {}, statuts = {}; const durees = [];
  for (const m of mails) {
    const d = await traiter(m, crm, conf, { dossiers });
    const ex = await executer(d, crm, { mode: "reel" });
    if (d.dossier && !(d.statut === "a_trier" && !d.dossier.existant)) await dossiers.enregistrer(d, ex, new Date(m.date_envoi || Date.now()));
    const r = d.extraction;
    natures[r.nature] = (natures[r.nature] || 0) + 1; statuts[d.statut] = (statuts[d.statut] || 0) + 1; durees.push(d.duree_ms || 0);
    if (!["lead", "relance", "recherche", "estimation"].includes(r.nature)) continue;
    const p = P[r.portail || "?"] = P[r.portail || "?"] || { mails: 0, bien: 0, pret: 0, remplis: {} };
    p.mails++; if (d.bien) p.bien++; if (d.statut === "pret") p.pret++;
    for (const [k, f] of Object.entries(CHAMPS)) if (f(r)) p.remplis[k] = (p.remplis[k] || 0) + 1;
  }
  durees.sort((a, b) => a - b);
  const res = {
    mails: mails.length, natures, statuts, dossiers: dossiers.liste.length,
    temps_ms: { median: durees[Math.floor(durees.length / 2)] || 0, p99: durees[Math.floor(durees.length * 0.99)] || 0 },
    portails: Object.fromEntries(Object.entries(P).map(([k, p]) => [k, { mails: p.mails, bien: +(p.bien / p.mails * 100).toFixed(1), pret: +(p.pret / p.mails * 100).toFixed(1), remplissage: Object.fromEntries(Object.keys(CHAMPS).map((c) => [c, +((p.remplis[c] || 0) / p.mails * 100).toFixed(1)])) }])),
  };
  console.log(JSON.stringify(res, null, 1));
  if (drapeau("ecrire-reference") && arg("reference")) { fs.writeFileSync(arg("reference"), JSON.stringify(res, null, 1)); console.error("référence écrite"); return; }
  if (!arg("reference") || !fs.existsSync(arg("reference"))) return;
  const ref = JSON.parse(fs.readFileSync(arg("reference"), "utf8"));
  const pbs = [];
  for (const [k, p] of Object.entries(ref.portails || {})) {
    const n = res.portails[k];
    if (p.mails < 20) continue;
    if (!n) { pbs.push(`${k} : plus aucun lead reconnu (${p.mails} avant)`); continue; }
    for (const [c, v] of Object.entries(p.remplissage)) if ((n.remplissage[c] || 0) < v - 1) pbs.push(`${k} / ${c} : ${v} % → ${n.remplissage[c] || 0} %`);
    if (n.bien < p.bien - 1) pbs.push(`${k} / bien trouvé : ${p.bien} % → ${n.bien} %`);
  }
  for (const [k, v] of Object.entries(ref.natures || {})) { const a = v / ref.mails * 100, b = (res.natures[k] || 0) / res.mails * 100; if (Math.abs(a - b) > 2) pbs.push(`nature ${k} : ${a.toFixed(1)} % → ${b.toFixed(1)} %`); }
  if (pbs.length) { console.error("RÉGRESSION :\n" + pbs.join("\n")); process.exit(1); }
  console.error("aucune régression par rapport à la référence");
})().catch((e) => { console.error(e); process.exit(2); });
