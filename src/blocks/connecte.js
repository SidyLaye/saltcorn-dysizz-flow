/* Objets connectés et messageries temps réel : MQTT, WebSocket, Home Assistant,
   Matrix, Mattermost / Rocket.Chat, Gotify, Pushover, Signal. */
"use strict";
const net = require("net");
const tls = require("tls");

const perm = (m) => Object.assign(new Error(m), { permanent: true });
const need = async (api, name) => { const v = await api.secret(name); if (!v) throw perm(`secret ${name} introuvable (variable d'environnement ou coffre)`); return v; };
const J = (v, d) => { if (v === undefined || v === null || v === "") return d; if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return v; } } return v; };
const post = async (url, body, headers = {}, name = "API") => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${name} : HTTP ${r.status} ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch (e) { return t; }
};

/* ---------- MQTT 3.1.1 minimal : publier (QoS 0/1) et lire les messages d'un sujet pendant N secondes ---------- */
const mqttStr = (s) => { const b = Buffer.from(String(s), "utf8"); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };
const mqttLen = (n) => { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return Buffer.from(out); };
const mqttPkt = (type, flags, body) => Buffer.concat([Buffer.from([(type << 4) | flags]), mqttLen(body.length), body]);
const mqtt = (opt, work) => new Promise((resolve, reject) => {
  const u = new URL(opt.url);
  const secure = u.protocol === "mqtts:";
  const sock = (secure ? tls : net).connect({ host: u.hostname, port: +u.port || (secure ? 8883 : 1883), servername: u.hostname });
  let buf = Buffer.alloc(0), done = false;
  const handlers = [];
  const finish = (e, v) => { if (done) return; done = true; clearTimeout(t); try { sock.write(mqttPkt(14, 0, Buffer.alloc(0))); } catch (x) { /* rien */ } sock.end(); e ? reject(e) : resolve(v); };
  const t = setTimeout(() => finish(null, "délai"), (opt.timeout || 15) * 1000);
  sock.on("error", (e) => finish(new Error(`MQTT : ${e.message}`)));
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2) {
      let mul = 1, len = 0, i = 1, b;
      do { b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128 && i < buf.length);
      if (buf.length < i + len) break;
      const pkt = { type: buf[0] >> 4, flags: buf[0] & 15, body: buf.slice(i, i + len) };
      buf = buf.slice(i + len);
      for (const h of handlers.slice()) h(pkt);
    }
  });
  sock.on(secure ? "secureConnect" : "connect", () => {
    const flags = (opt.user ? 128 : 0) | (opt.pass ? 64 : 0) | 2;
    const body = Buffer.concat([mqttStr("MQTT"), Buffer.from([4, flags, 0, 60]), mqttStr(opt.client || `dzf-${Math.random().toString(36).slice(2, 10)}`), ...(opt.user ? [mqttStr(opt.user)] : []), ...(opt.pass ? [mqttStr(opt.pass)] : [])]);
    sock.write(mqttPkt(1, 0, body));
    handlers.push(function onConnack(pk) {
      if (pk.type !== 2) return;
      handlers.splice(handlers.indexOf(onConnack), 1);
      if (pk.body[1] !== 0) return finish(perm(`MQTT : connexion refusée (code ${pk.body[1]} — identifiants ?)`));
      work({ sock, handlers, finish });
    });
  });
});

module.exports = [
  {
    name: "dzf_mqtt", label: "MQTT : publier ou écouter", category: "Objets connectés", icon: "fas fa-broadcast-tower", output: "mqtt", timeout: 120,
    description: "Parle aux objets connectés (Zigbee2MQTT, Tasmota, Shelly, ESPHome, capteurs…) : publie un message sur un sujet, ou récupère les messages reçus pendant quelques secondes.",
    params: [{ name: "adresse", label: "Serveur MQTT", default: "mqtt://mosquitto:1883", help: "mqtts:// pour TLS" }, { name: "identifiants", label: "Secret « utilisateur:mdp » (si besoin)", default: "MQTT" },
      { name: "action", label: "Action", type: "select", options: ["publier", "écouter"], default: "publier" }, { name: "sujet", label: "Sujet (topic)", required: true, help: "Ex. zigbee2mqtt/lampe_salon/set · écouter : capteurs/# " },
      { name: "message", label: "Message", type: "text", showIf: { action: "publier" }, help: 'Ex. {"state":"ON"}' }, { name: "conserver", label: "Conservé (retain)", type: "bool", default: false, showIf: { action: "publier" } },
      { name: "secondes", label: "Écouter pendant (secondes)", type: "int", default: 5, showIf: { action: "écouter" } }, { name: "max", label: "Messages max", type: "int", default: 100, showIf: { action: "écouter" } }],
    run: async (p, ctx, api) => {
      const id = await api.secret(p.identifiants);
      const [user, ...rest] = id ? String(id).split(":") : [];
      const opt = { url: p.adresse, user, pass: rest.join(":"), timeout: p.action === "écouter" ? Math.min(60, +p.secondes || 5) + 5 : 15 };
      if (p.action === "publier") {
        const payload = Buffer.from(typeof p.message === "object" ? JSON.stringify(p.message) : String(p.message ?? ""), "utf8");
        return mqtt(opt, ({ sock, finish }) => { sock.write(mqttPkt(3, p.conserver ? 1 : 0, Buffer.concat([mqttStr(p.sujet), payload]))); setTimeout(() => finish(null, { publie: p.sujet, octets: payload.length }), 150); });
      }
      const msgs = [];
      return mqtt(opt, ({ sock, handlers, finish }) => {
        sock.write(mqttPkt(8, 2, Buffer.concat([Buffer.from([0, 1]), mqttStr(p.sujet), Buffer.from([0])])));
        handlers.push((pk) => {
          if (pk.type !== 3) return;
          const tl = pk.body.readUInt16BE(0), topic = pk.body.slice(2, 2 + tl).toString("utf8");
          const off = 2 + tl + (((pk.flags >> 1) & 3) > 0 ? 2 : 0), txt = pk.body.slice(off).toString("utf8");
          let val = txt; try { val = JSON.parse(txt); } catch (e) { /* texte */ }
          msgs.push({ sujet: topic, message: val, quand: new Date().toISOString() });
          if (msgs.length >= (+p.max || 100)) finish(null, msgs);
        });
        setTimeout(() => finish(null, msgs), Math.min(60, +p.secondes || 5) * 1000);
      });
    },
  },
  {
    name: "dzf_websocket", label: "WebSocket : envoyer et recevoir", category: "Objets connectés", icon: "fas fa-plug", output: "ws", timeout: 120,
    description: "Se connecte à un WebSocket, envoie un message (facultatif) et récupère les réponses reçues pendant quelques secondes (cotations en direct, jeux, serveurs temps réel…).",
    params: [{ name: "url", label: "Adresse", required: true, help: "wss://…" }, { name: "message", label: "Message à envoyer", type: "text" }, { name: "secondes", label: "Écouter pendant (secondes)", type: "int", default: 5 }, { name: "max", label: "Messages max", type: "int", default: 50 }],
    run: async (p) => {
      if (typeof WebSocket === "undefined") throw perm("WebSocket indisponible (Node 22 requis)");
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(p.url);
        const out = [];
        const end = () => { try { ws.close(); } catch (e) { /* rien */ } resolve(out); };
        const t = setTimeout(end, Math.min(60, +p.secondes || 5) * 1000);
        ws.onopen = () => { if (p.message !== undefined && p.message !== "") ws.send(typeof p.message === "object" ? JSON.stringify(p.message) : String(p.message)); };
        ws.onmessage = (e) => { let v = e.data; try { v = JSON.parse(v); } catch (x) { /* texte */ } out.push(v); if (out.length >= (+p.max || 50)) { clearTimeout(t); end(); } };
        ws.onerror = (e) => { clearTimeout(t); reject(new Error(`WebSocket : ${e.message || "erreur de connexion"}`)); };
      });
    },
  },
  {
    name: "dzf_home_assistant", label: "Home Assistant", category: "Objets connectés", icon: "fas fa-home", output: "maison", timeout: 60,
    description: "Pilote ta maison : lire l'état d'un appareil ou d'un capteur, allumer/éteindre, lancer une scène ou une automatisation, envoyer une notification sur ton téléphone.",
    params: [{ name: "adresse", label: "Adresse", default: "http://homeassistant:8123" }, { name: "jeton", label: "Secret du jeton longue durée", default: "HA_TOKEN" },
      { name: "action", label: "Action", type: "select", options: ["lire un état", "lister les appareils", "appeler un service", "notifier"], default: "lire un état" },
      { name: "entite", label: "Entité", help: "Ex. light.salon, sensor.temperature_chambre" }, { name: "service", label: "Service", showIf: { action: "appeler un service" }, help: "Ex. light.turn_on, scene.turn_on, script.bonne_nuit" },
      { name: "donnees", label: "Données (JSON)", type: "json", showIf: { action: "appeler un service" }, help: '{"brightness_pct": 40}' }, { name: "message", label: "Message", showIf: { action: "notifier" } }, { name: "cible", label: "Service de notification", default: "notify.notify", showIf: { action: "notifier" } }],
    run: async (p, ctx, api) => {
      const B = `${String(p.adresse).replace(/\/$/, "")}/api`, h = { Authorization: `Bearer ${await need(api, p.jeton)}` };
      const get = async (u) => { const r = await fetch(B + u, { headers: h }); if (!r.ok) throw new Error(`Home Assistant : HTTP ${r.status}`); return r.json(); };
      if (p.action === "lire un état") { const s = await get(`/states/${encodeURIComponent(p.entite)}`); return { entite: s.entity_id, etat: s.state, nom: s.attributes.friendly_name, unite: s.attributes.unit_of_measurement, attributs: s.attributes, depuis: s.last_changed }; }
      if (p.action === "lister les appareils") return (await get("/states")).filter((s) => !p.entite || s.entity_id.startsWith(p.entite)).map((s) => ({ entite: s.entity_id, nom: s.attributes.friendly_name, etat: s.state, unite: s.attributes.unit_of_measurement }));
      if (p.action === "notifier") { const [d, s] = String(p.cible || "notify.notify").split("."); await post(`${B}/services/${d}/${s}`, { message: String(p.message || "") }, h, "Home Assistant"); return { notifie: true }; }
      const [domain, svc] = String(p.service || "").split(".");
      if (!domain || !svc) throw perm("service au format domaine.service");
      const res = await post(`${B}/services/${domain}/${svc}`, { ...(p.entite ? { entity_id: p.entite } : {}), ...J(p.donnees, {}) }, h, "Home Assistant");
      return { fait: p.service, changes: Array.isArray(res) ? res.map((s) => ({ entite: s.entity_id, etat: s.state })) : res };
    },
  },
  {
    name: "dzf_matrix", label: "Matrix / Element", category: "Messagerie", icon: "fas fa-comments", output: "matrix",
    description: "Envoie un message (texte ou HTML) dans un salon Matrix (Element, Beeper…). Messagerie libre et chiffrable.",
    params: [{ name: "serveur", label: "Serveur", default: "https://matrix.org" }, { name: "jeton", label: "Secret du jeton d'accès", default: "MATRIX_TOKEN" }, { name: "salon", label: "Id du salon", required: true, help: "!abcd:matrix.org" }, { name: "message", label: "Message", type: "text", required: true }, { name: "html", label: "Le message est du HTML", type: "bool", default: false }],
    run: async (p, ctx, api) => {
      const txn = `dzf${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      const body = p.html ? { msgtype: "m.text", body: require("../core").plain(p.message), format: "org.matrix.custom.html", formatted_body: String(p.message) } : { msgtype: "m.text", body: String(p.message) };
      const r = await fetch(`${String(p.serveur).replace(/\/$/, "")}/_matrix/client/v3/rooms/${encodeURIComponent(p.salon)}/send/m.room.message/${txn}`, { method: "PUT", headers: { Authorization: `Bearer ${await need(api, p.jeton)}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`Matrix : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return (await r.json()).event_id;
    },
  },
  {
    name: "dzf_chat_equipe", label: "Mattermost / Rocket.Chat / Zulip", category: "Messagerie", icon: "fas fa-comment-dots", output: "chat_equipe",
    description: "Poste un message dans un canal de ta messagerie d'équipe libre, via un webhook entrant.",
    params: [{ name: "outil", label: "Outil", type: "select", options: ["Mattermost", "Rocket.Chat", "Zulip"], default: "Mattermost" }, { name: "webhook", label: "Secret de l'adresse du webhook", default: "CHAT_WEBHOOK", help: "Zulip : URL avec api_key et stream" },
      { name: "message", label: "Message (Markdown)", type: "text", required: true }, { name: "nom", label: "Nom affiché", default: "Dysizz" }, { name: "sujet", label: "Sujet (Zulip)", showIf: { outil: "Zulip" } }],
    run: async (p, ctx, api) => {
      const url = await need(api, p.webhook);
      if (p.outil === "Zulip") { const u = new URL(url); u.searchParams.set("topic", p.sujet || "Dysizz"); await post(u.toString(), { text: String(p.message) }, {}, "Zulip"); }
      else await post(url, p.outil === "Mattermost" ? { text: String(p.message), username: p.nom } : { text: String(p.message), alias: p.nom }, {}, p.outil);
      return { envoye: true };
    },
  },
  {
    name: "dzf_push", label: "Notification push (Gotify, Pushover, Signal)", category: "Messagerie", icon: "fas fa-mobile-alt", output: "push",
    description: "Envoie une notification sur ton téléphone : Gotify (auto-hébergé), Pushover, ou un message Signal (via signal-cli-rest-api).",
    params: [{ name: "service", label: "Service", type: "select", options: ["Gotify", "Pushover", "Signal"], default: "Gotify" }, { name: "adresse", label: "Adresse (Gotify / Signal)", default: "http://gotify:80" },
      { name: "cle", label: "Secret de la clé", default: "GOTIFY_TOKEN", help: "Gotify : jeton d'appli · Pushover : « APP_TOKEN:USER_KEY » · Signal : ton numéro expéditeur" },
      { name: "destinataire", label: "Destinataire (Signal)", showIf: { service: "Signal" }, help: "+336…" }, { name: "titre", label: "Titre" }, { name: "message", label: "Message", type: "text", required: true },
      { name: "priorite", label: "Priorité (0 à 10)", type: "int", default: 5 }, { name: "lien", label: "Lien (facultatif)" }],
    run: async (p, ctx, api) => {
      const k = await need(api, p.cle), B = String(p.adresse || "").replace(/\/$/, "");
      if (p.service === "Gotify") return post(`${B}/message`, { title: p.titre || "Dysizz", message: String(p.message), priority: +p.priorite || 5, ...(p.lien ? { extras: { "client::notification": { click: { url: p.lien } } } } : {}) }, { "X-Gotify-Key": k }, "Gotify");
      if (p.service === "Pushover") { const [token, user] = k.split(":"); return post("https://api.pushover.net/1/messages.json", { token, user, title: p.titre || "Dysizz", message: String(p.message), priority: Math.max(-2, Math.min(2, Math.round((+p.priorite || 5) / 3) - 1)), ...(p.lien ? { url: p.lien } : {}) }, {}, "Pushover"); }
      return post(`${B}/v2/send`, { number: k, recipients: [p.destinataire], message: `${p.titre ? p.titre + "\n" : ""}${p.message}${p.lien ? "\n" + p.lien : ""}` }, {}, "Signal");
    },
  },
];
