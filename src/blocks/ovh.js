/* Famille « OVHcloud » : gérer son compte sans ouvrir l'espace client.
   Domaines, zones DNS (enregistrements, sous-domaines, redirections, export/import),
   e-mails MX Plan, hébergements (multisite, SSL, bases), VPS, serveurs dédiés,
   Public Cloud, factures et services qui expirent. Chaque bloc fait une chose
   complète (écriture + rafraîchissement de zone, vérification…). */
"use strict";
const { client, demanderCle, enc } = require("../lib/ovh");

const perm = (m) => Object.assign(new Error(m), { permanent: true });
const ZONES = ["ovh-eu", "ovh-ca", "ovh-us"];
const P_CLES = [
  { name: "cles", label: "Secret des clés OVH", default: "OVH_CLES", help: "« APPLICATION_KEY:APPLICATION_SECRET:CONSUMER_KEY » rangé dans le coffre. Pas de clé ? Bloc « OVH : créer une clé d'accès »." },
  { name: "region", label: "Région", type: "select", options: ZONES, default: "ovh-eu" },
];
const ovh = async (p, api) => { const c = await api.secret(p.cles || "OVH_CLES"); if (!c) throw perm(`secret ${p.cles || "OVH_CLES"} introuvable (coffre ou variable d'environnement)`); return client({ cles: c, zone: p.region }); };
const TYPES_DNS = ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA", "NS", "SPF", "DKIM", "DMARC", "PTR", "TLSA"];
const jours = (d) => (d ? Math.round((new Date(d) - Date.now()) / 864e5) : null);
const sd = (s) => String(s || "").trim().replace(/\.$/, "").replace(/^@$/, "");

/* Assure un enregistrement : crée, ou met à jour s'il existe déjà (même sous-domaine + type). */
const assurer = async (o, zone, { sousDomaine, type, cible, ttl, remplacer = true }) => {
  const q = `/domain/zone/${enc(zone)}/record?fieldType=${enc(type)}&subDomain=${enc(sousDomaine)}`;
  const ids = (await o.get(q)) || [];
  if (ids.length && remplacer) {
    const actuels = await Promise.all(ids.map((id) => o.get(`/domain/zone/${enc(zone)}/record/${id}`)));
    const meme = actuels.find((r) => String(r.target).replace(/\.$/, "") === String(cible).replace(/\.$/, ""));
    if (meme && (!ttl || meme.ttl === +ttl)) return { action: "inchangé", id: meme.id };
    await o.put(`/domain/zone/${enc(zone)}/record/${actuels[0].id}`, { target: cible, ttl: +ttl || 0, subDomain: sousDomaine });
    for (const r of actuels.slice(1)) await o.del(`/domain/zone/${enc(zone)}/record/${r.id}`);
    return { action: "mis à jour", id: actuels[0].id, doublons_supprimes: actuels.length - 1 };
  }
  const r = await o.post(`/domain/zone/${enc(zone)}/record`, { fieldType: type, subDomain: sousDomaine, target: cible, ttl: +ttl || 0 });
  return { action: "créé", id: r && r.id };
};
const rafraichir = (o, zone) => o.post(`/domain/zone/${enc(zone)}/refresh`);

/* Vérifie la réponse DNS publique (DNS over HTTPS, Cloudflare). */
const resoudre = async (nom, type) => {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${enc(nom)}&type=${enc(type)}`, { headers: { Accept: "application/dns-json" } });
  const j = await r.json();
  return (j.Answer || []).map((a) => String(a.data).replace(/\.$/, "").replace(/^"|"$/g, ""));
};

module.exports = [
  {
    name: "dzf_ovh_cle", label: "OVH : créer une clé d'accès", category: "OVHcloud", icon: "fas fa-key", output: "cle_ovh",
    description: "Prépare une clé d'accès (consumer key) avec les droits choisis. OVH renvoie un lien à ouvrir une seule fois pour valider ; ensuite range « AK:AS:CK » dans le coffre.",
    params: [
      { name: "application_key", label: "Application key", required: true, help: "Créée sur https://eu.api.ovh.com/createApp/ (une seule fois)." },
      { name: "region", label: "Région", type: "select", options: ZONES, default: "ovh-eu" },
      { name: "droits", label: "Droits", type: "select", options: ["tout (GET/POST/PUT/DELETE sur /*)", "lecture seule (GET /*)", "DNS et domaines seulement", "e-mails seulement", "sur mesure"], default: "DNS et domaines seulement" },
      { name: "sur_mesure", label: "Droits sur mesure (JSON)", type: "json", showIf: { droits: "sur mesure" }, help: '[{"method":"GET","path":"/domain/*"}]' },
      { name: "retour", label: "Page de retour après validation", help: "Facultatif" },
    ],
    run: async (p) => {
      const M = ["GET", "POST", "PUT", "DELETE"];
      const tout = (chemins) => chemins.flatMap((path) => M.map((method) => ({ method, path })));
      const droits = { "tout (GET/POST/PUT/DELETE sur /*)": tout(["/*"]), "lecture seule (GET /*)": [{ method: "GET", path: "/*" }], "DNS et domaines seulement": tout(["/domain/*"]), "e-mails seulement": tout(["/email/*"]) }[p.droits] || (typeof p.sur_mesure === "string" ? JSON.parse(p.sur_mesure) : p.sur_mesure);
      const r = await demanderCle({ ak: p.application_key, zone: p.region, droits, retour: p.retour });
      return { lien_validation: r.validationUrl, consumer_key: r.consumerKey, etat: r.state, a_faire: "Ouvre le lien, connecte-toi, valide ; puis range « APPLICATION_KEY:APPLICATION_SECRET:CONSUMER_KEY » dans le coffre (OVH_CLES)." };
    },
  },
  {
    name: "dzf_ovh_compte", label: "OVH : compte et échéances", category: "OVHcloud", icon: "fas fa-id-card", output: "ovh_compte", timeout: 120,
    description: "Ton compte (nic, contact), et la liste de tes services avec leur date d'expiration et le renouvellement : pour voir d'un coup ce qui expire bientôt.",
    params: [...P_CLES, { name: "sous", label: "Services qui expirent dans moins de (jours)", type: "int", default: 60, help: "0 = tous les services" }],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api);
      const me = await o.get("/me");
      const ids = (await o.get("/services")) || [];
      const services = [];
      for (const id of ids.slice(0, 300)) {
        try {
          const s = await o.get(`/services/${id}`);
          const exp = s.billing && s.billing.expirationDate;
          services.push({ id, nom: s.resource && (s.resource.displayName || s.resource.name), produit: s.resource && s.resource.product && s.resource.product.name, expire_le: exp, dans_jours: jours(exp), renouvellement: s.billing && s.billing.renew && s.billing.renew.current && s.billing.renew.current.mode, etat: s.billing && s.billing.lifecycle && s.billing.lifecycle.current && s.billing.lifecycle.current.state });
        } catch (e) { services.push({ id, erreur: e.message }); }
      }
      const filtre = +p.sous ? services.filter((s) => s.dans_jours !== null && s.dans_jours <= +p.sous) : services;
      return { compte: { nic: me.nichandle, nom: [me.firstname, me.name].filter(Boolean).join(" "), email: me.email, pays: me.country }, services: filtre.sort((a, b) => (a.dans_jours ?? 9e9) - (b.dans_jours ?? 9e9)), total: services.length };
    },
  },
  {
    name: "dzf_ovh_domaines", label: "OVH : domaines", category: "OVHcloud", icon: "fas fa-globe", output: "domaines", timeout: 120,
    description: "Liste tes noms de domaine avec expiration, renouvellement automatique, serveurs DNS, verrouillage et DNSSEC. Ou change les serveurs DNS / le verrou d'un domaine.",
    params: [...P_CLES,
      { name: "action", label: "Action", type: "select", options: ["lister", "détail", "changer les serveurs DNS", "verrouiller", "déverrouiller"], default: "lister" },
      { name: "domaine", label: "Domaine", showIf: { action: ["détail", "changer les serveurs DNS", "verrouiller", "déverrouiller"] } },
      { name: "serveurs", label: "Serveurs DNS (un par ligne)", type: "text", showIf: { action: "changer les serveurs DNS" } },
    ],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api);
      const d = enc(p.domaine);
      const fiche = async (nom) => {
        const [info, svc, dns] = await Promise.all([o.get(`/domain/${enc(nom)}`), o.get(`/domain/${enc(nom)}/serviceInfos`).catch(() => ({})), o.get(`/domain/${enc(nom)}/nameServer`).catch(() => [])]);
        const ns = await Promise.all((dns || []).slice(0, 8).map((id) => o.get(`/domain/${enc(nom)}/nameServer/${id}`).then((x) => x.host).catch(() => null)));
        return { domaine: nom, expire_le: svc.expiration, dans_jours: jours(svc.expiration), renouvellement_auto: !!(svc.renew && svc.renew.automatic), serveurs_dns: ns.filter(Boolean), type_dns: info.nameServerType, verrou: info.transferLockStatus, dnssec: info.dnssecSupported ? "possible" : "non" };
      };
      if (p.action === "lister") { const noms = (await o.get("/domain")) || []; const out = []; for (const n of noms.slice(0, 200)) out.push(await fiche(n).catch((e) => ({ domaine: n, erreur: e.message }))); return out.sort((a, b) => (a.dans_jours ?? 9e9) - (b.dans_jours ?? 9e9)); }
      if (!p.domaine) throw perm("indique le domaine");
      if (p.action === "détail") return fiche(p.domaine);
      if (p.action === "changer les serveurs DNS") { const hosts = String(p.serveurs || "").split(/[\s,;]+/).filter(Boolean); if (hosts.length < 2) throw perm("au moins deux serveurs DNS"); return o.post(`/domain/${d}/nameServers/update`, { nameServers: hosts.map((host) => ({ host })) }); }
      await o.put(`/domain/${d}`, { transferLockStatus: p.action === "verrouiller" ? "locked" : "unlocked" });
      return fiche(p.domaine);
    },
  },
  {
    name: "dzf_ovh_dns", label: "OVH : enregistrements DNS", category: "OVHcloud", icon: "fas fa-network-wired", output: "dns", timeout: 120,
    description: "Lister, créer ou mettre à jour (sans doublon), supprimer un enregistrement d'une zone (A, AAAA, CNAME, MX, TXT, SRV, CAA…). La zone est rafraîchie après chaque écriture ; option : vérifier la réponse DNS publique.",
    params: [...P_CLES,
      { name: "zone", label: "Zone (domaine)", required: true, help: "Ex. mondomaine.fr" },
      { name: "action", label: "Action", type: "select", options: ["lister", "créer ou mettre à jour", "ajouter (sans remplacer)", "supprimer"], default: "lister" },
      { name: "type", label: "Type", type: "select", options: ["(tous)", ...TYPES_DNS], default: "(tous)" },
      { name: "sous_domaine", label: "Sous-domaine", help: "Vide = le domaine lui-même. Ex. www, api, _dmarc" },
      { name: "cible", label: "Valeur / cible", showIf: { action: ["créer ou mettre à jour", "ajouter (sans remplacer)", "supprimer"] }, help: "Ex. 51.68.1.2, monsite.netlify.app., \"v=spf1 include:mx.ovh.com ~all\", 10 mx1.mail.ovh.net." },
      { name: "ttl", label: "TTL (secondes)", type: "int", default: 0, help: "0 = TTL par défaut de la zone" },
      { name: "verifier", label: "Vérifier la réponse DNS publique", type: "bool", default: false },
    ],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api);
      const z = String(p.zone || "").trim(), s = sd(p.sous_domaine), t = p.type === "(tous)" ? "" : p.type;
      if (!z) throw perm("indique la zone");
      if (p.action === "lister") {
        const q = `/domain/zone/${enc(z)}/record?${t ? "fieldType=" + enc(t) + "&" : ""}${p.sous_domaine !== undefined && p.sous_domaine !== "" ? "subDomain=" + enc(s) : ""}`;
        const ids = (await o.get(q)) || [];
        const l = await Promise.all(ids.slice(0, 500).map((id) => o.get(`/domain/zone/${enc(z)}/record/${id}`)));
        return l.map((r) => ({ id: r.id, nom: (r.subDomain ? r.subDomain + "." : "") + z, sous_domaine: r.subDomain, type: r.fieldType, cible: r.target, ttl: r.ttl })).sort((a, b) => a.nom.localeCompare(b.nom) || a.type.localeCompare(b.type));
      }
      if (!t) throw perm("choisis le type d'enregistrement");
      let res;
      if (p.action === "supprimer") {
        const ids = (await o.get(`/domain/zone/${enc(z)}/record?fieldType=${enc(t)}&subDomain=${enc(s)}`)) || [];
        const l = await Promise.all(ids.map((id) => o.get(`/domain/zone/${enc(z)}/record/${id}`)));
        const cible = l.filter((r) => !p.cible || String(r.target).replace(/\.$/, "") === String(p.cible).replace(/\.$/, ""));
        for (const r of cible) await o.del(`/domain/zone/${enc(z)}/record/${r.id}`);
        res = { action: "supprimé", nombre: cible.length };
      } else {
        if (!p.cible) throw perm("indique la valeur / cible");
        res = await assurer(o, z, { sousDomaine: s, type: t, cible: p.cible, ttl: p.ttl, remplacer: p.action === "créer ou mettre à jour" });
      }
      if (res.action !== "inchangé") await rafraichir(o, z);
      res.nom = (s ? s + "." : "") + z; res.type = t;
      if (p.verifier) res.reponse_publique = await resoudre(res.nom, t).catch((e) => "vérification impossible : " + e.message);
      return res;
    },
  },
  {
    name: "dzf_ovh_sous_domaine", label: "OVH : créer un sous-domaine", category: "OVHcloud", icon: "fas fa-sitemap", output: "sous_domaine", timeout: 180,
    description: "Crée un sous-domaine complet en une fois : l'enregistrement DNS (A/AAAA vers une IP, ou CNAME vers un nom), et si tu veux l'ajout sur ton hébergement web OVH (dossier + SSL Let's Encrypt). Refait sans rien casser s'il existe déjà.",
    params: [...P_CLES,
      { name: "zone", label: "Domaine", required: true },
      { name: "sous_domaine", label: "Sous-domaine", required: true, help: "Ex. crm, app, client1" },
      { name: "vers", label: "Pointe vers", type: "select", options: ["une adresse IP", "un autre nom (CNAME)", "mon hébergement web OVH"], default: "une adresse IP" },
      { name: "cible", label: "IP ou nom cible", showIf: { vers: ["une adresse IP", "un autre nom (CNAME)"] }, help: "IPv4, IPv6 ou nom (ex. mon-app.fly.dev)" },
      { name: "hebergement", label: "Hébergement web (nom du service)", showIf: { vers: "mon hébergement web OVH" }, help: "Ex. monsite.cluster030.hosting.ovh.net — bloc « OVH : hébergement web » pour les voir" },
      { name: "dossier", label: "Dossier sur l'hébergement", default: "", showIf: { vers: "mon hébergement web OVH" }, help: "Vide = ./<sous-domaine>" },
      { name: "ssl", label: "Activer le SSL", type: "bool", default: true, showIf: { vers: "mon hébergement web OVH" } },
      { name: "verifier", label: "Vérifier la réponse DNS publique", type: "bool", default: true },
    ],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api);
      const z = String(p.zone).trim(), s = sd(p.sous_domaine), nom = `${s}.${z}`;
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(s)) throw perm("sous-domaine invalide (lettres, chiffres, tirets)");
      const etapes = [];
      if (p.vers === "mon hébergement web OVH") {
        if (!p.hebergement) throw perm("indique l'hébergement web");
        const H = `/hosting/web/${enc(p.hebergement)}`;
        const deja = await o.get(`${H}/attachedDomain/${enc(nom)}`).catch(() => null);
        if (deja) etapes.push({ etape: "hébergement", action: "déjà attaché", dossier: deja.path });
        else { const t = await o.post(`${H}/attachedDomain`, { domain: nom, path: p.dossier || `./${s}`, ssl: !!p.ssl, firewall: "none", ownLog: z, cdn: "none" }); etapes.push({ etape: "hébergement", action: "attaché", tache: t && t.id }); }
        const info = await o.get(H);
        const ip4 = info.hostingIp, ip6 = info.hostingIpv6;
        if (ip4) etapes.push({ etape: "DNS A", ...(await assurer(o, z, { sousDomaine: s, type: "A", cible: ip4 })) });
        if (ip6) etapes.push({ etape: "DNS AAAA", ...(await assurer(o, z, { sousDomaine: s, type: "AAAA", cible: ip6 })) });
        if (p.ssl) { const ssl = await o.get(`${H}/ssl`).catch(() => null); if (!ssl) { await o.post(`${H}/ssl`, {}).catch((e) => etapes.push({ etape: "SSL", erreur: e.message })); etapes.push({ etape: "SSL", action: "demandé (Let's Encrypt)" }); } else { await o.post(`${H}/ssl/regenerate`).catch(() => {}); etapes.push({ etape: "SSL", action: "régénéré pour inclure " + nom }); } }
      } else {
        if (!p.cible) throw perm("indique l'IP ou le nom cible");
        const ip = String(p.cible).trim();
        const type = p.vers === "un autre nom (CNAME)" ? "CNAME" : /:/.test(ip) ? "AAAA" : "A";
        const cible = type === "CNAME" && !ip.endsWith(".") ? ip + "." : ip;
        etapes.push({ etape: "DNS " + type, ...(await assurer(o, z, { sousDomaine: s, type, cible })) });
      }
      await rafraichir(o, z);
      etapes.push({ etape: "zone", action: "rafraîchie" });
      const res = { nom, etapes };
      if (p.verifier) res.reponse_publique = await resoudre(nom, p.vers === "un autre nom (CNAME)" ? "CNAME" : "A").catch((e) => "vérification impossible : " + e.message);
      res.note = "La propagation DNS prend de quelques minutes à quelques heures.";
      return res;
    },
  },
  {
    name: "dzf_ovh_zone", label: "OVH : zone DNS (export, import, DNSSEC)", category: "OVHcloud", icon: "fas fa-file-export", output: "zone", timeout: 120,
    description: "Sauvegarde la zone (format BIND), la restaure depuis un texte, la rafraîchit, ou active/désactive DNSSEC.",
    params: [...P_CLES, { name: "zone", label: "Zone", required: true },
      { name: "action", label: "Action", type: "select", options: ["exporter", "importer", "rafraîchir", "état DNSSEC", "activer DNSSEC", "désactiver DNSSEC"], default: "exporter" },
      { name: "contenu", label: "Zone à importer (BIND)", type: "code", showIf: { action: "importer" } }],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api); const z = enc(p.zone);
      switch (p.action) {
        case "exporter": return { zone: p.zone, bind: await o.get(`/domain/zone/${z}/export`), le: new Date().toISOString() };
        case "importer": if (!p.contenu) throw perm("colle la zone au format BIND"); return o.post(`/domain/zone/${z}/import`, { zoneFile: p.contenu });
        case "rafraîchir": await rafraichir(o, p.zone); return { zone: p.zone, rafraichie: true };
        case "état DNSSEC": return o.get(`/domain/zone/${z}/dnssec`);
        case "activer DNSSEC": return o.post(`/domain/zone/${z}/dnssec`);
        default: return o.del(`/domain/zone/${z}/dnssec`);
      }
    },
  },
  {
    name: "dzf_ovh_redirection", label: "OVH : redirections web", category: "OVHcloud", icon: "fas fa-share", output: "redirections",
    description: "Redirige un (sous-)domaine vers une adresse web (301 visible, 302, ou invisible) ; liste ou supprime les redirections.",
    params: [...P_CLES, { name: "zone", label: "Domaine", required: true },
      { name: "action", label: "Action", type: "select", options: ["lister", "créer", "supprimer"], default: "lister" },
      { name: "sous_domaine", label: "Sous-domaine", showIf: { action: ["créer", "supprimer"] } },
      { name: "vers", label: "Adresse de destination", showIf: { action: "créer" }, help: "https://…" },
      { name: "type", label: "Type", type: "select", options: ["visiblePermanent", "visible", "invisible"], default: "visiblePermanent", showIf: { action: "créer" } }],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api); const z = enc(p.zone), s = sd(p.sous_domaine);
      const lister = async () => Promise.all(((await o.get(`/domain/zone/${z}/redirection`)) || []).map((id) => o.get(`/domain/zone/${z}/redirection/${id}`)));
      if (p.action === "lister") return (await lister()).map((r) => ({ id: r.id, depuis: (r.subDomain ? r.subDomain + "." : "") + p.zone, vers: r.target, type: r.type }));
      if (p.action === "créer") { if (!/^https?:\/\//.test(p.vers || "")) throw perm("adresse de destination en http(s)://"); const r = await o.post(`/domain/zone/${z}/redirection`, { subDomain: s, target: p.vers, type: p.type }); await rafraichir(o, p.zone); return r; }
      const l = (await lister()).filter((r) => (r.subDomain || "") === s);
      for (const r of l) await o.del(`/domain/zone/${z}/redirection/${r.id}`);
      await rafraichir(o, p.zone); return { supprimees: l.length };
    },
  },
  {
    name: "dzf_ovh_emails", label: "OVH : e-mails (MX Plan)", category: "OVHcloud", icon: "fas fa-at", output: "emails", timeout: 120,
    description: "Boîtes mail d'un domaine (MX Plan) : lister avec l'espace utilisé, créer, changer le mot de passe, supprimer ; redirections (alias) : lister, créer, supprimer ; répondeur d'absence.",
    params: [...P_CLES, { name: "domaine", label: "Domaine", required: true },
      { name: "action", label: "Action", type: "select", options: ["lister les boîtes", "créer une boîte", "changer le mot de passe", "supprimer une boîte", "lister les redirections", "créer une redirection", "supprimer une redirection", "activer le répondeur", "couper le répondeur"], default: "lister les boîtes" },
      { name: "compte", label: "Nom de la boîte (avant @)", showIf: { action: ["créer une boîte", "changer le mot de passe", "supprimer une boîte", "activer le répondeur", "couper le répondeur"] } },
      { name: "secret_mdp", label: "Secret du mot de passe", default: "", showIf: { action: ["créer une boîte", "changer le mot de passe"] }, help: "Nom du secret dans le coffre (jamais en clair dans le workflow)" },
      { name: "taille", label: "Taille (Mo)", type: "int", default: 5000, showIf: { action: "créer une boîte" } },
      { name: "de", label: "Adresse redirigée", showIf: { action: ["créer une redirection", "supprimer une redirection"] } },
      { name: "vers", label: "Vers", showIf: { action: "créer une redirection" } },
      { name: "garder_copie", label: "Garder une copie", type: "bool", default: false, showIf: { action: "créer une redirection" } },
      { name: "message", label: "Message d'absence", type: "text", showIf: { action: "activer le répondeur" } },
      { name: "jusqu_au", label: "Jusqu'au (AAAA-MM-JJ)", showIf: { action: "activer le répondeur" } }],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api); const D = `/email/domain/${enc(p.domaine)}`;
      const mdp = async () => { const v = p.secret_mdp && (await api.secret(p.secret_mdp)); if (!v) throw perm("mot de passe introuvable : range-le dans le coffre et indique son nom"); if (v.length < 9) throw perm("mot de passe trop court (9 caractères minimum chez OVH)"); return v; };
      switch (p.action) {
        case "lister les boîtes": return (await o.detailler(`${D}/account`, (a) => `${D}/account/${enc(a)}`)).map((a) => ({ adresse: `${a.accountName}@${p.domaine}`, taille_mo: Math.round((a.size || 0) / 1048576), bloquee: !!a.isBlocked, description: a.description }));
        case "créer une boîte": return o.post(`${D}/account`, { accountName: p.compte, password: await mdp(), size: (+p.taille || 5000) * 1048576 });
        case "changer le mot de passe": return o.post(`${D}/account/${enc(p.compte)}/changePassword`, { password: await mdp() });
        case "supprimer une boîte": return o.del(`${D}/account/${enc(p.compte)}`);
        case "lister les redirections": return (await o.detailler(`${D}/redirection`, (id) => `${D}/redirection/${id}`)).map((r) => ({ id: r.id, de: r.from, vers: r.to }));
        case "créer une redirection": return o.post(`${D}/redirection`, { from: p.de, to: p.vers, localCopy: !!p.garder_copie });
        case "supprimer une redirection": { const l = (await o.detailler(`${D}/redirection?from=${enc(p.de)}`, (id) => `${D}/redirection/${id}`)); for (const r of l) await o.del(`${D}/redirection/${r.id}`); return { supprimees: l.length }; }
        case "activer le répondeur": return o.post(`${D}/responder`, { account: p.compte, content: p.message || "Je suis absent.", copy: false, from: new Date().toISOString(), to: p.jusqu_au ? new Date(p.jusqu_au + "T23:59:00").toISOString() : undefined });
        default: return o.del(`${D}/responder/${enc(p.compte)}`);
      }
    },
  },
  {
    name: "dzf_ovh_hebergement", label: "OVH : hébergement web", category: "OVHcloud", icon: "fas fa-server", output: "hebergement", timeout: 120,
    description: "Tes hébergements web : état, offre, espace disque, domaines attachés (multisite), SSL, bases de données ; détacher un domaine ; régénérer le SSL.",
    params: [...P_CLES, { name: "action", label: "Action", type: "select", options: ["lister", "détail", "domaines attachés", "détacher un domaine", "état SSL", "régénérer le SSL", "bases de données"], default: "lister" },
      { name: "service", label: "Hébergement", showIf: { action: ["détail", "domaines attachés", "détacher un domaine", "état SSL", "régénérer le SSL", "bases de données"] } },
      { name: "domaine", label: "Domaine à détacher", showIf: { action: "détacher un domaine" } }],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api); const H = `/hosting/web/${enc(p.service)}`;
      if (p.action === "lister") return (await o.detailler("/hosting/web", (s) => `/hosting/web/${enc(s)}`)).map((h) => ({ service: h.serviceName, offre: h.offer, etat: h.state, cluster: h.cluster, ip: h.hostingIp, disque_go: h.quotaSize && h.quotaSize.value, utilise: h.quotaUsed && `${h.quotaUsed.value} ${h.quotaUsed.unit}` }));
      if (!p.service) throw perm("indique l'hébergement");
      switch (p.action) {
        case "détail": return o.get(H);
        case "domaines attachés": return (await o.detailler(`${H}/attachedDomain`, (d) => `${H}/attachedDomain/${enc(d)}`)).map((d) => ({ domaine: d.domain, dossier: d.path, ssl: d.ssl, cdn: d.cdn, pare_feu: d.firewall, etat: d.status }));
        case "détacher un domaine": return o.del(`${H}/attachedDomain/${enc(p.domaine)}`);
        case "état SSL": return o.get(`${H}/ssl`).then(async (s) => ({ ...s, domaines: await o.get(`${H}/ssl/domains`).catch(() => []) }));
        case "régénérer le SSL": return o.post(`${H}/ssl/regenerate`);
        default: return (await o.detailler(`${H}/database`, (d) => `${H}/database/${enc(d)}`)).map((d) => ({ nom: d.name, type: d.type, version: d.version, etat: d.state, serveur: d.server, taille: d.quotaUsed && `${d.quotaUsed.value} ${d.quotaUsed.unit}` }));
      }
    },
  },
  {
    name: "dzf_ovh_vps", label: "OVH : VPS", category: "OVHcloud", icon: "fas fa-hdd", output: "vps", timeout: 120,
    description: "Tes VPS : état, IP, offre, zone ; redémarrer, démarrer, arrêter ; snapshot (créer, restaurer, supprimer) ; dernières tâches.",
    params: [...P_CLES, { name: "action", label: "Action", type: "select", options: ["lister", "détail", "redémarrer", "démarrer", "arrêter", "créer un snapshot", "restaurer le snapshot", "supprimer le snapshot", "tâches"], default: "lister" },
      { name: "service", label: "VPS", showIf: { action: ["détail", "redémarrer", "démarrer", "arrêter", "créer un snapshot", "restaurer le snapshot", "supprimer le snapshot", "tâches"] } },
      { name: "description_snapshot", label: "Description du snapshot", showIf: { action: "créer un snapshot" } }],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api); const V = `/vps/${enc(p.service)}`;
      if (p.action === "lister") return Promise.all(((await o.get("/vps")) || []).map(async (s) => { const v = await o.get(`/vps/${enc(s)}`).catch((e) => ({ erreur: e.message })); const ips = await o.get(`/vps/${enc(s)}/ips`).catch(() => []); return { service: s, nom: v.displayName, etat: v.state, offre: v.model && v.model.name, zone: v.zone, ips }; }));
      if (!p.service) throw perm("indique le VPS");
      switch (p.action) {
        case "détail": return o.get(V);
        case "redémarrer": return o.post(`${V}/reboot`);
        case "démarrer": return o.post(`${V}/start`);
        case "arrêter": return o.post(`${V}/stop`);
        case "créer un snapshot": return o.post(`${V}/createSnapshot`, { description: p.description_snapshot || "dysizz " + new Date().toISOString().slice(0, 16) });
        case "restaurer le snapshot": return o.post(`${V}/snapshot/revert`);
        case "supprimer le snapshot": return o.del(`${V}/snapshot`);
        default: return (await o.detailler(`${V}/tasks`, (id) => `${V}/tasks/${id}`, { max: 20 })).map((t) => ({ id: t.id, type: t.type, etat: t.state, progression: t.progress, date: t.date }));
      }
    },
  },
  {
    name: "dzf_ovh_dedie", label: "OVH : serveurs dédiés", category: "OVHcloud", icon: "fas fa-server", output: "dedies", timeout: 120,
    description: "Tes serveurs dédiés : état, IP, datacenter, OS, supervision ; redémarrer (hard reboot) ; tâches en cours.",
    params: [...P_CLES, { name: "action", label: "Action", type: "select", options: ["lister", "détail", "redémarrer", "tâches"], default: "lister" }, { name: "service", label: "Serveur", showIf: { action: ["détail", "redémarrer", "tâches"] } }],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api); const S = `/dedicated/server/${enc(p.service)}`;
      if (p.action === "lister") return (await o.detailler("/dedicated/server", (s) => `/dedicated/server/${enc(s)}`)).map((s) => ({ service: s.name, nom: s.reverse, ip: s.ip, datacenter: s.datacenter, os: s.os, etat: s.state, supervision: s.monitoring }));
      if (!p.service) throw perm("indique le serveur");
      if (p.action === "détail") return o.get(S);
      if (p.action === "redémarrer") return o.post(`${S}/reboot`);
      return (await o.detailler(`${S}/task`, (id) => `${S}/task/${id}`, { max: 20 })).map((t) => ({ id: t.taskId, fonction: t.function, etat: t.status, debut: t.startDate, fin: t.doneDate }));
    },
  },
  {
    name: "dzf_ovh_cloud", label: "OVH : Public Cloud", category: "OVHcloud", icon: "fas fa-cloud", output: "cloud", timeout: 120,
    description: "Projets Public Cloud et instances : lister (état, région, IP, gabarit), redémarrer, démarrer, arrêter.",
    params: [...P_CLES, { name: "action", label: "Action", type: "select", options: ["projets", "instances", "redémarrer", "démarrer", "arrêter"], default: "projets" },
      { name: "projet", label: "Projet (id)", showIf: { action: ["instances", "redémarrer", "démarrer", "arrêter"] } }, { name: "instance", label: "Instance (id)", showIf: { action: ["redémarrer", "démarrer", "arrêter"] } }],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api); const C = `/cloud/project/${enc(p.projet)}`;
      if (p.action === "projets") return (await o.detailler("/cloud/project", (id) => `/cloud/project/${enc(id)}`)).map((x) => ({ id: x.project_id, nom: x.description, etat: x.status }));
      if (!p.projet) throw perm("indique le projet");
      if (p.action === "instances") return ((await o.get(`${C}/instance`)) || []).map((i) => ({ id: i.id, nom: i.name, etat: i.status, region: i.region, gabarit: i.flavorId, ip: (i.ipAddresses || []).map((a) => a.ip) }));
      if (!p.instance) throw perm("indique l'instance");
      return o.post(`${C}/instance/${enc(p.instance)}/${{ "redémarrer": "reboot", "démarrer": "start", "arrêter": "stop" }[p.action]}`, p.action === "redémarrer" ? { type: "soft" } : {});
    },
  },
  {
    name: "dzf_ovh_factures", label: "OVH : factures", category: "OVHcloud", icon: "fas fa-file-invoice-dollar", output: "factures", timeout: 120,
    description: "Tes factures sur une période (montant HT/TTC, lien PDF), le total, et les commandes non payées.",
    params: [...P_CLES, { name: "depuis_jours", label: "Depuis (jours)", type: "int", default: 90 }, { name: "impayees", label: "Ajouter les commandes non payées", type: "bool", default: true }],
    run: async (p, ctx, api) => {
      const o = await ovh(p, api);
      const depuis = new Date(Date.now() - (+p.depuis_jours || 90) * 864e5).toISOString().slice(0, 10);
      const f = (await o.detailler(`/me/bill?date.from=${depuis}`, (id) => `/me/bill/${enc(id)}`)).map((b) => ({ id: b.billId, date: b.date, ht: b.priceWithoutTax && b.priceWithoutTax.value, ttc: b.priceWithTax && b.priceWithTax.value, devise: b.priceWithTax && b.priceWithTax.currencyCode, pdf: b.pdfUrl }));
      const out = { factures: f.sort((a, b) => String(b.date).localeCompare(String(a.date))), total_ttc: Math.round(f.reduce((s, x) => s + (+x.ttc || 0), 0) * 100) / 100 };
      if (p.impayees) { const cmd = await o.detailler(`/me/order?date.from=${depuis}`, (id) => `/me/order/${id}`, { max: 50 }); const st = await Promise.all(cmd.map((c) => (c && c.orderId ? o.get(`/me/order/${c.orderId}/status`).catch(() => "?") : "?"))); out.commandes_non_payees = cmd.map((c, i) => ({ id: c.orderId, date: c.date, ttc: c.priceWithTax && c.priceWithTax.value, statut: st[i], lien: c.url })).filter((c) => c.id && /notPaid|checking/.test(c.statut)); }
      return out;
    },
  },
];
