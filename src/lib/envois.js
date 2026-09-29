/* Mails « une seule fois » : chaque envoi porte une clé (ex. lead-12:martin@agence.fr).
   - clé déjà envoyée (ou simulée, ou abandonnée) : rien ne repart ;
   - échec : noté (dzf_envois), repris par « Mail : reprendre les envois en échec », abandonné après
     5 essais ou une erreur SMTP définitive (5xx) ;
   - « simuler » : rien ne part, l'envoi est noté « simulé » (copie de dev, mise en route). */
"use strict";
const MAX_ESSAIS = 5;
const definitive = (e) => /^5\d\d$/.test(String((e && (e.responseCode || e.code)) || "")) || /^5\d\d\b/.test(String((e && e.message) || ""));

const expediteur = () => {
  const from = require("@saltcorn/data/db/state").getState().getConfig("email_from");
  if (!from) throw Object.assign(new Error("adresse d'expéditeur non réglée (Paramètres → E-mail)"), { permanent: true });
  return from;
};

const essayer = async (T, ligne, simuler) => {
  if (simuler) { await T.envois.updateRow({ statut: "simule", envoye_le: new Date() }, ligne.id); return "simule"; }
  try {
    const { getMailTransport } = require("@saltcorn/data/models/email");
    await (await getMailTransport()).sendMail({ from: expediteur(), to: ligne.a, subject: ligne.sujet, html: ligne.html });
    await T.envois.updateRow({ statut: "envoye", erreur: null, tentatives: (ligne.tentatives || 0) + 1, envoye_le: new Date() }, ligne.id);
    return "envoye";
  } catch (e) {
    const n = (ligne.tentatives || 0) + 1;
    const statut = definitive(e) || n >= MAX_ESSAIS || e.permanent ? "abandonne" : "echec";
    await T.envois.updateRow({ statut, erreur: String(e.message || e).slice(0, 300), tentatives: n }, ligne.id);
    return statut;
  }
};

/* messages = [{ cle, a, sujet, html, reference }] */
const envoyer = async (messages, { simuler = false } = {}) => {
  const { ensureTables } = require("../store");
  const T = await ensureTables();
  const bilan = { envoyes: 0, simules: 0, echecs: 0, abandonnes: 0, deja: 0 };
  for (const m of messages || []) {
    const a = String((m && m.a) || "").trim();
    if (!a || !m.cle) continue;
    let ligne = await T.envois.getRow({ cle: String(m.cle) });
    if (ligne && ["envoye", "simule", "abandonne"].includes(ligne.statut)) { bilan.deja++; continue; }
    if (!ligne) {
      await T.envois.insertRow({ cle: String(m.cle).slice(0, 300), reference: m.reference ? String(m.reference).slice(0, 200) : null, a, sujet: String(m.sujet || "").slice(0, 400), html: String(m.html || ""), statut: "a_envoyer", tentatives: 0, cree_le: new Date() });
      ligne = await T.envois.getRow({ cle: String(m.cle) });
    }
    const s = await essayer(T, ligne, simuler);
    bilan[{ envoye: "envoyes", simule: "simules", echec: "echecs", abandonne: "abandonnes" }[s]]++;
  }
  bilan.resume = [bilan.envoyes && `${bilan.envoyes} envoyé(s)`, bilan.simules && `${bilan.simules} simulé(s)`, bilan.echecs && `${bilan.echecs} en échec`, bilan.abandonnes && `${bilan.abandonnes} abandonné(s)`, bilan.deja && `${bilan.deja} déjà fait(s)`].filter(Boolean).join(", ") || "rien à envoyer";
  return bilan;
};

const reprendre = async (limite = 100) => {
  const { ensureTables } = require("../store");
  const T = await ensureTables();
  const lignes = await T.envois.getRows({ statut: "echec" }, { orderBy: "id", limit: Math.max(1, Math.min(+limite || 100, 500)) });
  const bilan = { repris: lignes.length, envoyes: 0, echecs: 0, abandonnes: 0 };
  for (const l of lignes) { const s = await essayer(T, l, false); if (s === "envoye") bilan.envoyes++; else if (s === "abandonne") bilan.abandonnes++; else bilan.echecs++; }
  return bilan;
};

module.exports = { envoyer, reprendre, definitive, MAX_ESSAIS };
