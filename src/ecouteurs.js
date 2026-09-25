/* Écouteurs de boîtes mail (IMAP IDLE) : remplacent le plugin imap-idle.
   - temps réel (IDLE) + relève de secours toutes les N minutes ;
   - lecture seule par défaut : rien n'est marqué lu, déplacé ni supprimé ;
   - curseur (dernier UID + UIDVALIDITY) rangé dans dzf_ecouteurs : pas de
     parcours de toute la table à chaque relève ;
   - chaque mail est rangé dans la table choisie (une seule fois : clé uid + message_id)
     puis l'événement « DzfMailRecu » est émis : un workflow Saltcorn peut s'y abonner.
   Un seul processus écoute (le processus principal de Saltcorn). */
"use strict";
const cluster = require("cluster");
const G = globalThis[Symbol.for("dysizz-flow.ecouteurs")] || (globalThis[Symbol.for("dysizz-flow.ecouteurs")] = { actifs: new Map() });
const EVENT = "DzfMailRecu";
const CHAMPS = [["uid", "Integer"], ["dossier", "String"], ["message_id", "String"], ["expediteur", "String"], ["destinataire", "String"], ["objet", "String"], ["date_envoi", "Date"], ["corps_texte", "String"], ["corps_html", "String"], ["recu_le", "Date"], ["ecouteur", "String"]];

const log = (m) => { try { require("@saltcorn/data/db/state").getState().log(4, "[dysizz-flow écouteur] " + m); } catch (e) { /* rien */ } };

/* Crée la table de destination si besoin (ou ajoute les champs manquants). */
const tableDest = async (nom) => {
  const Table = require("@saltcorn/data/models/table"), Field = require("@saltcorn/data/models/field");
  let t = Table.findOne({ name: nom });
  if (!t) { t = await Table.create(nom, { min_role_read: 1, min_role_write: 1, description: "Mails reçus (écouteur dysizz-flow)" }); }
  const have = new Set(t.getFields().map((f) => f.name));
  let ajout = false;
  for (const [n, type] of CHAMPS) if (!have.has(n)) { await Field.create({ table: t, name: n, label: n, type }); ajout = true; }
  if (ajout) { try { await require("@saltcorn/data/db/state").getState().refresh_tables(true); } catch (e) { /* rien */ } t = Table.findOne({ name: nom }); }
  return t;
};

class Ecouteur {
  constructor(conf, tenant) { this.conf = conf; this.tenant = tenant; this.stop = false; this.occupe = false; this.client = null; this.timer = null; }
  async maj(champs) {
    const db = require("@saltcorn/data/db");
    await db.runWithTenant(this.tenant, async () => { const { ensureTables } = require("./store"); const T = await ensureTables(); await T.ecouteurs.updateRow(champs, this.conf.id); });
    Object.assign(this.conf, champs);
  }
  client_() {
    const { ImapFlow } = require("imapflow");
    return new ImapFlow({ host: this.conf.serveur, port: +this.conf.port || 993, secure: (+this.conf.port || 993) === 993, auth: { user: this.conf.utilisateur, pass: this.mdp }, logger: false, socketTimeout: 5 * 60000 });
  }
  async relever(cause) {
    if (this.occupe || this.stop) return;
    this.occupe = true;
    const db = require("@saltcorn/data/db");
    let c = null, n = 0;
    try {
      await db.runWithTenant(this.tenant, async () => {
        const { simpleParser } = require("mailparser");
        const Trigger = require("@saltcorn/data/models/trigger");
        const T = await tableDest(this.conf.table_dest);
        c = this.client_(); await c.connect();
        const box = await c.mailboxOpen(this.conf.dossier || "INBOX", { readOnly: !this.conf.marquer_lu });
        const validity = String(box.uidValidity || "");
        let depuis = +this.conf.dernier_uid || 0;
        if (this.conf.uidvalidity && validity && this.conf.uidvalidity !== validity) { log(`${this.conf.nom} : UIDVALIDITY a changé, reprise sur les 2 derniers jours`); depuis = 0; }
        const uids = depuis ? await c.search({ uid: `${depuis + 1}:*` }, { uid: true }) : await c.search({ since: new Date(Date.now() - 2 * 864e5) }, { uid: true });
        let max = depuis;
        for (const uid of (uids || []).filter((u) => u > depuis).sort((a, b) => a - b)) {
          const m = await c.fetchOne(String(uid), { uid: true, source: true, envelope: true, internalDate: true }, { uid: true });
          if (!m) continue;
          max = Math.max(max, uid);
          const mid = String((m.envelope && m.envelope.messageId) || "").slice(0, 300);
          const deja = await T.getRow(mid ? { message_id: mid, dossier: this.conf.dossier || "INBOX" } : { uid, ecouteur: this.conf.nom });
          if (deja) continue;
          const p = await simpleParser(m.source);
          const row = { uid, dossier: this.conf.dossier || "INBOX", message_id: mid, expediteur: p.from ? p.from.text : "", destinataire: p.to ? [].concat(p.to).map((x) => x.text).join(", ") : "", objet: p.subject || "", date_envoi: p.date || m.internalDate || new Date(), corps_texte: p.text || "", corps_html: typeof p.html === "string" ? p.html : "", recu_le: new Date(), ecouteur: this.conf.nom };
          const id = await T.insertRow(row);
          n++;
          if (this.conf.marquer_lu) await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => {});
          await Trigger.emitEvent(EVENT, this.conf.nom, null, { id, table: this.conf.table_dest, ...row, corps_html: undefined });
        }
        await this.maj({ dernier_uid: max, uidvalidity: validity, etat: this.conf.etat === "idle" ? "idle" : "ok", vu_le: new Date(), erreur: "", recus: (+this.conf.recus || 0) + n });
      });
      if (n) log(`${this.conf.nom} : ${n} mail(s) (${cause})`);
    } catch (e) {
      log(`${this.conf.nom} : relève en échec (${e.message})`);
      await this.maj({ etat: "erreur", erreur: String(e.message).slice(0, 500), vu_le: new Date() }).catch(() => {});
    } finally { if (c) await c.logout().catch(() => {}); this.occupe = false; }
  }
  async boucle() {
    while (!this.stop) {
      let c = null;
      try {
        c = this.client_(); this.client = c;
        await c.connect();
        await c.mailboxOpen(this.conf.dossier || "INBOX", { readOnly: true });
        await this.maj({ etat: "idle", erreur: "" }).catch(() => {});
        c.on("exists", () => setImmediate(() => this.relever("temps réel")));
        while (!this.stop) await c.idle({ maxIdleTime: 4 * 60000 });
      } catch (e) {
        if (this.stop) break;
        await this.maj({ etat: "reconnexion", erreur: String(e.message).slice(0, 300) }).catch(() => {});
        await new Promise((r) => setTimeout(r, 30000));
      } finally { if (c) await c.logout().catch(() => {}); this.client = null; }
    }
  }
  async demarrer() {
    const db = require("@saltcorn/data/db");
    this.mdp = await db.runWithTenant(this.tenant, () => require("./vault").readSecret(this.conf.secret)).catch(() => null) || process.env[this.conf.secret];
    if (!this.mdp) { await this.maj({ etat: "erreur", erreur: `mot de passe introuvable (secret ${this.conf.secret})` }); return; }
    await this.relever("démarrage");
    this.timer = setInterval(() => this.relever("relève de secours"), 5 * 60000);
    this.boucle().catch(() => {});
  }
  async arreter() { this.stop = true; if (this.timer) clearInterval(this.timer); if (this.client) await this.client.logout().catch(() => {}); }
}

/* Empreinte des réglages d'un écouteur : un changement → redémarrage. */
const empreinte = (c) => JSON.stringify([c.serveur, c.port, c.utilisateur, c.secret, c.dossier, c.table_dest, c.marquer_lu, c.actif]);

/* Aligne les écouteurs lancés sur la table dzf_ecouteurs (tenant courant).
   Tourne dans le processus principal ; les pages (processus secondaires)
   n'ont qu'à écrire dans la table : le changement est pris en compte en 30 s au plus. */
const reconcilier = async () => {
  if (cluster.isWorker) return 0;
  const db = require("@saltcorn/data/db");
  const tenant = db.getTenantSchema();
  let T;
  try { const { ensureTables } = require("./store"); T = await ensureTables(); } catch (e) { return 0; }
  const rows = await T.ecouteurs.getRows({});
  const voulus = new Map(rows.filter((r) => r.actif).map((r) => [`${tenant}|${r.nom}`, r]));
  for (const [k, e] of G.actifs) if (k.startsWith(tenant + "|") && (!voulus.has(k) || empreinte(voulus.get(k)) !== e.empreinte)) { await e.arreter(); G.actifs.delete(k); }
  for (const [k, conf] of voulus) if (!G.actifs.has(k)) {
    const e = new Ecouteur(conf, tenant); e.empreinte = empreinte(conf);
    G.actifs.set(k, e);
    e.demarrer().catch((x) => log(`${conf.nom} : ${x.message}`));
  }
  return [...G.actifs.keys()].filter((k) => k.startsWith(tenant + "|")).length;
};
const demarrerTous = reconcilier;
/* appelé au chargement du plugin (par tenant) : premier alignement puis vérification toutes les 30 s */
const surveiller = async () => {
  if (cluster.isWorker) return;
  const db = require("@saltcorn/data/db");
  const tenant = db.getTenantSchema();
  G.minuteurs = G.minuteurs || new Map();
  if (G.minuteurs.has(tenant)) clearInterval(G.minuteurs.get(tenant));
  await reconcilier().catch(() => 0);
  G.minuteurs.set(tenant, setInterval(() => db.runWithTenant(tenant, reconcilier).catch(() => 0), 30000));
};
const etat = () => [...G.actifs.entries()].map(([k, e]) => ({ cle: k, nom: e.conf.nom, etat: e.conf.etat, vu_le: e.conf.vu_le, occupe: e.occupe }));

module.exports = { demarrerTous, reconcilier, surveiller, etat, EVENT, Ecouteur, tableDest };
