/* Adaptateur Salesforce (REST + SOQL). Le modèle de données change d'un client à l'autre :
   objets et champs sont donnés par la configuration (valeurs par défaut ci-dessous).
   Connexion OAuth2 : « client_credentials » (app connectée) ou « refresh_token ». */
"use strict";
const { typeBien } = require("../valeurs");

const DEFAUT = {
  version: "v61.0",
  bien: { objet: "Product2", id: "Id", reference: "ProductCode", prix: "Price__c", surface: "Surface__c", pieces: "Rooms__c", type: "Family", ville: "City__c", code_postal: "PostalCode__c", negociateur: "OwnerId", agence: null },
  contact: { objet: "Lead", id: "Id", email: "Email", telephone: "Phone", mobile: "MobilePhone", prenom: "FirstName", nom: "LastName", cree_le: "CreatedDate", origine: "LeadSource", proprietaire: "OwnerId", societe: "Company" },
  lien: { objet: "Task", contact: "WhoId", bien: "WhatId", note: "Description", sujet: "Subject" },
};

const q = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

const creer = (cfg = {}) => {
  const M = { ...DEFAUT, ...cfg, bien: { ...DEFAUT.bien, ...(cfg.bien || {}) }, contact: { ...DEFAUT.contact, ...(cfg.contact || {}) }, lien: { ...DEFAUT.lien, ...(cfg.lien || {}) } };
  const f = cfg.fetch || fetch;
  let session = null;
  const connexion = async () => {
    if (session && Date.now() < session.expire) return session;
    const login = String(cfg.domaine || "https://login.salesforce.com").replace(/\/+$/, "");
    const p = new URLSearchParams();
    const refresh = await cfg.secret("refresh_token");
    p.set("grant_type", refresh ? "refresh_token" : "client_credentials");
    p.set("client_id", await cfg.secret("client_id")); p.set("client_secret", await cfg.secret("client_secret"));
    if (refresh) p.set("refresh_token", refresh);
    const r = await f(login + "/services/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: p.toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw Object.assign(new Error("connexion Salesforce refusée : " + (j.error_description || r.status)), { permanent: true });
    session = { jeton: j.access_token, instance: j.instance_url, expire: Date.now() + 50 * 60000 };
    return session;
  };
  const appel = async (methode, chemin, corps) => {
    if (cfg.lectureSeule && methode !== "GET") throw Object.assign(new Error(`écriture bloquée (mode ombre) : ${methode} ${chemin}`), { permanent: true, ombre: true });
    const s = await connexion();
    const r = await f(`${s.instance}/services/data/${M.version}${chemin}`, { method: methode, headers: { Authorization: "Bearer " + s.jeton, "Content-Type": "application/json", Accept: "application/json" }, body: corps ? JSON.stringify(corps) : undefined });
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) session = null;
    if (!r.ok) throw Object.assign(new Error(`Salesforce ${methode} ${chemin} → ${r.status} : ${JSON.stringify(j).slice(0, 300)}`), { http: r.status, permanent: r.status >= 400 && r.status < 500 && r.status !== 429 });
    return j;
  };
  const soql = async (s) => (await appel("GET", "/query?q=" + encodeURIComponent(s))).records || [];
  const B = M.bien, C = M.contact;
  const champsB = [B.id, B.reference, B.prix, B.surface, B.pieces, B.type, B.ville, B.code_postal, B.negociateur, B.agence].filter(Boolean);
  const champsC = [C.id, C.email, C.telephone, C.mobile, C.prenom, C.nom, C.cree_le].filter(Boolean);
  const versBien = (x) => x && ({ id: x[B.id], reference: x[B.reference], prix: +x[B.prix] || null, surface: +x[B.surface] || null, pieces: +x[B.pieces] || null, type: typeBien(x[B.type] || ""), ville: x[B.ville] || null, code_postal: x[B.code_postal] || null, negociateur_id: x[B.negociateur] || null, agence_id: B.agence ? x[B.agence] : null });
  const versContact = (x) => ({ id: x[C.id], email: x[C.email], emails: [x[C.email]].filter(Boolean), telephone: x[C.telephone], mobile: x[C.mobile], telephones: [x[C.telephone], x[C.mobile]].filter(Boolean).map((t) => String(t).replace(/[^\d+]/g, "")), prenom: x[C.prenom], nom: x[C.nom], cree_le: x[C.cree_le] });
  const selB = `SELECT ${champsB.join(",")} FROM ${B.objet}`, selC = `SELECT ${champsC.join(",")} FROM ${C.objet}`;

  return {
    nom: "salesforce",
    lectureSeule: !!cfg.lectureSeule,
    tester: async () => ({ ok: true, limites: await appel("GET", "/limits") }),
    bienParId: async (id) => versBien((await soql(`${selB} WHERE ${B.id} = ${q(id)} LIMIT 1`))[0]),
    biensParReference: async (ref) => (await soql(`${selB} WHERE ${B.reference} = ${q(ref)} LIMIT 3`)).map(versBien),
    biensParCriteres: async (c, { max = 2 } = {}) => {
      const w = [];
      if (c.pieces && B.pieces) w.push(`${B.pieces} = ${+c.pieces}`);
      if (c.surface && B.surface) w.push(`${B.surface} = ${+c.surface}`);
      if (c.prix && B.prix) w.push(`${B.prix} = ${+c.prix}`);
      if (c.lieu && B.ville) w.push(`(${B.ville} LIKE ${q("%" + c.lieu + "%")}${B.code_postal ? ` OR ${B.code_postal} = ${q(c.lieu)}` : ""})`);
      if (!w.length) return [];
      const l = (await soql(`${selB} WHERE ${w.join(" AND ")} LIMIT ${max + 3}`)).map(versBien);
      return (c.type ? l.filter((x) => !x.type || x.type === c.type) : l).slice(0, max);
    },
    contactsParEmail: async (e) => (await soql(`${selC} WHERE ${C.email} = ${q(e)} ORDER BY ${C.cree_le} DESC LIMIT 20`)).map(versContact),
    contactsParTelephone: async (t) => { const n = String(t).replace(/\D/g, "").slice(-9); return (await soql(`${selC} WHERE ${C.telephone} LIKE ${q("%" + n.slice(-6))} OR ${C.mobile} LIKE ${q("%" + n.slice(-6))} ORDER BY ${C.cree_le} DESC LIMIT 20`)).map(versContact).filter((c) => c.telephones.some((x) => x.replace(/\D/g, "").slice(-9) === n)); },
    creerContact: async (d) => {
      const x = { [C.email]: d.email, [C.prenom]: d.prenom, [C.nom]: d.nom || d.email || "Inconnu", [C.telephone]: d.telephone };
      if (C.societe && C.objet === "Lead") x[C.societe] = d.societe || "Particulier";
      if (C.origine && d.origine_libelle) x[C.origine] = d.origine_libelle;
      if (C.proprietaire && d.negociateur) x[C.proprietaire] = d.negociateur;
      const r = await appel("POST", `/sobjects/${C.objet}`, x);
      return { id: r.id };
    },
    majContact: async (id, p) => { const x = {}; if (p.prenom) x[C.prenom] = p.prenom; if (p.nom) x[C.nom] = p.nom; if (p.telephone) x[C.telephone] = p.telephone; if (p.mobile && C.mobile) x[C.mobile] = p.mobile; if (Object.keys(x).length) await appel("PATCH", `/sobjects/${C.objet}/${id}`, x); return { id }; },
    lierBien: async (contactId, bienId, note) => { const L = M.lien; const r = await appel("POST", `/sobjects/${L.objet}`, { [L.contact]: contactId, ...(L.bien && C.objet !== "Lead" ? { [L.bien]: bienId } : {}), [L.sujet]: "Nouvelle demande", [L.note]: String(note || "").slice(0, 30000) }); return { id: r.id }; },
    /* Consentement : la preuve devient un fichier Salesforce lié au contact ; le motif et la date vont dans le titre. */
    ajouterConsentement: async (contactId, a) => {
      const out = [];
      for (const p of a.preuves || []) {
        const v = await appel("POST", "/sobjects/ContentVersion", { Title: `${a.motif}`.slice(0, 255), PathOnClient: p.nom, VersionData: p.base64, Description: `Consentement du ${String(a.date).slice(0, 10)} — ${a.motif}`.slice(0, 1000) });
        const doc = (await soql(`SELECT ContentDocumentId FROM ContentVersion WHERE Id = ${q(v.id)}`))[0];
        if (doc) out.push(await appel("POST", "/sobjects/ContentDocumentLink", { ContentDocumentId: doc.ContentDocumentId, LinkedEntityId: contactId, ShareType: "V" }));
      }
      return { id: contactId, fichiers: out.length };
    },
  };
};

module.exports = { creer, DEFAUT };
