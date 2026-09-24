/* Blocs « Sécurité » : hachage, chiffrement, jetons, audits (en-têtes, TLS,
   SPF/DMARC), veille de vulnérabilités, fuites de mots de passe, données perso.
   Tout est fait avec Node (crypto, tls, dns) : aucune dépendance externe. */
"use strict";
const crypto = require("crypto");
const tls = require("tls");
const dns = require("dns").promises;
const { asList } = require("../engine");

const b64u = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const need = async (api, name) => { const v = await api.secret(name); if (!v) throw Object.assign(new Error(`secret ${name} introuvable (variable d'environnement ou coffre)`), { permanent: true }); return v; };
const keyFrom = (s) => crypto.createHash("sha256").update(String(s)).digest();

/* motifs de données personnelles (RGPD) et de secrets fuités */
const PII = {
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  téléphone: /(?:\+|00)?\d[\d .-]{7,}\d/g,
  iban: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\s?[A-Z0-9]{1,4}\b/g,
  carte: /\b(?:\d[ -]?){13,19}\b/g,
  ip: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
};
const SECRETS = [
  ["clé AWS", /AKIA[0-9A-Z]{16}/g], ["jeton GitHub", /gh[pousr]_[A-Za-z0-9]{36,}/g], ["clé OpenAI", /sk-[A-Za-z0-9_-]{20,}/g],
  ["clé Google", /AIza[0-9A-Za-z_-]{35}/g], ["jeton Slack", /xox[baprs]-[A-Za-z0-9-]{10,}/g], ["clé privée", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["jeton JWT", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g], ["mot de passe dans une URL", /[a-z]+:\/\/[^\s:/]+:[^\s@/]+@/gi],
  ["jeton Stripe", /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g], ["jeton Telegram", /\d{8,10}:[A-Za-z0-9_-]{35}/g],
];

const SEC_HEADERS = [
  ["strict-transport-security", "HSTS : force le HTTPS", 20], ["content-security-policy", "CSP : limite les scripts autorisés", 20],
  ["x-content-type-options", "nosniff : empêche de deviner le type", 10], ["x-frame-options", "anti-clickjacking (ou frame-ancestors dans la CSP)", 10],
  ["referrer-policy", "ne fuit pas les adresses", 10], ["permissions-policy", "caméra, micro, position bloqués", 10],
  ["cross-origin-opener-policy", "isole la fenêtre", 10], ["cross-origin-resource-policy", "protège les ressources", 10],
];

const certInfo = (host, port = 443, timeout = 10000) => new Promise((resolve, reject) => {
  const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout }, () => {
    const c = sock.getPeerCertificate();
    const fin = new Date(c.valid_to);
    resolve({ hote: host, emetteur: (c.issuer && (c.issuer.O || c.issuer.CN)) || "", sujet: (c.subject && c.subject.CN) || "", debut: new Date(c.valid_from).toISOString(), fin: fin.toISOString(), jours_restants: Math.floor((fin - Date.now()) / 864e5), valide: sock.authorized, erreur: sock.authorized ? "" : String(sock.authorizationError || ""), protocole: sock.getProtocol() });
    sock.end();
  });
  sock.on("error", reject);
  sock.on("timeout", () => { sock.destroy(); reject(new Error("délai dépassé")); });
});

module.exports = [
  {
    name: "dzf_hacher", label: "Sécurité : hacher", category: "Sécurité", icon: "fas fa-fingerprint", output: "empreinte",
    description: "Empreinte d'un texte (SHA-256, SHA-512, SHA-1, MD5) ou HMAC avec un secret. Pour comparer, dédoublonner ou vérifier sans stocker la donnée.",
    params: [{ name: "texte", label: "Texte", required: true }, { name: "algo", label: "Algorithme", type: "select", options: ["sha256", "sha512", "sha1", "md5"], default: "sha256" },
      { name: "secret_hmac", label: "Secret HMAC (facultatif)", help: "Nom d'un secret : donne un HMAC au lieu d'une simple empreinte" }, { name: "format", label: "Format", type: "select", options: ["hex", "base64"], default: "hex" }],
    run: async (p, ctx, api) => (p.secret_hmac ? crypto.createHmac(p.algo, await need(api, p.secret_hmac)) : crypto.createHash(p.algo)).update(typeof p.texte === "string" ? p.texte : JSON.stringify(p.texte)).digest(p.format || "hex"),
  },
  {
    name: "dzf_chiffrer", label: "Sécurité : chiffrer / déchiffrer", category: "Sécurité", icon: "fas fa-user-secret", output: "chiffre",
    description: "Chiffre une valeur en AES-256-GCM (authentifié) avec une clé tirée d'un secret, ou la déchiffre. Pour stocker une donnée sensible dans une table.",
    params: [{ name: "sens", label: "Sens", type: "select", options: ["chiffrer", "déchiffrer"], default: "chiffrer" }, { name: "valeur", label: "Valeur", required: true },
      { name: "secret_cle", label: "Nom du secret qui sert de clé", required: true, default: "DZF_CLE_DONNEES" }],
    run: async (p, ctx, api) => {
      const k = keyFrom(await need(api, p.secret_cle));
      if (p.sens === "déchiffrer") {
        const [iv, tag, data] = String(p.valeur).split(".");
        const d = crypto.createDecipheriv("aes-256-gcm", k, unb64u(iv));
        d.setAuthTag(unb64u(tag));
        const txt = Buffer.concat([d.update(unb64u(data)), d.final()]).toString("utf8");
        try { return JSON.parse(txt); } catch (e) { return txt; }
      }
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", k, iv);
      const data = Buffer.concat([c.update(typeof p.valeur === "string" ? p.valeur : JSON.stringify(p.valeur), "utf8"), c.final()]);
      return `${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(data)}`;
    },
  },
  {
    name: "dzf_jwt", label: "Sécurité : jeton JWT", category: "Sécurité", icon: "fas fa-key", output: "jwt",
    description: "Crée ou vérifie un jeton JWT signé HS256 (pour tes API, liens magiques, invitations). La vérification contrôle la signature et l'expiration.",
    params: [{ name: "action", label: "Action", type: "select", options: ["créer", "vérifier"], default: "créer" }, { name: "secret", label: "Nom du secret de signature", required: true, default: "DZF_JWT_SECRET" },
      { name: "donnees", label: "Données (JSON, pour créer)", type: "json", default: '{"sub":"{{user.id}}"}' }, { name: "duree", label: "Durée de validité (secondes)", type: "int", default: 3600 },
      { name: "jeton", label: "Jeton (pour vérifier)" }],
    run: async (p, ctx, api) => {
      const key = await need(api, p.secret);
      if (p.action === "vérifier") {
        const [h, pl, sig] = String(p.jeton || "").split(".");
        if (!h || !pl || !sig) return { valide: false, raison: "format" };
        const exp = b64u(crypto.createHmac("sha256", key).update(`${h}.${pl}`).digest());
        if (exp.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(sig))) return { valide: false, raison: "signature" };
        const data = JSON.parse(unb64u(pl).toString("utf8"));
        if (data.exp && data.exp * 1000 < Date.now()) return { valide: false, raison: "expiré", donnees: data };
        return { valide: true, donnees: data };
      }
      const now = Math.floor(Date.now() / 1000);
      const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const pl = b64u(JSON.stringify({ ...(p.donnees || {}), iat: now, exp: now + (+p.duree || 3600) }));
      return `${h}.${pl}.${b64u(crypto.createHmac("sha256", key).update(`${h}.${pl}`).digest())}`;
    },
  },
  {
    name: "dzf_generer", label: "Sécurité : générer un identifiant ou un mot de passe", category: "Sécurité", icon: "fas fa-dice", output: "genere",
    description: "UUID, jeton aléatoire, mot de passe fort, code à chiffres (OTP), tous avec le générateur cryptographique du système.",
    params: [{ name: "type", label: "Type", type: "select", options: ["uuid", "jeton", "mot de passe", "code chiffres"], default: "uuid" }, { name: "longueur", label: "Longueur", type: "int", default: 24 }],
    run: async (p) => {
      const n = Math.max(4, Math.min(256, +p.longueur || 24));
      if (p.type === "uuid") return crypto.randomUUID();
      if (p.type === "jeton") return b64u(crypto.randomBytes(n)).slice(0, n);
      if (p.type === "code chiffres") return Array.from(crypto.randomBytes(n), (x) => x % 10).join("").slice(0, Math.min(n, 12));
      const set = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*-_=+?";
      return Array.from(crypto.randomBytes(n), (x) => set[x % set.length]).join("");
    },
  },
  {
    name: "dzf_mdp_fuite", label: "Sécurité : mot de passe déjà fuité ?", category: "Sécurité", icon: "fas fa-user-shield", output: "fuite",
    description: "Vérifie si un mot de passe apparaît dans des fuites connues (Have I Been Pwned). Seuls les 5 premiers caractères de son empreinte partent sur Internet : le mot de passe ne quitte jamais le serveur.",
    params: [{ name: "mot_de_passe", label: "Mot de passe", type: "password", required: true }],
    run: async (p) => {
      const h = crypto.createHash("sha1").update(String(p.mot_de_passe)).digest("hex").toUpperCase();
      const r = await fetch(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, { headers: { "Add-Padding": "true", "User-Agent": "dysizz-flow" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const line = (await r.text()).split("\n").find((l) => l.startsWith(h.slice(5)));
      const n = line ? parseInt(line.split(":")[1], 10) : 0;
      return { fuite: n > 0, fois: n };
    },
  },
  {
    name: "dzf_cve", label: "Sécurité : vulnérabilités connues (CVE)", category: "Sécurité", icon: "fas fa-bug", output: "cve", timeout: 60,
    description: "Cherche les CVE récentes par mot-clé (ex. un logiciel que tu utilises) dans la base officielle NVD, avec leur score de gravité.",
    params: [{ name: "mot_cle", label: "Mot-clé", required: true, help: "Ex. saltcorn, postgresql 16, traefik, n8n" }, { name: "jours", label: "Publiées depuis (jours)", type: "int", default: 30 },
      { name: "gravite_min", label: "Gravité minimum", type: "select", options: ["toutes", "MEDIUM", "HIGH", "CRITICAL"], default: "toutes" }, { name: "secret_cle", label: "Clé NVD (facultatif, pour plus de requêtes)", default: "NVD_API_KEY" }],
    run: async (p, ctx, api) => {
      const end = new Date(), start = new Date(Date.now() - Math.min(119, +p.jours || 30) * 864e5);
      const q = new URLSearchParams({ keywordSearch: p.mot_cle, pubStartDate: start.toISOString(), pubEndDate: end.toISOString(), resultsPerPage: "100" });
      if (p.gravite_min && p.gravite_min !== "toutes") q.set("cvssV3Severity", p.gravite_min);
      const key = await api.secret(p.secret_cle);
      const r = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?${q}`, { headers: key ? { apiKey: key } : {} });
      if (!r.ok) throw new Error(`NVD : HTTP ${r.status}`);
      const j = await r.json();
      return (j.vulnerabilities || []).map(({ cve }) => {
        const m = (cve.metrics && (cve.metrics.cvssMetricV31 || cve.metrics.cvssMetricV30 || [])[0]) || {};
        return { cve: cve.id, publiee: cve.published, score: m.cvssData ? m.cvssData.baseScore : null, gravite: m.cvssData ? m.cvssData.baseSeverity : "", resume: ((cve.descriptions || []).find((d) => d.lang === "en") || {}).value || "", url: `https://nvd.nist.gov/vuln/detail/${cve.id}` };
      }).sort((a, b) => (b.score || 0) - (a.score || 0));
    },
  },
  {
    name: "dzf_entetes_securite", label: "Sécurité : audit des en-têtes HTTP", category: "Sécurité", icon: "fas fa-shield-alt", output: "audit",
    description: "Note sur 100 la protection d'un site par ses en-têtes (HSTS, CSP, anti-clickjacking…), avec ce qui manque et pourquoi.",
    params: [{ name: "url", label: "Adresse du site", required: true, help: "Ex. https://web.allinone.ovh" }],
    run: async (p) => {
      const r = await fetch(p.url, { method: "GET", redirect: "follow" });
      const got = Object.fromEntries([...r.headers.entries()]);
      let score = 0;
      const manque = [];
      for (const [h, why, pts] of SEC_HEADERS) {
        const ok = h === "x-frame-options" ? !!got[h] || /frame-ancestors/i.test(got["content-security-policy"] || "") : !!got[h];
        if (ok) score += pts; else manque.push({ en_tete: h, pourquoi: why });
      }
      const fuites = ["server", "x-powered-by", "x-aspnet-version"].filter((h) => got[h]).map((h) => `${h}: ${got[h]}`);
      return { url: r.url, statut: r.status, score, manque, fuites_info: fuites, https: r.url.startsWith("https://") };
    },
  },
  {
    name: "dzf_certificat_tls", label: "Sécurité : certificat TLS", category: "Sécurité", icon: "fas fa-certificate", output: "certificat",
    description: "Lit le certificat d'un ou plusieurs domaines : émetteur, validité, jours restants. Idéal pour être prévenu avant l'expiration.",
    params: [{ name: "hotes", label: "Domaines", required: true, help: "Un domaine, plusieurs séparés par des virgules, ou une liste {{…}}" }, { name: "port", label: "Port", type: "int", default: 443 }],
    run: async (p) => {
      const hosts = (Array.isArray(p.hotes) ? p.hotes : String(p.hotes).split(",")).map((h) => String(typeof h === "object" ? h.hote || h.domaine || h.url : h).replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim()).filter(Boolean);
      const out = [];
      for (const h of hosts) out.push(await certInfo(h, +p.port || 443).catch((e) => ({ hote: h, erreur: e.message, jours_restants: null, valide: false })));
      return Array.isArray(p.hotes) || hosts.length > 1 ? out : out[0];
    },
  },
  {
    name: "dzf_dns_mail", label: "Sécurité : SPF, DMARC, MX d'un domaine", category: "Sécurité", icon: "fas fa-envelope-open-text", output: "dns_mail",
    description: "Vérifie la configuration anti-usurpation d'un domaine mail : SPF, DMARC (et sa politique), MX, DKIM si tu donnes le sélecteur.",
    params: [{ name: "domaine", label: "Domaine", required: true, help: "Ex. ambs-agency.com" }, { name: "selecteur_dkim", label: "Sélecteur DKIM (facultatif)", help: "Ex. default, google, ovh" }],
    run: async (p) => {
      const txt = async (n) => (await dns.resolveTxt(n).catch(() => [])).map((x) => x.join(""));
      const spf = (await txt(p.domaine)).find((t) => t.startsWith("v=spf1")) || "";
      const dmarc = (await txt(`_dmarc.${p.domaine}`)).find((t) => t.startsWith("v=DMARC1")) || "";
      const mx = (await dns.resolveMx(p.domaine).catch(() => [])).sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
      const dkim = p.selecteur_dkim ? (await txt(`${p.selecteur_dkim}._domainkey.${p.domaine}`)).find((t) => /v=DKIM1|p=/.test(t)) || "" : null;
      const politique = (/p=(\w+)/.exec(dmarc) || [])[1] || "";
      const conseils = [];
      if (!spf) conseils.push("Pas de SPF : n'importe qui peut envoyer au nom du domaine.");
      else if (/\+all/.test(spf)) conseils.push("SPF en +all : il autorise tout le monde.");
      else if (/\?all/.test(spf)) conseils.push("SPF en ?all : neutre, préférer ~all ou -all.");
      if (!dmarc) conseils.push("Pas de DMARC : ajoute au moins v=DMARC1; p=none; rua=mailto:…");
      else if (politique === "none") conseils.push("DMARC en p=none : il observe sans protéger. Passer à quarantine puis reject.");
      if (!mx.length) conseils.push("Aucun MX : le domaine ne reçoit pas de mail.");
      if (dkim === "") conseils.push("DKIM introuvable pour ce sélecteur.");
      return { domaine: p.domaine, spf, dmarc, politique_dmarc: politique, mx, dkim, conseils, ok: !conseils.length };
    },
  },
  {
    name: "dzf_masquer", label: "Sécurité : masquer les données perso", category: "Sécurité", icon: "fas fa-mask", output: "masque",
    description: "Remplace e-mails, téléphones, IBAN, cartes bancaires et IP dans un texte (ou une liste) avant de l'envoyer à une IA, un log ou un tiers. RGPD.",
    params: [{ name: "texte", label: "Texte ou liste", required: true }, { name: "quoi", label: "À masquer", default: "email,téléphone,iban,carte,ip", help: "Parmi : email, téléphone, iban, carte, ip" },
      { name: "remplacement", label: "Remplacer par", default: "[masqué]" }],
    run: async (p) => {
      const kinds = String(p.quoi).split(",").map((s) => s.trim()).filter((k) => PII[k]);
      const one = (t) => kinds.reduce((acc, k) => acc.replace(PII[k], p.remplacement || "[masqué]"), String(t ?? ""));
      return Array.isArray(p.texte) ? p.texte.map((x) => (typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === "string" ? one(v) : v])) : one(x))) : one(p.texte);
    },
  },
  {
    name: "dzf_detecter_secrets", label: "Sécurité : détecter des secrets", category: "Sécurité", icon: "fas fa-search-dollar", output: "secrets_trouves",
    description: "Cherche des clés d'API, jetons et clés privées oubliés dans un texte (code, log, mail, document). Renvoie ce qui est trouvé, masqué.",
    params: [{ name: "texte", label: "Texte", required: true, type: "text" }],
    run: async (p) => {
      const t = typeof p.texte === "string" ? p.texte : JSON.stringify(p.texte);
      const found = [];
      for (const [label, re] of SECRETS) for (const m of t.matchAll(re)) found.push({ type: label, extrait: `${m[0].slice(0, 6)}…${m[0].slice(-4)}`, position: m.index });
      return { trouve: found.length > 0, nombre: found.length, elements: found.slice(0, 100) };
    },
  },
  {
    name: "dzf_ip_reputation", label: "Sécurité : réputation d'une IP", category: "Sécurité", icon: "fas fa-user-ninja", output: "ip",
    description: "Score d'abus d'une adresse IP (AbuseIPDB, clé gratuite) : utile pour bloquer ou signaler une IP qui attaque tes formulaires ou ton SSH.",
    params: [{ name: "ip", label: "Adresse IP", required: true }, { name: "secret_cle", label: "Nom du secret de la clé AbuseIPDB", default: "ABUSEIPDB_KEY" }, { name: "jours", label: "Sur les N derniers jours", type: "int", default: 90 }],
    run: async (p, ctx, api) => {
      const r = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(p.ip)}&maxAgeInDays=${+p.jours || 90}`, { headers: { Key: await need(api, p.secret_cle), Accept: "application/json" } });
      const j = await r.json();
      if (!r.ok) throw new Error((j.errors && j.errors[0] && j.errors[0].detail) || `HTTP ${r.status}`);
      const d = j.data || {};
      return { ip: d.ipAddress, score: d.abuseConfidenceScore, signalements: d.totalReports, pays: d.countryCode, fai: d.isp, usage: d.usageType, tor: d.isTor };
    },
  },
  {
    name: "dzf_ports", label: "Sécurité : ports ouverts", category: "Sécurité", icon: "fas fa-door-open", output: "ports",
    description: "Vérifie quels ports répondent sur un serveur (20 ports max). À utiliser sur TES serveurs pour voir ce qui est exposé par erreur (base de données, Redis…).",
    params: [{ name: "hote", label: "Serveur", required: true }, { name: "ports", label: "Ports", default: "22,80,443,3000,5432,6379,8080,9000", help: "Séparés par des virgules" }, { name: "delai_ms", label: "Attente par port (ms)", type: "int", default: 1500 }],
    run: async (p) => {
      const net = require("net");
      const ports = String(p.ports).split(",").map((x) => +x).filter((x) => x > 0 && x < 65536).slice(0, 20);
      const probe = (port) => new Promise((res) => {
        const s = net.createConnection({ host: p.hote, port, timeout: +p.delai_ms || 1500 });
        const done = (open) => { s.destroy(); res({ port, ouvert: open }); };
        s.on("connect", () => done(true)); s.on("timeout", () => done(false)); s.on("error", () => done(false));
      });
      const r = await Promise.all(ports.map(probe));
      return { hote: p.hote, ouverts: r.filter((x) => x.ouvert).map((x) => x.port), details: r };
    },
  },
];
