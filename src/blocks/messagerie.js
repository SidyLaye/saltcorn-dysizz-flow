/* Blocs « Messagerie » : lire une boîte IMAP, envoyer un mail, notifier,
   Telegram, WhatsApp. Les secrets sont lus dans les variables d'environnement. */
"use strict";
const { plain } = require("../core");

const secret = async (api, name) => { const v = await api.secret(name); if (!v) throw Object.assign(new Error(`secret ${name} introuvable : variable d'environnement ou coffre (/dysizz-flow/coffre)`), { permanent: true }); return v; };

const countAttachments = (node) => {
  if (!node) return 0;
  const self = node.disposition === "attachment" || (node.dispositionParameters && node.dispositionParameters.filename) ? 1 : 0;
  return self + (node.childNodes || []).reduce((s, c) => s + countAttachments(c), 0);
};

const cleanHtml = (h) => String(h)
  .replace(/<(script|noscript|iframe|object|embed|applet|frameset|frame|form)\b[\s\S]*?<\/\1\s*>/gi, "")
  .replace(/<(script|iframe|object|embed|form|frame|frameset|applet|base|meta|link)\b[\s\S]*?(<\/\1\s*>|\/?>)/gi, "")
  .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
  .replace(/(href|src)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*/gi, "$1=$2#");

module.exports = [
  {
    name: "dzf_imap_lire", label: "Mail : lire une boîte (IMAP)", category: "Messagerie", icon: "fas fa-inbox", output: "mails", timeout: 180,
    description: "Lit les nouveaux messages d'une boîte IMAP en lecture seule (rien n'est modifié sur le serveur). Reprend après le dernier UID déjà lu : aucun message traité deux fois. Chaque mail a corps (texte), html (nettoyé) et contenu (le HTML s'il existe, sinon le texte).",
    params: [
      { name: "serveur", label: "Serveur", default: "ssl0.ovh.net", help: "OVH : ssl0.ovh.net (MX Plan), pro1.mail.ovh.net (E-mail Pro)" },
      { name: "port", label: "Port", type: "int", default: 993 },
      { name: "utilisateur", label: "Adresse / identifiant", required: true },
      { name: "variable_mot_de_passe", label: "Variable d'environnement du mot de passe", default: "DZ_MAIL_PASSWORD" },
      { name: "dossier", label: "Dossier", default: "INBOX" },
      { name: "depuis_uid", label: "Lire après l'UID", help: "Ex. {{dernier_uid}} (lu dans ta table avec « Table : compter » en max). Vide = les N derniers jours" },
      { name: "jours", label: "Première lecture : jours en arrière", type: "int", default: 14 },
      { name: "max", label: "Messages max", type: "int", default: 100 },
    ],
    run: async (p, ctx, api) => {
      const { ImapFlow } = require("imapflow");
      const { simpleParser } = require("mailparser");
      const client = new ImapFlow({ host: p.serveur, port: +p.port || 993, secure: (+p.port || 993) === 993, auth: { user: p.utilisateur, pass: await secret(api, p.variable_mot_de_passe) }, logger: false, socketTimeout: 60000 });
      const out = [];
      await client.connect();
      try {
        const lock = await client.getMailboxLock(p.dossier || "INBOX", { readOnly: true });
        try {
          const last = +p.depuis_uid || 0;
          const uids = (await client.search(last ? { uid: `${last + 1}:*` } : { since: new Date(Date.now() - (+p.jours || 14) * 864e5) }, { uid: true })) || [];
          for (const uid of uids.filter((u) => u > last).slice(-(+p.max || 100))) {
            const m = await client.fetchOne(String(uid), { uid: true, envelope: true, flags: true, bodyStructure: true, source: { start: 0, maxLength: 400000 } }, { uid: true });
            if (!m) continue;
            let text = "", html = "";
            try {
              const parsed = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
              text = parsed.text || plain(parsed.html || "");
              /* HTML nettoyé (sans script ni événement) : à afficher dans un cadre isolé (vue « dz_mail » de dysizz-ui) */
              html = parsed.html ? cleanHtml(parsed.html).slice(0, 200000) : "";
            } catch (e) { text = ""; }
            const env = m.envelope || {}, from = (env.from || [])[0] || {}, flags = m.flags || new Set();
            out.push({
              uid, dossier: p.dossier || "INBOX", message_id: String(env.messageId || "").slice(0, 300),
              de: String(from.address || "").toLowerCase(), de_nom: String(from.name || from.address || ""),
              a: (env.to || []).map((x) => x.address).join(", "), sujet: String(env.subject || "(sans objet)").slice(0, 500),
              date: env.date || new Date(), extrait: plain(text, 240), corps: String(text).slice(0, 30000), html, contenu: html || String(text).slice(0, 30000),
              lu: flags.has("\\Seen"), suivi: flags.has("\\Flagged"), pieces_jointes: countAttachments(m.bodyStructure),
            });
          }
        } finally { lock.release(); }
      } finally { await client.logout().catch(() => {}); }
      return out;
    },
  },
  {
    name: "dzf_mail_envoyer", label: "Mail : envoyer", category: "Messagerie", icon: "fas fa-paper-plane", output: "envoi",
    description: "Envoie un mail avec le serveur SMTP réglé dans Saltcorn (Paramètres → E-mail).",
    params: [{ name: "a", label: "À", required: true, help: "Une ou plusieurs adresses séparées par des virgules" }, { name: "sujet", label: "Sujet", required: true },
      { name: "texte", label: "Texte", type: "text", required: true }, { name: "html", label: "Le texte est du HTML", type: "bool" }],
    run: async (p) => {
      const { getMailTransport } = require("@saltcorn/data/models/email");
      const { getState } = require("@saltcorn/data/db/state");
      const from = getState().getConfig("email_from");
      if (!from) throw new Error("adresse d'expéditeur non réglée (Paramètres → E-mail)");
      const r = await (await getMailTransport()).sendMail({ from, to: p.a, subject: p.sujet, ...(p.html ? { html: p.texte } : { text: p.texte }) });
      return { id: r && r.messageId, acceptes: r && r.accepted };
    },
  },
  {
    name: "dzf_notifier", label: "Notifier dans Saltcorn", category: "Messagerie", icon: "fas fa-bell", output: "notifies",
    description: "Envoie une notification Saltcorn (cloche, et e-mail ou push selon les réglages de chaque utilisateur).",
    params: [{ name: "qui", label: "Destinataires", type: "select", options: ["administrateurs", "un rôle", "des utilisateurs (ids)", "l'utilisateur courant"], default: "administrateurs" },
      { name: "role", label: "Rôle (id)", type: "int", help: "1 admin, 40 staff, 80 user" }, { name: "ids", label: "Ids d'utilisateurs", help: "Ex. 3,7 ou {{responsable}}" },
      { name: "titre", label: "Titre", required: true }, { name: "texte", label: "Texte", type: "text" }, { name: "lien", label: "Lien", help: "Ex. /page/taches" }],
    run: async (p, ctx, api) => {
      const User = require("@saltcorn/data/models/user");
      const Notification = require("@saltcorn/data/models/notification");
      let users = [];
      if (p.qui === "administrateurs") users = await User.find({ role_id: 1 });
      else if (p.qui === "un rôle") users = await User.find({ role_id: +p.role });
      else if (p.qui === "l'utilisateur courant") users = api.user ? [api.user] : [];
      else users = String(p.ids || "").split(",").map((x) => +x).filter(Boolean).map((id) => ({ id }));
      for (const u of users) await Notification.create({ user_id: u.id, title: String(p.titre).slice(0, 200), body: String(p.texte || "").slice(0, 2000), link: p.lien || "" });
      return users.length;
    },
  },
  {
    name: "dzf_telegram", label: "Telegram : envoyer un message", category: "Messagerie", icon: "fab fa-telegram-plane", output: "telegram",
    description: "Envoie un message par un bot Telegram (gratuit). Jeton du bot dans une variable d'environnement.",
    params: [{ name: "variable_jeton", label: "Variable d'environnement du jeton", default: "TELEGRAM_BOT_TOKEN" }, { name: "chat_id", label: "Chat id", required: true },
      { name: "texte", label: "Texte", type: "text", required: true }, { name: "format", label: "Format", type: "select", options: ["texte", "HTML", "MarkdownV2"], default: "texte" }],
    run: async (p, ctx, api) => {
      const r = await fetch(`https://api.telegram.org/bot${await secret(api, p.variable_jeton)}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: p.chat_id, text: String(p.texte).slice(0, 4000), ...(p.format !== "texte" ? { parse_mode: p.format } : {}) }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.description || `HTTP ${r.status}`);
      return j.result && j.result.message_id;
    },
  },
  {
    name: "dzf_whatsapp", label: "WhatsApp : envoyer (Cloud API)", category: "Messagerie", icon: "fab fa-whatsapp", output: "whatsapp",
    description: "Envoie un message WhatsApp par l'API Cloud de Meta : texte libre (dans les 24 h) ou modèle validé.",
    params: [{ name: "variable_jeton", label: "Variable d'environnement du jeton", default: "WHATSAPP_TOKEN" }, { name: "phone_number_id", label: "Phone number id", required: true },
      { name: "a", label: "Numéro destinataire (format international)", required: true, help: "Ex. 33612345678" },
      { name: "type", label: "Type", type: "select", options: ["texte", "modèle"], default: "texte" }, { name: "texte", label: "Texte", type: "text" },
      { name: "modele", label: "Nom du modèle" }, { name: "langue", label: "Langue du modèle", default: "fr" }, { name: "variables", label: "Variables du modèle (JSON liste)", type: "json", help: '["{{prenom}}","{{date}}"]' },
      { name: "version", label: "Version de l'API", default: "v21.0" }],
    run: async (p, ctx, api) => {
      const body = { messaging_product: "whatsapp", to: String(p.a).replace(/\D/g, "") };
      if (p.type === "modèle") Object.assign(body, { type: "template", template: { name: p.modele, language: { code: p.langue || "fr" }, ...(p.variables && p.variables.length ? { components: [{ type: "body", parameters: p.variables.map((t) => ({ type: "text", text: String(t) })) }] } : {}) } });
      else Object.assign(body, { type: "text", text: { body: String(p.texte || "").slice(0, 4096) } });
      const r = await fetch(`https://graph.facebook.com/${p.version || "v21.0"}/${p.phone_number_id}/messages`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await secret(api, p.variable_jeton)}` }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || `HTTP ${r.status}`);
      return j.messages && j.messages[0] && j.messages[0].id;
    },
  },
];
