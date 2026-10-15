/* Bot WhatsApp des leads, côté plateforme : les trois réponses que le bot demande à l'application.
     contexte  : qui est ce numéro, quel bien (relu dans le CRM et enregistré dans l'application, ou bien fictif de
                 l'application ; champs publics seulement), qui reçoit ;
     evenement : range la conversation, écrit dans le CRM, prévient les équipes ;
     fiche     : fabrique la fiche PDF du bien et l'envoie par WhatsApp, une seule fois par dossier.
   Réglages : champ « bot » des réglages du client (JSON), relu à chaque appel :
     { "entite": "…", "notifications": "simuler" | "essai" | "reel", "adresses_essai": ["…"], "ecritures_crm": false,
       "couleurs": { "HOT": 0, "WARM": 0, "COLD": 0 }, "actions": { "OUT-1": 0, "defaut": 0 }, "referents": { "f": [], "w": [], "i": [] },
       "liens_directs": false, "whatsapp": { "phone_number_id": "…", "variable_jeton": "…" },
       "numeros_essai": { "33600000000": { "bien": "id du CRM ou d'un bien fictif", "reference": "ou sa référence", "prenom": "…", "nom": "…", "email": "…", "negociateur": "id" } },
       "fraicheur_bien_s": 120, "essai_routage": false }
   Un numéro d'essai n'a pas de dossier : rien n'est écrit dans le CRM, et ses messages ne vont qu'aux adresses d'essai. */
"use strict";
const S = require("./schema");
const { charger, json, liste } = require("./conf");
const { flowApi } = require("./core");
const B = require("../bot");

const perm = (m) => Object.assign(new Error(m), { permanent: true });
const court = (v, n) => String(v == null ? "" : v).slice(0, n);
/* adresses d'un réglage : liste ou texte */
const adresses = (x) => liste([].concat(x || []).join(" ")).map((a) => a.toLowerCase()).filter((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));

const tableBot = async (t) => t.bot || (await require("../../structure").assurer(S.definitions().find((d) => d.k === "bot"))).t;

const trouver = async (t, corps, R) => {
  const tel = String((corps && corps.telephone) || "").replace(/\D/g, "");
  if (tel.length < 8 || tel.length > 15) throw perm("téléphone invalide");
  const essai = (R.numeros_essai || {})[tel];
  if (essai) return { tel, dossier: { id: null, essai: true, bien_crm: essai.bien || null, bien_ref: essai.reference || null, negociateur: essai.negociateur || null, prenom: essai.prenom || "",
    nom: essai.nom || essai.prenom || "Essai", email: essai.email || null, portail: "essai" } };
  const rows = await t.dossiers.getRows({ tel9: B.tel9(tel) }, { orderBy: "maj_le", orderDesc: true, limit: 10 });
  const id = +corps.dossier_id || null;
  return { tel, dossier: (id && rows.find((r) => r.id === id)) || rows.find((r) => r.bien_crm) || rows[0] || null };
};

/* Le bien et ses photos (réglage « photos » = dossier d'images publiques, ex. « pr_p » ; vide = aucune photo) :
   relu dans le CRM et enregistré dans l'application (ld_biens), ou pris dans l'application s'il est fictif, relu il y a
   moins de fraicheur_bien_s, ou si le CRM est lent ou en panne (catalogue.bienFrais). Inconnu partout ou retiré : null. */
const lireBien = async (crm, dossier, R = {}) => {
  try {
    const cat = require("./catalogue");
    const c = flowApi().crmDepuisCoffre(crm.type, crm.reglages, crm.prefixe, "ombre");
    let id = dossier.bien_crm || null;
    if (!id && dossier.bien_ref) {
      const f = await cat.fictifsParReference(dossier.bien_ref);
      id = f[0] ? f[0].id : ((await c.biensParReference(dossier.bien_ref).catch(() => []))[0] || {}).id || null;
    }
    return id == null ? null : await cat.bienFrais(c, id, { dossierImages: String(R.photos || ""), fraicheur_ms: (+R.fraicheur_bien_s || 120) * 1000 });
  } catch (e) { return null; }
};

const etatDe = async (tb, tel, dossier) => {
  const rows = await tb.getRows({ tel9: B.tel9(tel), type: { in: ["optout", "fiche_envoyee", "ouverture", "sortie"] } }, { orderBy: "id", orderDesc: true, limit: 200 });
  const id = (dossier && dossier.id) || null, miens = rows.filter((r) => (r.dossier || null) === id);
  const sortie = miens.find((r) => r.type === "sortie");
  return { optout: rows.some((r) => r.type === "optout"), fiche: miens.some((r) => r.type === "fiche_envoyee"), ouverture: miens.some((r) => r.type === "ouverture"), statut: sortie ? json(sortie.donnees, {}).statut || "" : "" };
};

const contexte = async (corps, R) => {
  const t = await S.tables(), tb = await tableBot(t);
  const { tel, dossier } = await trouver(t, corps, R);
  const etat = await etatDe(tb, tel, dossier);
  if (!dossier) return B.contexte({ dossier: null, etat });
  const { conf, crm } = await charger();
  const [bien, leads] = await Promise.all([lireBien(crm, dossier, R), dossier.id ? t.leads.getRows({ dossier_id: dossier.id }, { orderBy: "id", orderDesc: true, limit: 1 }) : []]);
  const photos = R.photos && bien && Array.isArray(bien.photos) ? bien.photos : [];
  return B.contexte({ dossier, lead: leads[0] ? json(leads[0].dossier, {}) : null, bien, photos, conf, reglages: R, etat });
};

const TEXTE = (d) => d.texte || d.dernier_message || d.question || d.reponse || d.mot_cle || "";

const evenement = async (corps, R) => {
  const t = await S.tables(), tb = await tableBot(t);
  const { tel, dossier } = await trouver(t, corps, R);
  const lot = (Array.isArray(corps.evenements) ? corps.evenements : []).filter((e) => e && typeof e.type === "string").slice(0, 50);
  const evid = court(corps.event_id, 100), tel9 = B.tel9(tel), did = (dossier && dossier.id) || null;
  /* le même tour reçu deux fois (reprise du bot) : rien n'est refait */
  if (evid && lot.length && (await tb.getRow({ cle: `${evid}:0:${lot[0].type}` }))) return { ok: true, deja: true };
  const noter = (type, donnees, extra = {}) => tb.insertRow({ dossier: did, tel9, type: court(type, 60), quand: new Date(), donnees: court(JSON.stringify(donnees || {}), 20000), ...extra });
  for (const [i, e] of lot.entries()) {
    const d = e.donnees && typeof e.donnees === "object" ? e.donnees : {}, q = new Date(e.quand);
    await noter(e.type, d, { noeud: court(e.noeud, 60), quand: isNaN(q) ? new Date() : q, texte: court(TEXTE(d), 4000), cle: evid ? `${evid}:${i}:${court(e.type, 60)}` : null });
  }
  const p = B.plan(lot, R), out = { ok: true, recus: lot.length };
  if (!p.crm.length && !p.avis.length) return out;
  /* numéro sans dossier : pas de contact à écrire, mais le siège est prévenu d'une demande */
  const dos = dossier || { id: null, nom: "Numéro sans dossier" };
  const { conf, crm, reglages: RA } = await charger();

  if (p.crm.length) {
    const ecrire = R.ecritures_crm === true && crm.mode === "reel" && dos.contact_crm;
    const faits = [];
    if (ecrire) {
      const c = flowApi().crmDepuisCoffre(crm.type, crm.reglages, crm.prefixe, "reel");
      for (const a of p.crm) {
        try {
          if (a.op === "couleurContact") await c.couleurContact(dos.contact_crm, a.couleur);
          else await c.ajouterAction(dos.contact_crm, { action_id: a.action_id, texte: a.texte, negociateur: dos.negociateur });
          faits.push({ op: a.op, fait: true });
        } catch (e) { faits.push({ op: a.op, fait: false, erreur: court(e.message, 300) }); }
      }
    }
    await noter("crm", { ecrit: !!ecrire, contact: dos.contact_crm || null, prevu: p.crm, resultats: faits });
    out.crm = ecrire ? faits : "non écrit";
  }

  if (p.avis.length) {
    const bien = await lireBien(crm, dos, R);
    const reels = B.quiRecoit(dos.negociateur || (bien && bien.negociateur_id), conf, bien).liste.map((x) => x.email);
    const essai = dos.essai || R.notifications !== "reel";
    const fil = (await tb.getRows({ tel9, type: { in: ["inbound", "message_bot"] } }, { orderBy: "id", orderDesc: true, limit: 40 })).reverse()
      .map((r) => ({ role: r.type === "inbound" ? "prospect" : "bot", texte: r.texte || json(r.donnees, {}).clic || "" })).filter((m) => m.texte);
    const messages = [];
    for (const [i, avis] of p.avis.entries()) {
      const tous = [...new Set([...reels, ...avis.referents.flatMap((k) => adresses((R.referents || {})[k]))])];
      /* essai : aux adresses d'essai ; avec « essai_routage », aux vrais destinataires calculés qui sont aussi des adresses
         d'essai (le routage est testé pour de vrai, personne d'autre ne reçoit : ni siège, ni copie du client) */
      const a = essai ? (R.essai_routage === true ? tous.filter((x) => adresses(R.adresses_essai).includes(String(x).toLowerCase())) : adresses(R.adresses_essai)) : tous;
      const { objet, html } = B.mailEquipe({ avis, dossier: dos, bien, telephone: tel, fil, aurait_recu: essai ? tous : null });
      /* ponytail: un message par événement, sans plafond ; à regrouper si un prospect écrit beaucoup après sa demande */
      for (const adr of a) messages.push({ cle: `${S.prefixe()}bot-${did || tel9}:${evid || Date.now()}:${i}:${adr}`, a: adr, sujet: objet, html, reference: did ? `dossier ${did}` : "essai" });
    }
    const simuler = R.notifications === "simuler" || !R.notifications || (!essai && !RA.envoi_mails);
    out.avis = (await require("../../envois").envoyer(messages, { simuler })).resume;
  }
  return out;
};

/* Meta : le fichier est déposé, puis envoyé comme document. Jamais rejoué (un envoi ambigu ferait un doublon). */
const envoyerDocument = async ({ phone_number_id, jeton, a, buf, nom }) => {
  const base = `https://graph.facebook.com/v21.0/${encodeURIComponent(phone_number_id)}`, h = { Authorization: `Bearer ${jeton}` };
  const appel = async (chemin, options) => {
    const r = await fetch(base + chemin, { ...options, signal: AbortSignal.timeout(4000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || `HTTP ${r.status}`);
    return j;
  };
  const fd = new FormData();
  fd.append("messaging_product", "whatsapp"); fd.append("type", "application/pdf"); fd.append("file", new Blob([buf], { type: "application/pdf" }), nom);
  const media = await appel("/media", { method: "POST", headers: h, body: fd });
  const j = await appel("/messages", { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: a, type: "document", document: { id: media.id, filename: nom } }) });
  return j.messages && j.messages[0] && j.messages[0].id;
};

const fiche = async (corps, R) => {
  const t = await S.tables(), tb = await tableBot(t);
  const { tel, dossier } = await trouver(t, corps, R);
  const echec = (raison) => ({ echec: true, raison });
  if (!dossier) return echec("dossier inconnu");
  return require("../../verrou").sous(`bot-fiche:${B.tel9(tel)}:${dossier.id || 0}`, async () => {
    const etat = await etatDe(tb, tel, dossier);
    if (etat.optout) return echec("désinscrit");
    if (etat.fiche) return { deja_envoyee: true };
    const W = R.whatsapp || {};
    const jeton = W.variable_jeton ? await require("../../../garde").lireSecret(W.variable_jeton) : null;
    if (!W.phone_number_id || !jeton) return echec("WhatsApp non réglé");
    const blocs = B.blocsFiche(await lireBien((await charger()).crm, dossier, R));
    if (!blocs) return echec("bien illisible dans le CRM");
    const buf = await require("../../pdf").ecrirePdf(blocs, { titre: "Fiche annonce", pied: false, producteur: "", couleur: "#374151" });
    let identifiant;
    try { identifiant = await envoyerDocument({ phone_number_id: W.phone_number_id, jeton, a: tel, buf, nom: "fiche-annonce.pdf" }); }
    catch (e) { await tb.insertRow({ dossier: dossier.id || null, tel9: B.tel9(tel), type: "fiche_echec", quand: new Date(), texte: court(e.message, 500) }); return echec("envoi WhatsApp refusé"); }
    const horaire = new Date();
    await tb.insertRow({ dossier: dossier.id || null, tel9: B.tel9(tel), type: "fiche_envoyee", quand: horaire, donnees: JSON.stringify({ identifiant }) });
    return { envoyee: true, identifiant, horaire: horaire.toISOString() };
  });
};

const ACTIONS = { contexte, evenement, fiche };
/* action : « contexte », « evenement », « fiche », ou le nom du point d'API qui finit par l'un des trois */
const repondre = async (action, corps) => {
  const k = Object.keys(ACTIONS).find((x) => String(action || "").toLowerCase().endsWith(x));
  if (!k) throw perm(`action inconnue : ${action}`);
  const R = json((await require("./conf").reglages()).bot, {});
  return ACTIONS[k](corps && typeof corps === "object" ? corps : {}, R && typeof R === "object" ? R : {});
};

module.exports = { repondre, contexte, evenement, fiche };
