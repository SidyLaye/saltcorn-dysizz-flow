"use strict";
/* Calendrier des relances du bot WhatsApp (script V1.3, slide 21 « OUT-5 sans réponse » ; parcours du 13/10, page 11).
   Le lead ne répond plus : R1, puis R2 (seulement si le bien est encore en vente : vérifié à l'envoi), puis R3, puis clôture sans message.
   Jamais après un STOP, une visite transmise (OUT-1) ou une reprise humaine (OUT-4) ; après un rappel demandé (OUT-2), R1 seulement
   (slide 18) ; une seule relance de chaque sorte par conversation. Le silence se compte depuis le dernier message du bot.
   Délais réglables (bot.relances.delais_jours, cumulés depuis le dernier message du bot avant la première relance) : 2, 5, 10 jours. */
const ORDRE = ["r1", "r2", "r3", "cloture"];

const planifier = (historique, maintenant = Date.now(), reglages = {}) => {
  const d = Array.isArray(reglages.delais_jours) && reglages.delais_jours.length === 3 ? reglages.delais_jours.map(Number) : [2, 5, 10];
  const h = [...(historique || [])].filter((e) => e && e.quand).sort((a, b) => new Date(a.quand) - new Date(b.quand));
  const iOuv = h.map((e) => e.type === "ouverture" && e.noeud === "N0").lastIndexOf(true);
  if (iOuv < 0) return null;
  const conv = h.slice(iOuv);
  if (conv.some((e) => e.type === "optout")) return null;
  const sorties = conv.filter((e) => e.type === "sortie").map((e) => (e.donnees || {}).code);
  if (sorties.some((c) => c === "OUT-1" || c === "OUT-4" || c === "OUT-6")) return null;
  const faites = conv.filter((e) => e.type === "relance").map((e) => (e.donnees || {}).code);
  const n = ORDRE.findIndex((c) => !faites.includes(c));
  if (n < 0) return null;
  if (sorties.includes("OUT-2") && n >= 1) return null;   // rappel demandé : R1 seulement
  /* dernier message du bot (ouverture, réponse ou relance) : le silence du lead se compte à partir de là */
  const bot = conv.filter((e) => ["ouverture", "message_bot", "relance"].includes(e.type) && !(e.type === "relance" && (e.donnees || {}).saute)).pop();   // une relance sautée n'est pas un message
  const ecart = n === 0 ? d[0] : n === 1 ? d[1] - d[0] : n === 2 ? d[2] - d[1] : 2;   // clôture : 2 jours après R3
  return { code: ORDRE[n], quand: new Date(new Date(bot.quand).getTime() + ecart * 86400000) };
};

/* plage d'envoi : du lundi au samedi, de 9 h à 19 h, heure de Paris */
const dansLaPlage = (quand = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(quand)).map((x) => [x.type, x.value]));
  const h = +p.hour;
  return !/^dim/i.test(p.weekday) && h >= 9 && h < 19;
};

module.exports = { planifier, dansLaPlage, ORDRE };
