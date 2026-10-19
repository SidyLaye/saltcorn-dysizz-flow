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
       "fraicheur_bien_s": 120, "essai_routage": false,
       "recherches": false,            // à une sortie qualifiée : recherche du prospect liée au bien, lien avec l'autre bien visité
       "alerte_whatsapp": false,       // modèle sh_alerte_nego au négociateur et à son assistante (visite, bien à vendre)
       "relances": { "actif": false, "essai_seulement": true, "delais_jours": [2, 5, 10] },
       "journal": { "url": "…/webhook/wa-bot-events", "variable_jeton": "…" } }   // relances visibles dans leads-management
     actions.VENDEUR : type d'action du CRM pour un bien à vendre déclaré.
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

/* numéro expéditeur (16/10, Sidy : jamais de réponse depuis un autre numéro que celui où le lead écrit) : le numéro de la conversation
   s'il est un des numéros du bot (whatsapp.phone_number_id ou whatsapp.numeros), sinon le numéro principal */
const numeroEnvoi = (W = {}, demande) => {
  const d = String(demande || "").replace(/\D/g, "");
  return d && [String(W.phone_number_id || ""), ...(Array.isArray(W.numeros) ? W.numeros : []).map(String)].includes(d) ? d : W.phone_number_id;
};

const tableBot = async (t) => t.bot || (await require("../../structure").assurer(S.definitions().find((d) => d.k === "bot"))).t;

const trouver = async (t, corps, R) => {
  const tel = String((corps && corps.telephone) || "").replace(/\D/g, "");
  if (tel.length < 8 || tel.length > 15) throw perm("téléphone invalide");
  const essai = (R.numeros_essai || {})[tel];
  if (essai) return { tel, dossier: { id: null, essai: true, bien_crm: essai.bien || null, bien_ref: essai.reference || null, negociateur: essai.negociateur || null, prenom: essai.prenom || "",
    nom: essai.nom || essai.prenom || "Essai", email: essai.email || null, portail: "essai", contact_crm: essai.contact_crm || null,
    /* lead d'essai : son projet (mêmes clés que les recherches du CRM) et son message au portail, facultatifs */
    projet: essai.projet && typeof essai.projet === "object" ? essai.projet : null, message: essai.message || "" } };
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

/* Cartes du carrousel du bien (demande de Sidy du 16/10) : un texte par photo, rédigé par l'IA de Botpress — le bot s'en charge après
   avoir répondu au lead, jamais pendant qu'il attend — puis contrôlé et gardé ici avec le bien (ld_biens.cartes, lib/leads/cartes.js).
   Le contexte confie le travail au bot quand les textes manquent ou ne suivent plus l'annonce (empreinte) ; un seul bot à la fois par
   bien (5 min) ; plafond du jour : bot.cartes_plafond_jour (60 par défaut) ; bot.cartes_bot = false coupe tout. */
const CONFIEES = globalThis[Symbol.for("dysizz-flow.leads.bot.cartes")] || (globalThis[Symbol.for("dysizz-flow.leads.bot.cartes")] = { biens: new Map(), jour: "", n: 0 });
const travailCartes = (bien, R = {}) => {
  if (!bien || bien.id == null || R.cartes_bot === false) return null;
  const Cx = require("../cartes"), k = String(bien.id), t = CONFIEES.biens.get(k), jour = new Date().toISOString().slice(0, 10);
  if (bien.cartes && bien.cartes.empreinte === Cx.empreinte(bien)) return null;
  if (t && Date.now() - t < 5 * 60e3) return null;
  if (CONFIEES.jour !== jour) { CONFIEES.jour = jour; CONFIEES.n = 0; }
  if (CONFIEES.n >= (+R.cartes_plafond_jour || 60)) return null;   // ponytail: compteur en mémoire, par processus
  const job = Cx.travail(bien);
  if (job) { CONFIEES.biens.set(k, Date.now()); CONFIEES.n++; }
  return job;
};
/* les textes rédigés par le bot : contrôlés, gardés avec le bien si l'annonce n'a pas changé entre-temps, rendus au bot tout de suite */
const recevoirCartes = async (d, R) => {
  if (!d || d.bien_id == null) return null;
  const Cx = require("../cartes"), { crm } = await charger();
  const bien = await lireBien(crm, { bien_crm: String(d.bien_id) }, R);
  if (!bien || Cx.empreinte(bien) !== d.empreinte) return null;
  const c = Cx.recevoirCartes(bien, d.sortie);
  CONFIEES.biens.delete(String(d.bien_id));
  if (!c) return null;
  const t = await S.tables(), r = (await t.biens.getRows({ crm_id: String(bien.id) }, { orderBy: "id", limit: 1 }))[0];
  if (r) await t.biens.updateRow({ cartes: JSON.stringify(c) }, r.id);
  return B.cartesPourBot({ cartes: c }).cartes || null;
};

/* Le contact du lead dans le CRM (prénom, projets de ses recherches), pour revalider sans redemander. Une lecture au plus
   toutes les 2 min par contact ; au-delà de 2,5 s ou en cas d'erreur, le bot continue avec ce que la phase 1 a lu. */
const CONTACTS = globalThis[Symbol.for("dysizz-flow.leads.bot.contacts")] || (globalThis[Symbol.for("dysizz-flow.leads.bot.contacts")] = new Map());
const lireContact = async (crm, id) => {
  if (!id || !/^\d+$/.test(String(id))) return null;
  const k = `${S.prefixe()}:${id}`, m = CONTACTS.get(k);
  if (m && Date.now() - m.t < 120000) return m.p;
  const c = flowApi().crmDepuisCoffre(crm.type, crm.reglages, crm.prefixe, "ombre");
  if (!c.contact) return null;
  const p = c.contact(id).then((x) => (x ? { prenom: x.prenom || null, projets: x.projets || [] } : null), () => null);
  CONTACTS.set(k, { t: Date.now(), p });
  if (CONTACTS.size > 5000) CONTACTS.delete(CONTACTS.keys().next().value);
  let minuteur; const r = await Promise.race([p, new Promise((ok) => { minuteur = setTimeout(() => ok(null), 2500); })]); clearTimeout(minuteur);
  return r;
};

const etatDe = async (tb, tel, dossier) => {
  const rows = await tb.getRows({ tel9: B.tel9(tel), type: { in: ["optout", "fiche_envoyee", "ouverture", "sortie"] } }, { orderBy: "id", orderDesc: true, limit: 200 });
  const id = (dossier && dossier.id) || null, miens = rows.filter((r) => (r.dossier || null) === id);
  const sortie = miens.find((r) => r.type === "sortie");
  /* slide 21 : une relance envoyée (pas sautée, pas la clôture) est le dernier échange → « relance » : le bot reprend à l'action proposée.
     Lu à part : les messages du prospect ne doivent pas faire sortir un STOP ou une fiche envoyée de la fenêtre ci-dessus */
  const dernier = (await tb.getRows({ tel9: B.tel9(tel), type: { in: ["inbound", "relance"] } }, { orderBy: "id", orderDesc: true, limit: 10 }))
    .find((r) => r.type === "inbound" || (!json(r.donnees, {}).saute && json(r.donnees, {}).code !== "cloture"));
  const statut = dernier && dernier.type === "relance" ? "relance" : sortie ? json(sortie.donnees, {}).statut || "" : "";
  return { optout: rows.some((r) => r.type === "optout"), fiche: miens.some((r) => r.type === "fiche_envoyee"), ouverture: miens.some((r) => r.type === "ouverture"), statut };
};

const contexte = async (corps, R, { travail = true } = {}) => {   // travail : confier la rédaction des cartes au bot (pas pour les relances)
  const t = await S.tables(), tb = await tableBot(t);
  let { tel, dossier } = await trouver(t, corps, R);
  /* essais (Sidy, 19/10) : « /reset » depuis un numéro d'essai efface ses traces (STOP, fiche envoyée, sorties, relances, messages) pour
     rejouer un parcours ; les écritures CRM restent (recherche et action vendeur pas refaites). Un vrai numéro n'est jamais effacé. */
  let reinitialise;
  if (corps.reinitialiser) {
    reinitialise = !!(R.numeros_essai || {})[tel];
    if (reinitialise) {
      const types = [...new Set((await tb.getRows({ tel9: B.tel9(tel) })).map((r) => r.type))].filter((x) => x !== "crm");
      if (types.length) await tb.deleteRows({ tel9: B.tel9(tel), type: { in: types } });
    }
  }
  /* nouvelle annonce pour le même numéro (Sidy, 17/10) : le message d'accueil le plus récent porte sur un autre dossier, et rien n'a été
     échangé sur celui de la conversation depuis → on suit le nouveau dossier, même quand le prospect répond par écrit */
  if (dossier && dossier.id && corps.dossier_id) {
    const n0 = (await tb.getRows({ tel9: B.tel9(tel), type: "ouverture" }, { orderBy: "id", orderDesc: true, limit: 20 })).find((r) => r.noeud === "N0");
    if (n0 && n0.dossier && n0.dossier !== dossier.id) {
      const [moi] = await tb.getRows({ tel9: B.tel9(tel), dossier: dossier.id }, { orderBy: "id", orderDesc: true, limit: 1 });
      if (!moi || n0.id > moi.id) dossier = (await trouver(t, { ...corps, dossier_id: n0.dossier }, R)).dossier || dossier;
    }
  }
  const etat = await etatDe(tb, tel, dossier);
  const raz = reinitialise === undefined ? {} : { reinitialise };
  if (!dossier) return { ...B.contexte({ dossier: null, etat }), ...raz };
  const { conf, crm } = await charger();
  const [bien, leads, contact] = await Promise.all([lireBien(crm, dossier, R), dossier.id ? t.leads.getRows({ dossier_id: dossier.id }, { orderBy: "id", orderDesc: true, limit: 1 }) : [],
    dossier.essai ? (dossier.projet ? { prenom: null, projets: [dossier.projet] } : null) : lireContact(crm, dossier.contact_crm)]);
  const photos = R.photos && bien && Array.isArray(bien.photos) ? bien.photos : [];
  const lead = leads[0] ? json(leads[0].dossier, {}) : dossier.essai && dossier.message ? { extraction: { message: dossier.message, nature: "lead" } } : null;
  const job = travail ? travailCartes(bien, R) : null;
  return { ...B.contexte({ dossier, lead, bien, photos, contact, conf, reglages: R, etat }), ...(job ? { cartes_a_rediger: job } : {}), ...raz };
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
    const d0 = e.donnees && typeof e.donnees === "object" ? e.donnees : {}, q = new Date(e.quand);
    const d = corps.numero_bot && (e.type === "inbound" || e.type === "ouverture") ? { ...d0, numero_bot: court(String(corps.numero_bot).replace(/\D/g, ""), 20) } : d0;
    await noter(e.type, d, { noeud: court(e.noeud, 60), quand: isNaN(q) ? new Date() : q, texte: court(TEXTE(d), 4000), cle: evid ? `${evid}:${i}:${court(e.type, 60)}` : null });
  }
  /* vendeur déjà déclaré dans cette conversation (depuis la dernière ouverture) : il reste en rouge */
  const derniereOuverture = ((await tb.getRows({ tel9, type: "ouverture" }, { orderBy: "id", orderDesc: true, limit: 1 }))[0] || { id: 0 }).id;
  const vendeur = (await tb.getRows({ tel9, type: "prioritaire_vendeur" }, { orderBy: "id", orderDesc: true, limit: 1 })).some((r) => r.id >= derniereOuverture);
  const p = B.plan(lot, R, { vendeur }), out = { ok: true, recus: lot.length };
  const redigees = lot.find((e) => e.type === "cartes_redigees");
  if (redigees) { const c = await recevoirCartes(redigees.donnees, R).catch(() => null); if (c) out.cartes = c; }
  /* un désinscrit qui écrit plusieurs messages : une seule alerte par 24 h (la ligne de ce tour est déjà rangée) */
  if (p.avis.some((a) => a.type === "message_apres_stop")) {
    const l = await tb.getRows({ tel9, type: "message_apres_stop" }, { orderBy: "id", orderDesc: true, limit: lot.length + 1 });
    const avant = l.slice(lot.filter((e) => e.type === "message_apres_stop").length)[0];
    if (avant && Date.now() - new Date(avant.quand) < 24 * 3600e3) p.avis = p.avis.filter((a) => a.type !== "message_apres_stop");
  }
  if (!p.crm.length && !p.avis.length) return out;
  /* numéro sans dossier : pas de contact à écrire, mais le siège est prévenu d'une demande */
  const dos = dossier || { id: null, nom: "Numéro sans dossier" };
  const { conf, crm, reglages: RA } = await charger();

  if (p.crm.length) {
    /* ecritures_crm : true = tous les leads ; liste de numéros = ces numéros seulement (essais sur un vrai contact) */
    const ecrire = (R.ecritures_crm === true || (Array.isArray(R.ecritures_crm) && R.ecritures_crm.map(String).includes(tel))) && crm.mode === "reel" && dos.contact_crm;
    const faits = [];
    if (ecrire) {
      const c = flowApi().crmDepuisCoffre(crm.type, crm.reglages, crm.prefixe, "reel");
      /* couleur déjà posée par un tour précédent (le lead s'arrête et reprend quand il veut) : pas de réécriture ;
         écriture « une_fois » (vendeur, lien, recherche) déjà réussie pour ce contact : jamais refaite */
      const precedents = (await tb.getRows({ tel9, type: "crm" }, { orderBy: "id", orderDesc: true, limit: 1000 })).map((r) => json(r.donnees, {}))   // 50 ne suffisait pas : essais répétés (17/10), recherche refaite
        .filter((d) => String(d.contact || "") === String(dos.contact_crm)).flatMap((d) => (d.resultats || []).filter((x) => x.fait));
      const avant = (precedents.find((x) => x.op === "couleurContact") || {}).couleur, uneFois = new Set(precedents.map((x) => x.une_fois).filter(Boolean));
      for (const a of p.crm) {
        const trace = { op: a.op, ...(a.couleur ? { couleur: a.couleur } : {}), ...(a.une_fois ? { une_fois: a.une_fois } : {}) };
        if ((a.op === "couleurContact" && String(a.couleur) === String(avant)) || (a.une_fois && uneFois.has(a.une_fois))) { faits.push({ ...trace, fait: true, deja: true }); continue; }
        try {
          if (a.op === "couleurContact") await c.couleurContact(dos.contact_crm, a.couleur);
          else if (a.op === "lierBien") await c.lierBien(dos.contact_crm, a.bien_id);
          else if (a.op === "creerRecherche") {
            /* une recherche par dossier : celle de la phase 1 si elle existe (la qualification est dans l'action), sinon celle du bot */
            if (dos.recherche_crm) { faits.push({ ...trace, fait: true, deja: true, recherche: dos.recherche_crm }); continue; }
            const b = (await lireBien(crm, dos, R)) || {};
            const r = await c.creerRecherche(dos.contact_crm, { transaction: "vente", type: b.type || null, localisation: a.criteres.localisation || b.ville || null,
              budget_max: a.criteres.budget_max || null, libelle: `WhatsApp${b.reference ? " — réf. " + b.reference : ""}` });
            if (r && r.id && dos.id) { await t.dossiers.updateRow({ recherche_crm: String(r.id) }, dos.id); dos.recherche_crm = String(r.id); }
            trace.recherche = (r && r.id) || null;
          } else await c.ajouterAction(dos.contact_crm, { action_id: a.action_id, texte: a.texte, negociateur: dos.negociateur });
          faits.push({ ...trace, fait: true });
        } catch (e) { faits.push({ ...trace, fait: false, erreur: court(e.message, 300) }); }
      }
    }
    await noter("crm", { ecrit: !!ecrire, contact: dos.contact_crm || null, prevu: p.crm, resultats: faits });
    out.crm = ecrire ? faits : "non écrit";
  }

  if (p.avis.length) {
    const bien = await lireBien(crm, dos, R);
    const qui = B.quiRecoit(dos.negociateur || (bien && bien.negociateur_id), conf, bien).liste;
    let reels = qui.map((x) => x.email);
    /* visite demandée sur un autre bien que celui de l'annonce : le négociateur du bien initial ET celui du nouveau bien
       sont prévenus (réunion du 21/07 : un prospect, plusieurs biens, plusieurs négociateurs) */
    const autreId = (lot.find((e) => (e.type === "sortie" || e.type === "visite_modifiee") && e.donnees && e.donnees.autre_bien_id) || { donnees: {} }).donnees.autre_bien_id;
    const surAutre = (avis) => autre && (avis.qualifie || avis.type === "visite_modifiee");   // le créneau changé concerne le bien visité
    const autre = autreId ? await lireBien(crm, { bien_crm: String(autreId) }, R) : null;
    const quiAutre = autre ? B.quiRecoit(autre.negociateur_id, conf, autre).liste : [];
    if (autre) reels = [...new Set([...reels, ...quiAutre.map((x) => x.email)])];
    const essai = dos.essai || R.notifications !== "reel";
    /* l'échange de CETTE conversation : depuis le dernier message d'ouverture (une conversation plus ancienne du même numéro n'y entre pas) */
    const ouv = await tb.getRows({ tel9, type: "ouverture" }, { orderBy: "id", orderDesc: true, limit: 5 });
    /* deux lignes par conversation : l'envoi du modèle (N0), puis le premier message du prospect ; il peut aussi écrire le premier */
    const [o1, o2] = ouv, envoi = o1 && o1.noeud !== "N0" && o2 && o2.noeud === "N0" && new Date(o1.quand) - new Date(o2.quand) < 48 * 3600e3;
    const debut = ((envoi ? o2 : o1) || { id: 0 }).id;
    const fil = (await tb.getRows({ tel9, type: { in: ["inbound", "message_bot"] } }, { orderBy: "id", orderDesc: true, limit: 40 })).reverse()
      .filter((r) => r.id >= debut).map((r) => ({ role: r.type === "inbound" ? "prospect" : "bot", texte: r.texte || json(r.donnees, {}).clic || "" })).filter((m) => m.texte);
    const messages = [];
    for (const [i, avis] of p.avis.entries()) {
      const tous = [...new Set([...reels, ...avis.referents.flatMap((k) => adresses((R.referents || {})[k]))])];
      /* essai : aux adresses d'essai ; avec « essai_routage », aux vrais destinataires calculés qui sont aussi des adresses
         d'essai (le routage est testé pour de vrai, personne d'autre ne reçoit : ni siège, ni copie du client) */
      const a = essai ? (R.essai_routage === true ? tous.filter((x) => adresses(R.adresses_essai).includes(String(x).toLowerCase())) : adresses(R.adresses_essai)) : tous;
      const { objet, html } = B.mailEquipe({ avis, dossier: dos, bien: surAutre(avis) ? autre : bien, bien_initial: surAutre(avis) ? bien : null, telephone: tel, fil, aurait_recu: essai ? tous : null });
      /* ponytail: un message par événement, sans plafond ; à regrouper si un prospect écrit beaucoup après sa demande */
      for (const adr of a) messages.push({ cle: `${S.prefixe()}bot-${did || tel9}:${evid || Date.now()}:${i}:${adr}`, a: adr, sujet: objet, html, reference: did ? `dossier ${did}` : "essai" });
    }
    const simuler = R.notifications === "simuler" || !R.notifications || (!essai && !RA.envoi_mails);
    out.avis = (await require("../../envois").envoyer(messages, { simuler })).resume;
    /* alerte WhatsApp au négociateur et à son assistante (numéros de l'équipe) ; en essai, seulement aux numéros d'essai */
    if (R.alerte_whatsapp === true && R.notifications !== "simuler" && R.notifications) {   // mode simuler : rien ne part
      const tels = [...new Set([...qui, ...quiAutre].filter((x) => x.roles.some((r) => r === "negociateur" || r === "assistante"))
        .map((x) => ((conf.routage && conf.routage.personnes) || []).find((p) => String(p.email || "").toLowerCase() === x.email))
        .map((p) => String((p && p.telephone) || "").replace(/\D/g, "")).filter((n) => n.length >= 9))]
        .filter((n) => !essai || Object.keys(R.numeros_essai || {}).includes(n));
      const W = R.whatsapp || {}, envoyees = [];
      for (const avis of p.avis) {
        const valeurs = B.alerteNego({ avis, dossier: dos, bien: surAutre(avis) ? autre : bien, telephone: tel });
        if (!valeurs) continue;
        if (!tels.length) { await noter("alerte_whatsapp", { envoyee: false, raison: "aucun numéro : négociateur et assistante sans téléphone dans l'équipe" + (essai ? ", ou hors des numéros d'essai" : "") }); continue; }
        try {
          const jeton = W.variable_jeton ? await require("../../../garde").lireSecret(W.variable_jeton) : null;
          if (!W.phone_number_id || !jeton) throw new Error("WhatsApp non réglé");
          for (const a of tels) {
            const { id } = await envoyerModele({ phone_number_id: numeroEnvoi(W, corps.numero_bot), jeton, a, nom: "sh_alerte_nego", langue: "fr", valeurs, suivi: `sh|${Date.now()}|alerte|${tel9}` });
            await noter("alerte_whatsapp", { a: B.tel9(a), valeurs: valeurs.slice(0, 4), identifiant: id || null });
            envoyees.push(B.tel9(a));
          }
        } catch (e) { await noter("alerte_whatsapp", { erreur: court(e.message, 300) }); }
      }
      out.alertes_whatsapp = envoyees.length;
    }
  }
  return out;
};

/* Meta : le fichier est déposé, puis envoyé comme document. Jamais rejoué (un envoi ambigu ferait un doublon). */
const envoyerDocument = async ({ phone_number_id, jeton, a, buf, nom }) => {
  const base = `https://graph.facebook.com/v21.0/${encodeURIComponent(phone_number_id)}`, h = { Authorization: `Bearer ${jeton}` };
  const appel = async (chemin, options) => {
    const r = await fetch(base + chemin, { ...options, signal: AbortSignal.timeout(chemin === "/media" ? 20000 : 6000) });   // fiche avec photos : près de 2 Mo
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

/* photos de la fiche : https, JPEG ou PNG, 3 Mo au plus chacune, 4 au plus, 6 s au plus ; une erreur = photo absente */
const telechargerPhotos = async (urls, f = globalThis.fetch, { max = 4, octets = 3e6, delai = 6000 } = {}) => {
  const out = new Map();
  await Promise.all((urls || []).filter((u) => /^https:\/\//.test(String(u))).slice(0, max).map(async (u) => {
    const c = new AbortController(), minuteur = setTimeout(() => c.abort(), delai);
    try {
      const r = await f(u, { signal: c.signal });
      if (!r.ok || !/image\/(jpe?g|png)/i.test((r.headers && r.headers.get("content-type")) || "")) return;
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length && b.length <= octets) out.set(u, b);
    } catch (e) { /* photo absente */ } finally { clearTimeout(minuteur); }
  }));
  return new Map([...urls].filter((u) => out.has(u)).map((u) => [u, out.get(u)]));   // ordre des photos gardé
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
    const bien = await lireBien((await charger()).crm, dossier, R), en = corps.langue === "en";
    if (bien && B.enVente(bien).en_vente === false) return echec("plus en vente");   // jamais la fiche d'un bien vendu ou retiré
    /* photos autorisées (dossier public du réglage « photos ») téléchargées d'abord : une photo qui échoue n'apparaît pas */
    const urls = R.photos && bien && Array.isArray(bien.photos) ? bien.photos : [];
    const ph = await telechargerPhotos(urls);
    const blocs = B.blocsFiche(bien, new Date(), en ? "en" : "fr", urls.filter((u) => ph.has(u)));
    if (!blocs) return echec("bien illisible dans le CRM");
    const buf = await require("../../pdf").ecrirePdf(blocs, { titre: en ? "Property sheet" : "Fiche annonce", pied: false, producteur: "", couleur: "#374151" }, async (u) => ph.get(u));
    let identifiant;
    try { identifiant = await envoyerDocument({ phone_number_id: numeroEnvoi(W, corps.numero_bot), jeton, a: tel, buf, nom: en ? "property-sheet.pdf" : "fiche-annonce.pdf" }); }
    catch (e) { await tb.insertRow({ dossier: dossier.id || null, tel9: B.tel9(tel), type: "fiche_echec", quand: new Date(), texte: court(e.message, 500) }); return echec("envoi WhatsApp refusé"); }
    const horaire = new Date();
    await tb.insertRow({ dossier: dossier.id || null, tel9: B.tel9(tel), type: "fiche_envoyee", quand: horaire, donnees: JSON.stringify({ identifiant }) });
    return { envoyee: true, identifiant, horaire: horaire.toISOString() };
  });
};

/* Biens qui correspondent à la recherche du prospect (« avez-vous d'autres biens… ») : lus dans le CRM (en vente, diffusés,
   avec photo), copiés dans l'application (ld_biens) pour la fiche et la visite qui suivront, rendus avec leurs seuls champs
   publics et le contenu public de l'annonce. Sans critère donné : même code postal et même type que le bien du dossier. */
const biens = async (corps, R) => {
  const t = await S.tables();
  const { dossier } = await trouver(t, corps, R);
  const { conf, crm } = await charger();
  const c = flowApi().crmDepuisCoffre(crm.type, crm.reglages, crm.prefixe, "ombre");
  if (!c.biensCorrespondants) return { biens: [], raison: "recherche indisponible pour ce CRM" };
  const initial = dossier ? await lireBien(crm, dossier, R) : null;
  const q = { ...(corps.criteres && typeof corps.criteres === "object" ? corps.criteres : {}) };
  if (!q.lieu && initial) q.lieu = initial.code_postal || initial.ville || null;
  if (!q.type && initial && !corps.criteres) q.type = initial.type || null;
  const exclure = [...new Set([...(Array.isArray(corps.exclure) ? corps.exclure : []), initial && initial.id].filter((x) => x != null).map(String))];
  let trouves = [];
  try { trouves = await c.biensCorrespondants(q, { max: Math.min(10, +corps.max || 10), dossier: String(R.photos || ""), exclure }); }
  catch (e) { return { biens: [], raison: "CRM indisponible", criteres: q }; }
  /* copies (photos et annonce) pour la fiche et la visite qui suivront : en arrière-plan, la réponse au bot n'attend pas */
  const cat = require("./catalogue");
  (async () => {
    await cat.enregistrerBiens(trouves);
    for (const b of trouves) {
      const r = (await t.biens.getRows({ crm_id: String(b.id) }, { orderBy: "id", limit: 1 }))[0];
      if (r) await t.biens.updateRow({ photos: JSON.stringify(b.photos || []), details: JSON.stringify(b.annonce || null), synchro_le: new Date() }, r.id);
    }
  })().catch(() => {});
  /* cartes déjà rédigées pour ces biens (ld_biens) ; les manquantes sont préparées en arrière-plan pour la prochaine fois */
  const gardees = new Map();
  for (const b of trouves) { const r = (await t.biens.getRows({ crm_id: String(b.id) }, { orderBy: "id", limit: 1 }))[0]; if (r && r.cartes) gardees.set(String(b.id), json(r.cartes, null)); }
  return { criteres: q, biens: trouves.map((b) => {
    const p = B.quiRecoit(b.negociateur_id, conf, b).personne;
    return { id: b.id, reference: b.reference || "", bien_public: { ...B.bienPublic(b), ...B.annonce(b.annonce), photos_publiques: (b.photos || []).slice(0, 10), ...B.cartesPourBot({ cartes: gardees.get(String(b.id)) }) },
      negociateur: p ? { nom: p.nom } : null };
  }) };
};

/* Relances (script V1.3, slide 21 ; calendrier : lib/leads/relances.js). Lancées chaque heure par le bloc dzf_leads_bot_relances.
   bot.relances = { actif, essai_seulement, delais_jours } : coupées par défaut ; en essai, seulement les numéros d'essai.
   Tant que leads-management n'est pas branché, l'application envoie elle-même le modèle Meta (même numéro expéditeur que le bot).
   R2 (« le bien est toujours disponible ») seulement si le bien est confirmé en vente par une lecture de moins de 5 minutes. */
const MODELES_RELANCE = { r1: "sh_relance_r1", r2: "sh_relance_r2", r3: "sh_relance_r3" };
const envoyerModele = async ({ phone_number_id, jeton, a, nom, langue, valeurs = [], boutons = [], suivi }) => {
  const corps = { messaging_product: "whatsapp", to: a, type: "template", biz_opaque_callback_data: suivi, template: { name: nom, language: { code: langue }, components: [
    { type: "body", parameters: valeurs.map((v) => ({ type: "text", text: String(v).replace(/\s+/g, " ").trim() })) },   // Meta : ni saut de ligne, ni tabulation, ni 4 espaces
    ...boutons.map((p, i) => ({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload: p }] }))] } };
  const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phone_number_id)}/messages`, { method: "POST",
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000), body: JSON.stringify(corps) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `HTTP ${r.status}`);
  return { id: j.messages && j.messages[0] && j.messages[0].id, corps };
};
/* Journal des conversations (ce que leads-management affiche) : la même ligne que la carte d'envoi du bot publie après chaque
   message accepté par Meta. Réglage bot.journal = { url, variable_jeton } ; absent ou en panne : false, sans bloquer l'envoi. */
const journaliser = async (J, ligne) => {
  try {
    const jeton = J && J.url && J.variable_jeton ? await require("../../../garde").lireSecret(J.variable_jeton) : null;
    if (!jeton) return false;
    const r = await fetch(J.url, { method: "POST", headers: { "x-ambs-token": jeton, "Content-Type": "application/json" }, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ event_type: "WHATSAPP_MESSAGE", ...ligne }) });
    return !!r.ok;
  } catch (e) { return false; }
};
const leBien = (b, langue) => {   // « la maison à Rodez » / « the house in Rodez »
  const t = String((b && b.type) || "").toLowerCase(), v = (b && b.ville) || "";
  if (langue === "en") return "the " + (require("../traduction").typeEn(t) || "property").toLowerCase() + (v ? ` in ${v}` : "");
  const art = !t ? "ce bien" : /^[aeiouyhéèê]/.test(t) ? "l'" + t : (/^(maison|villa|propri|ferme|grange|long|bastide|demeure)/.test(t) ? "la " : "le ") + t;
  return art + (v ? ` à ${v}` : "");
};
/* langue de la relance : celle du dernier message du bot (il suit le prospect), sinon du prospect, sinon de l'ouverture */
const langueDe = (hist) => { const e = hist.filter((x) => ["message_bot", "inbound", "ouverture"].includes(x.type) && x.donnees.langue).pop(); return e && e.donnees.langue === "en" ? "en" : "fr"; };
const relancer = async ({ maintenant = Date.now() } = {}) => {
  const R = json((await require("./conf").reglages()).bot, {}), RR = R.relances || {};
  if (!RR.actif) return { actif: false };
  const P = require("../relances");
  if (!P.dansLaPlage(new Date(maintenant))) return { envoyees: [], sautees: [], erreurs: [], hors_plage: true };
  return require("../../verrou").sous("bot-relances", async () => {
    const t = await S.tables(), tb = await tableBot(t), W = R.whatsapp || {};
    const essais = Object.keys(R.numeros_essai || {}), out = { envoyees: [], sautees: [], erreurs: [] };
    const recentes = (await tb.getRows({ type: "ouverture" }, { orderBy: "id" })).filter((e) => e.noeud === "N0" && maintenant - new Date(e.quand) < 25 * 86400000);
    for (const tel9 of [...new Set(recentes.map((e) => e.tel9))]) {
      let tel = essais.find((n) => B.tel9(n) === tel9);
      if (!tel && RR.essai_seulement === false) tel = String(((await t.dossiers.getRows({ tel9 }, { orderBy: "maj_le", orderDesc: true, limit: 1 }))[0] || {}).telephone || "").replace(/\D/g, "");
      if (!tel) continue;
      const hist = (await tb.getRows({ tel9, type: { in: ["ouverture", "message_bot", "relance", "sortie", "optout", "inbound"] } }, { orderBy: "id" }))
        .map((e) => ({ ...e, donnees: json(e.donnees, {}) }));
      const plan = P.planifier(hist, maintenant, RR);
      if (!plan || plan.quand.getTime() > maintenant) continue;
      const noter = (donnees) => tb.insertRow({ dossier: null, tel9, type: "relance", noeud: "", quand: new Date(maintenant), donnees: JSON.stringify(donnees) });
      if (plan.code === "cloture") { await noter({ code: "cloture", motif: "sans réponse après R3 (OUT-5)" }); out.envoyees.push({ tel9, code: "cloture" }); continue; }
      const ctx = await contexte({ telephone: tel }, R, { travail: false }), bp = (ctx && ctx.bien_public) || {};
      if (ctx.optout) continue;
      if (plan.code === "r2" && !(bp.en_vente === true && bp.statut_lu_le && maintenant - new Date(bp.statut_lu_le) < 300000)) {
        await noter({ code: "r2", saute: true, motif: "bien non confirmé en vente à l'instant" }); out.sautees.push({ tel9, code: "r2" }); continue;
      }
      const langue = langueDe(hist), nom = MODELES_RELANCE[plan.code] + (langue === "en" ? "_en" : "");
      const prenom = ctx.prenom || (langue === "en" ? "there" : "à vous");
      const boutons = { r1: ["R1_INFOS", "R1_VISITE"], r2: ["R2_RAPPEL"], r3: [] }[plan.code].map((b) => b + (ctx.dossier_id ? `|${ctx.dossier_id}` : ""));
      try {
        const jeton = W.variable_jeton ? await require("../../../garde").lireSecret(W.variable_jeton) : null;
        if (!W.phone_number_id || !jeton) throw new Error("WhatsApp non réglé");
        const suivi = `sh|${maintenant}|${plan.code}|relance-${tel9}`;
        const numero = numeroEnvoi(W, (hist.filter((x) => x.donnees.numero_bot).pop() || { donnees: {} }).donnees.numero_bot);   // celui de la conversation
        const { id, corps } = await envoyerModele({ phone_number_id: numero, jeton, a: tel, nom, langue, boutons, suivi,
          valeurs: plan.code === "r1" ? [prenom, leBien(bp, langue)] : [prenom] });
        await noter({ code: plan.code, modele: nom, langue, identifiant: id || null });
        const quand = new Date(maintenant).toISOString();
        const journal = await journaliser(R.journal, { tracking_id: suivi, marque: "SH", direction: "outbound", conversation_id: `relance-${tel9}`,
          phone_number_id: String(numero), telephone: tel, format: "template", contenu: JSON.stringify(corps), payload: corps,
          statut: "accepted", cree_le: quand, mis_a_jour_le: quand, wamid: String(id || ""), erreur: "" });
        out.envoyees.push({ tel9, code: plan.code, modele: nom, journal });
      } catch (e) { out.erreurs.push({ tel9, code: plan.code, erreur: court(e.message, 200) }); }
    }
    return out;
  });
};

const ACTIONS = { contexte, evenement, fiche, biens };
/* action : « contexte », « evenement », « fiche », ou le nom du point d'API qui finit par l'un des trois */
const repondre = async (action, corps) => {
  const k = Object.keys(ACTIONS).find((x) => String(action || "").toLowerCase().endsWith(x));
  if (!k) throw perm(`action inconnue : ${action}`);
  const R = json((await require("./conf").reglages()).bot, {});
  return ACTIONS[k](corps && typeof corps === "object" ? corps : {}, R && typeof R === "object" ? R : {});
};

module.exports = { repondre, contexte, evenement, fiche, telechargerPhotos, relancer };
