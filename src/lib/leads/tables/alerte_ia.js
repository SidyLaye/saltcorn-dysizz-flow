/* Alerte WhatsApp à l'administrateur quand l'IA de lecture des mails tombe en panne, ou quand le plafond du jour est
   atteint (panne du 04/11 : crédit OpenAI épuisé, cinq jours sans lecture, personne prévenu).
   Réglage : bot.whatsapp.alertes_admin = numéros internationaux (« 336… ») ; modèle Meta « ambs_alerte_technique »
   (deux valeurs : ce qui se passe, ce qu'il faut faire), envoyé du numéro des alertes (bot.whatsapp.numero_alertes).
   Panne = les 3 derniers appels du journal ld_ia ont échoué. Une alerte au plus toutes les 6 heures, pour tous les
   processus (verrou partagé + trace « alerte_ia » dans ld_bot). Une alerte qui échoue n'empêche jamais la lecture. */
"use strict";
const { tables, nom } = require("./schema");
const { reglages, json } = require("./conf");

const SEUIL = 3, DELAI_H = 6;
const db = () => require("@saltcorn/data/db");
const tenant = () => { try { return db().getTenantSchema(); } catch (e) { return "public"; } };
const court = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);

/* panne : les derniers appels (du plus récent au plus ancien) ont tous échoué */
const enPanne = (lignes, seuil = SEUIL) => lignes.length >= seuil && lignes.slice(0, seuil).every((l) => !l.ok);
const valeurs = (cause, { erreur, plafond } = {}) => cause === "plafond"
  ? [`le plafond de ${plafond || 200} lectures par l'IA est atteint aujourd'hui ; les mails suivants restent à trier jusqu'à demain`, "relever le plafond dans les réglages si besoin, puis lancer le rattrapage des leads"]
  : [`l'IA de lecture des mails ne répond plus (${court(erreur, 120) || "erreur inconnue"}) ; les mails inconnus restent à trier`, "vérifier le crédit OpenAI, puis lancer le rattrapage des leads"];

const signaler = async (cause) => {
  const R = await reglages();
  const W = (json(R.bot, {}) || {}).whatsapp || {};
  const admins = (Array.isArray(W.alertes_admin) ? W.alertes_admin : []).map((x) => String(x).replace(/\D/g, "")).filter((x) => x.length >= 9);
  if (!admins.length || !W.variable_jeton) return { envoyee: false, raison: "alerte non réglée" };
  const S = tenant();
  let erreur;
  if (cause === "panne") {
    const lignes = (await db().query(`select ok, erreur from "${S}".${nom("ia")} order by id desc limit ${SEUIL}`)).rows;
    if (!enPanne(lignes)) return { envoyee: false, raison: "sous le seuil" };
    erreur = lignes[0].erreur;
  }
  return require("../../verrou").sous(`ld-alerte-ia:${S}`, async () => {
    const deja = await db().query(`select 1 from "${S}".${nom("bot")} where type = 'alerte_ia' and quand > now() - interval '${DELAI_H} hours' limit 1`);
    if (deja.rows.length) return { envoyee: false, raison: "déjà prévenu" };
    const v = valeurs(cause, { erreur, plafond: R.ia_plafond_jour });
    const trace = { cause, valeurs: v, a: admins.map((x) => "…" + x.slice(-4)), envoyees: 0 };
    try {
      const jeton = await require("../../../garde").lireSecret(W.variable_jeton);
      const { envoyerModele } = require("./bot");
      for (const a of admins) {
        await envoyerModele({ phone_number_id: W.numero_alertes || W.phone_number_id, jeton, a, nom: "ambs_alerte_technique", langue: "fr", valeurs: v, suivi: `ambs|${Date.now()}|alerte_ia` });
        trace.envoyees++;
      }
    } catch (e) { trace.erreur = court(e.message, 300); }
    /* tracée même en échec (modèle refusé, jeton expiré) : on ne réessaie pas avant 6 heures */
    await (await tables()).bot.insertRow({ tel9: "admin", type: "alerte_ia", quand: new Date(), donnees: JSON.stringify(trace) });
    return { envoyee: trace.envoyees > 0, ...trace };
  });
};

module.exports = { signaler, enPanne, valeurs, SEUIL };
