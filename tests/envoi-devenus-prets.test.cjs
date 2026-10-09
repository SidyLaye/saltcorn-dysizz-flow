/* Leads devenus « prêts » après une reprise : envoyés une seule fois, jamais deux, jamais l'ancien système. */
const assert = require("assert");
const Module = require("module");
const path = require("path");

/* base simulée : une table de leads et une table d'envois, interrogées par du SQL réel du module */
const LEADS = [
  { id: 1, statut: "pret", jours: 1, traite_min: 60, motifs: "", dossier: { statut: "pret", bien: { id: 9 }, destinataires: { liste: [{ email: "nego@ex.org" }] } } }, // devenu prêt, jamais envoyé
  { id: 2, statut: "pret", jours: 1, traite_min: 60, motifs: "", dossier: { statut: "pret", bien: { id: 9 }, destinataires: { liste: [{ email: "nego@ex.org" }] } } }, // déjà envoyé normalement
  { id: 3, statut: "pret", jours: 1, traite_min: 60, motifs: "repris de l'ancien système (publie)", dossier: { statut: "pret", bien: { id: 9 } } },
  { id: 4, statut: "pret", jours: 9, traite_min: 60, motifs: "", dossier: { statut: "pret", bien: { id: 9 } } }, // hors fenêtre
  { id: 5, statut: "a_verifier", jours: 1, traite_min: 60, motifs: "x", dossier: {} }, // pas prêt
  { id: 6, statut: "pret", jours: 1, traite_min: 2, motifs: "", dossier: { statut: "pret", bien: { id: 9 } } }, // en cours d'envoi normal
  { id: 7, statut: "pret", jours: 1, traite_min: 60, motifs: "", dossier: { statut: "pret", bien: { id: 9 } } }, // seulement transféré à « non automatisé » avant
];
const ENVOIS = ["ld_lead-2:nego@ex.org", "ld_lead-7:non-automatise:nonauto@ex.org"];
const requete = (sql, [jours, cle]) => {
  assert.ok(/statut = 'pret'/.test(sql) && /ancien système/.test(sql) && /non-automatise/.test(sql) && /10 minutes/.test(sql), "filtres présents dans la requête");
  const rows = LEADS.filter((l) => l.statut === "pret" && l.jours < +jours && l.traite_min > 10 && !/ancien système/.test(l.motifs)
    && !ENVOIS.some((c) => c.startsWith(cle + l.id + ":") && !c.startsWith(cle + l.id + ":non-automatise:")))
    .map((l) => ({ id: l.id, mail_id: 100 + l.id, dossier: JSON.stringify(l.dossier) }));
  return { rows };
};
const envoyes = [];
const orig = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === "@saltcorn/data/db") return { getTenantSchema: () => "public", query: async (sql, params) => requete(sql, params) };
  if (req === "./envoi" && /tables/.test(parent.filename)) return { messages: async (d, res) => ({ simuler: false, raison: "1 destinataire(s)", liste: ((d.destinataires && d.destinataires.liste) || [{ email: "x@ex.org" }]).map((x) => ({ cle: `ld_lead-${res.id}:${x.email}`, a: x.email })) }) };
  if (req === "../../envois" && /tables/.test(parent.filename)) return { envoyer: async (liste) => { envoyes.push(...liste.map((m) => m.cle)); return { resume: `${liste.length} envoyé(s)` }; } };
  return orig.call(this, req, parent, ...rest);
};
const T = require(path.join(__dirname, "../src/lib/leads/tables/taches"));

(async () => {
  const r = await T.envoyerDevenusPrets({ jours: 3 });
  assert.deepStrictEqual(r.leads_envoyes.map((x) => x.lead_id), [1, 7], "devenus prêts jamais servis : le 1 et le 7 (le 7 n'avait été que transféré à « non automatisé »)");
  assert.deepStrictEqual(envoyes, ["ld_lead-1:nego@ex.org", "ld_lead-7:x@ex.org"], "même clé que l'envoi normal : jamais de doublon");
  assert.ok(!r.leads_envoyes.some((x) => [2, 3, 4, 5, 6].includes(x.lead_id)), "déjà envoyé, ancien système, hors fenêtre, pas prêt, envoi normal en cours : rien");
  console.log("leads devenus prêts OK : envoyés une fois, clé identique à l'envoi normal, ancien système et vieux leads écartés");
})().catch((e) => { console.error(e); process.exit(1); });
