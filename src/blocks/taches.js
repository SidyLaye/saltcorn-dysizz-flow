/* Blocs « Tâches & planification » : lancer un workflow maintenant ou plus
   tard, files d'attente (Redis ou table), calendriers ICS. */
"use strict";
const { asList, pool } = require("../engine");
const { ensureTables } = require("../store");
const redis = require("../lib/redis");

/* sans utilisateur (tâche planifiée), Saltcorn lance ses workflows avec { role_id: 1 } : on fait pareil,
   sinon les étapes ne tournent pas */
const SYSTEME = { role_id: 1 };
const inTransaction = () => { try { const c = require("@saltcorn/data/db").getRequestContext(); return !!(c && c.client); } catch (e) { return false; } };
const findWorkflow = (name) => {
  const Trigger = require("@saltcorn/data/models/trigger");
  const t = Trigger.findOne({ name });
  if (!t) throw Object.assign(new Error(`workflow « ${name} » introuvable`), { permanent: true });
  return t;
};

/* le planificateur : un workflow système qui tourne toutes les ~5 min et lance ce qui est dû */
const ensureScheduler = async () => {
  const Trigger = require("@saltcorn/data/models/trigger");
  if (Trigger.findOne({ name: "dzf_planificateur" })) return;
  await Trigger.create({ name: "dzf_planificateur", action: "dzf_planifs_executer", when_trigger: "Often", configuration: {}, min_role: 1, description: "dysizz-flow : lance les workflows planifiés (bloc « Planifier »)" });
};

/* ---- ICS : lecture simple (événements, dates, lieux) ---- */
const icsDate = (v) => {
  if (!v) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v);
  if (!m) return null;
  if (!m[4]) return new Date(+m[1], +m[2] - 1, +m[3]);
  /* « Z » = heure UTC ; sinon heure locale du serveur (les fuseaux TZID ne sont pas convertis) */
  return m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
};
const parseIcs = (txt) => {
  const lines = String(txt).replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out = [];
  let ev = null;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") ev = {};
    else if (l === "END:VEVENT") { if (ev) out.push(ev); ev = null; }
    else if (ev) {
      const i = l.indexOf(":");
      if (i < 0) continue;
      const key = l.slice(0, i).split(";")[0].toUpperCase();
      const val = l.slice(i + 1).replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";");
      ev[key] = val;
    }
  }
  return out.map((e) => ({ uid: e.UID || "", titre: e.SUMMARY || "", debut: icsDate(e.DTSTART), fin: icsDate(e.DTEND), lieu: e.LOCATION || "", description: e.DESCRIPTION || "", recurrent: !!e.RRULE }));
};
const icsEsc = (s) => String(s || "").replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
const icsFmt = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

module.exports = [
  {
    name: "dzf_lancer_workflow", label: "Lancer un autre workflow", category: "Tâches & planification", icon: "fas fa-play-circle", output: "sous_workflow", timeout: 300,
    description: "Lance un workflow Saltcorn par son nom, avec un contexte, et récupère son contexte final. Pour découper un gros traitement en petits workflows réutilisables.",
    params: [{ name: "workflow", label: "Nom du workflow", required: true }, { name: "contexte", label: "Contexte transmis (JSON)", type: "json", help: 'Ex. {"email":"{{email}}"}. Vide = tout le contexte actuel' }],
    run: async (p, ctx, api) => {
      const t = findWorkflow(p.workflow);
      const r = await t.runWithoutRow({ row: p.contexte || ctx, user: api.user || SYSTEME, req: api.req });
      return r && typeof r === "object" ? r : { resultat: r };
    },
  },
  {
    name: "dzf_pour_chaque", label: "Pour chaque élément : lancer un workflow", category: "Tâches & planification", icon: "fas fa-redo", output: "boucle", timeout: 600,
    description: "Lance un workflow pour chaque élément d'une liste (en parallèle, avec une limite), sans qu'une erreur arrête les autres. Sortie : reussis, echecs (avec l'erreur) et resultats.",
    params: [{ name: "liste", label: "Liste", required: true, help: "Ex. {{travaux}}" }, { name: "workflow", label: "Workflow lancé pour chaque élément", required: true },
      { name: "variable", label: "Nom de l'élément dans le contexte du workflow", default: "item" }, { name: "en_parallele", label: "En même temps", type: "int", default: 4 },
      { name: "garder_contexte", label: "Transmettre aussi le contexte actuel", type: "bool", default: false }],
    run: async (p, ctx, api) => {
      const t = findWorkflow(p.workflow);
      const v = String(p.variable || "item").replace(/[^\w]/g, "") || "item";
      const reussis = [], echecs = [], resultats = [];
      /* dans une transaction (ex. « Tester » de Saltcorn), tout passe par une seule connexion :
         on enchaîne un par un, et une erreur annule tout (sinon la transaction serait cassée) */
      const tx = inTransaction();
      await pool(asList(p.liste), tx ? 1 : Math.max(1, Math.min(32, +p.en_parallele || 4)), async (x, i) => {
        if (tx) { resultats[i] = await t.runWithoutRow({ row: { ...(p.garder_contexte ? ctx : {}), [v]: x, index: i }, user: api.user || SYSTEME, req: api.req }); reussis.push(x); return; }
        try {
          const r = await t.runWithoutRow({ row: { ...(p.garder_contexte ? ctx : {}), [v]: x, index: i }, user: api.user || SYSTEME, req: api.req });
          reussis.push(x); resultats[i] = r;
        } catch (e) { echecs.push({ ...(x && typeof x === "object" ? x : { valeur: x }), erreur: e.message }); resultats[i] = null; }
      });
      return { reussis, echecs, resultats, total: reussis.length + echecs.length };
    },
  },
  {
    name: "dzf_planifier", label: "Planifier un workflow plus tard", category: "Tâches & planification", icon: "fas fa-clock", output: "planifie",
    description: "Programme un workflow à une date, ou dans N minutes / heures / jours, avec son contexte. Avec une clé, une nouvelle planification remplace l'ancienne (ex. une relance par client). Précision : ~5 minutes.",
    params: [{ name: "workflow", label: "Nom du workflow", required: true }, { name: "quand", label: "Date (facultatif)", help: "Ex. {{relance_le}}" },
      { name: "dans", label: "…ou dans", type: "int", default: 60 }, { name: "unite", label: "Unité", type: "select", options: ["minutes", "heures", "jours"], default: "minutes" },
      { name: "contexte", label: "Contexte (JSON)", type: "json" }, { name: "cle", label: "Clé unique (facultatif)", help: "Ex. relance-{{id}}" }],
    run: async (p) => {
      findWorkflow(p.workflow);
      await ensureScheduler();
      const mult = { minutes: 60e3, heures: 3600e3, jours: 864e5 }[p.unite || "minutes"];
      const quand = p.quand ? new Date(p.quand) : new Date(Date.now() + (+p.dans || 0) * mult);
      if (isNaN(quand)) throw new Error("date invalide");
      const { planifs } = await ensureTables();
      if (p.cle) await planifs.deleteRows({ cle: String(p.cle), etat: "en attente" });
      const id = await planifs.insertRow({ workflow: p.workflow, quand, contexte: JSON.stringify(p.contexte || {}), etat: "en attente", cle: p.cle ? String(p.cle) : "", essais: 0, message: "" });
      return { id, quand: quand.toISOString() };
    },
  },
  {
    name: "dzf_planifs_executer", label: "Planificateur : exécuter ce qui est dû", category: "Tâches & planification", icon: "fas fa-cogs", output: "planificateur", timeout: 280, noButton: true,
    description: "Utilisé par le workflow système « dzf_planificateur » (toutes les ~5 min). Lance les workflows planifiés arrivés à échéance, 3 essais max. Tu n'as normalement pas à t'en servir.",
    params: [{ name: "max", label: "Nombre max par passage", type: "int", default: 50 }],
    run: async (p, ctx, api) => {
      const { planifs, verrous } = await ensureTables();
      /* un seul serveur à la fois */
      await verrous.deleteRows({ nom: "dzf_planificateur", jusqu_a: { lt: new Date() } });
      try { await verrous.insertRow({ nom: "dzf_planificateur", jusqu_a: new Date(Date.now() + 280e3), par: String(process.pid) }); } catch (e) { return { deja_en_cours: true }; }
      let ok = 0, ko = 0;
      try {
        for (const j of await planifs.getRows({ etat: "en attente", quand: { lt: new Date() } }, { orderBy: "quand", limit: +p.max || 50 })) {
          await planifs.updateRow({ etat: "en cours" }, j.id);
          try {
            await findWorkflow(j.workflow).runWithoutRow({ row: JSON.parse(j.contexte || "{}"), user: api.user || SYSTEME });
            await planifs.updateRow({ etat: "fait", message: "" }, j.id); ok++;
          } catch (e) {
            const n = (j.essais || 0) + 1;
            await planifs.updateRow({ etat: n >= 3 ? "erreur" : "en attente", essais: n, quand: new Date(Date.now() + n * 10 * 60e3), message: String(e.message).slice(0, 500) }, j.id); ko++;
          }
        }
        await planifs.deleteRows({ etat: "fait", quand: { lt: new Date(Date.now() - 30 * 864e5) } });
      } finally { await verrous.deleteRows({ nom: "dzf_planificateur" }); }
      return { lances: ok, erreurs: ko };
    },
  },
  {
    name: "dzf_file_ajouter", label: "File d'attente : ajouter", category: "Tâches & planification", icon: "fas fa-inbox", output: "file",
    description: "Met un ou plusieurs travaux dans une file (Redis si REDIS_URL, sinon une table). Un autre workflow les prend à son rythme : pour absorber les pics sans tout ralentir.",
    params: [{ name: "file", label: "Nom de la file", required: true, help: "Ex. envois-whatsapp" }, { name: "travaux", label: "Travail ou liste de travaux", required: true, help: "Ex. {{contacts}}" }],
    run: async (p) => {
      const jobs = asList(p.travaux);
      if (redis.available()) { for (let i = 0; i < jobs.length; i += 500) await redis.cmd(["LPUSH", `dzf:file:${p.file}`, ...jobs.slice(i, i + 500).map((j) => JSON.stringify(j))]); return jobs.length; }
      const { file } = await ensureTables();
      for (const j of jobs) await file.insertRow({ file: p.file, charge: JSON.stringify(j), etat: "en attente", cree_le: new Date(), essais: 0 });
      return jobs.length;
    },
  },
  {
    name: "dzf_file_prendre", label: "File d'attente : prendre", category: "Tâches & planification", icon: "fas fa-dolly", output: "travaux",
    description: "Prend jusqu'à N travaux dans une file. Avec la table, les travaux pris depuis plus de 15 min sans être terminés reviennent dans la file (aucun travail perdu si un serveur tombe).",
    params: [{ name: "file", label: "Nom de la file", required: true }, { name: "nombre", label: "Nombre max", type: "int", default: 20 }],
    run: async (p) => {
      const n = Math.max(1, Math.min(1000, +p.nombre || 20));
      if (redis.available()) {
        const out = [];
        for (let i = 0; i < n; i++) { const v = await redis.cmd(["RPOP", `dzf:file:${p.file}`]); if (v === null) break; out.push(JSON.parse(v)); }
        return out;
      }
      const { file } = await ensureTables();
      const stale = new Date(Date.now() - 15 * 60e3);
      for (const r of await file.getRows({ file: p.file, etat: "pris", pris_le: { lt: stale } }, { limit: 500 })) await file.updateRow({ etat: "en attente" }, r.id);
      const rows = await file.getRows({ file: p.file, etat: "en attente" }, { orderBy: "id", limit: n });
      const out = [];
      for (const r of rows) { await file.updateRow({ etat: "pris", pris_le: new Date(), essais: (r.essais || 0) + 1 }, r.id); out.push({ ...JSON.parse(r.charge || "null"), __travail: r.id }); }
      return out;
    },
  },
  {
    name: "dzf_file_terminer", label: "File d'attente : terminer", category: "Tâches & planification", icon: "fas fa-check-double", output: "termines",
    description: "Marque des travaux pris comme terminés (ils disparaissent) ou en erreur (ils reviennent dans la file, 5 essais max). Inutile avec Redis.",
    params: [{ name: "travaux", label: "Travaux terminés", required: true, help: "Ex. {{travaux}} (champ __travail)" }, { name: "resultat", label: "Résultat", type: "select", options: ["réussi", "erreur"], default: "réussi" }],
    run: async (p) => {
      if (redis.available()) return 0;
      const { file } = await ensureTables();
      let n = 0;
      for (const j of asList(p.travaux)) {
        const id = +(j && j.__travail);
        if (!id) continue;
        if (p.resultat === "erreur") { const r = await file.getRow({ id }); if (r) await file.updateRow({ etat: (r.essais || 0) >= 5 ? "abandonné" : "en attente" }, id); } else await file.deleteRows({ id });
        n++;
      }
      return n;
    },
  },
  {
    name: "dzf_ics_lire", label: "Calendrier : lire un agenda (ICS)", category: "Tâches & planification", icon: "far fa-calendar-alt", output: "evenements", timeout: 60,
    description: "Lit un agenda au format ICS (Google Agenda, Outlook, Nextcloud : lien « adresse secrète iCal ») et renvoie les événements à venir.",
    params: [{ name: "url", label: "Adresse ICS ou nom du secret qui la contient", required: true, help: "L'adresse secrète vaut un mot de passe : mets-la dans le coffre" },
      { name: "jours", label: "Événements des N prochains jours", type: "int", default: 14 }, { name: "passes", label: "Inclure les N derniers jours", type: "int", default: 0 }],
    run: async (p, ctx, api) => {
      const url = /^https?:\/\//.test(p.url) ? p.url : await api.secret(p.url);
      if (!url) throw new Error("adresse ICS introuvable");
      const r = await fetch(url.replace(/^webcal:/, "https:"));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const from = Date.now() - (+p.passes || 0) * 864e5, to = Date.now() + (+p.jours || 14) * 864e5;
      return parseIcs(await r.text()).filter((e) => e.debut && +e.debut <= to && +(e.fin || e.debut) >= from).sort((a, b) => a.debut - b.debut);
    },
  },
  {
    name: "dzf_ics_creer", label: "Calendrier : créer un événement (ICS)", category: "Tâches & planification", icon: "far fa-calendar-plus", output: "ics",
    description: "Fabrique un fichier .ics (invitation) à joindre à un mail ou à enregistrer, que tout agenda sait ouvrir.",
    params: [{ name: "titre", label: "Titre", required: true }, { name: "debut", label: "Début", required: true }, { name: "fin", label: "Fin (facultatif)" },
      { name: "lieu", label: "Lieu" }, { name: "description", label: "Description", type: "text" }],
    run: async (p) => {
      const d = new Date(p.debut);
      if (isNaN(d)) throw new Error("date de début invalide");
      const f = p.fin ? new Date(p.fin) : new Date(+d + 3600e3);
      return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//dysizz-flow//FR", "BEGIN:VEVENT", `UID:${require("crypto").randomUUID()}@dysizz`, `DTSTAMP:${icsFmt(new Date())}`, `DTSTART:${icsFmt(d)}`, `DTEND:${icsFmt(f)}`, `SUMMARY:${icsEsc(p.titre)}`, p.lieu ? `LOCATION:${icsEsc(p.lieu)}` : "", p.description ? `DESCRIPTION:${icsEsc(p.description)}` : "", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
    },
  },
];
module.exports.parseIcs = parseIcs;
