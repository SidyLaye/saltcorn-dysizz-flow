/* Contrôle CRM ↔ mails : relit dans le CRM (lecture seule) les contacts écrits pour des leads déjà traités
   et les compare avec ce que dit vraiment le mail et avec ce que le moteur écrirait. Rapport sans donnée
   personnelle dans Fichiers (lisible par l'administrateur seulement). */
"use strict";
const CAT = "Leads immobiliers";
const lu = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v); } catch (e) { return d; } };

const DEFAUT = {
  mails: { table: "email_brut_selection_habitat", expediteur: "expediteur", destinataire: "destinataire", objet: "objet", texte: "corps_texte", html: "corps_html", date: "date_envoi" },
  leads: { table: "lead", mail: "email_brut", contact: "customer_id", bien: "product_id", agence: "agency_id", negociateur: "user_id", source: "source", statut: "statut", envoyes: "publie,mis_a_jour,crm_partiel" },
  biens: { table: "bien", id: "product_id", reference: "model", prix: "prix", surface: "surface", pieces: "nb_pieces", type: "type_bien", ville: "ville", code_postal: "code_postal", negociateur: "user_id", agence: "agency_id" },
  agences: { table: "agence", id: "agency_id", nom: "nom", boites: ["boite", "emails"] },
  origines: { table: "origine", code: "code", id: "origin_id" },
};

module.exports = [{
  name: "dzf_leads_controle_crm", label: "Leads : contrôle du CRM (fiches ↔ mails)", category: CAT, icon: "fas fa-clipboard-check", output: "controle", timeout: 3600,
  description: "Pour des leads déjà écrits dans le CRM, relit chaque fiche (lecture seule) et la compare avec le mail d'origine et avec ce que le moteur écrirait : la recherche du contact et du bien (dans le vrai CRM, en lecture seule), e-mail, téléphone, prénom et nom, origine, groupe « Demandeur », négociateur et agence du bien, bien suivi, consentement (présence, motif, date, preuve), et chaque valeur que le moteur écrirait (format, et même valeur que la fiche). Rien n'est écrit. Rapport sans donnée personnelle dans Fichiers.",
  params: [
    { name: "source", label: "Leads contrôlés", type: "select", options: ["ancien système", "solution Leads"], default: "ancien système",
      help: "ancien système : table lead (réglable ci-dessous) ; solution Leads : ld_leads écrits en mode réel" },
    { name: "correspondances", label: "Tables et champs de l'ancien système (JSON)", type: "json", help: "Vide = tables AMBS. Ex. {\"leads\":{\"contact\":\"customer_id\"}}" },
    { name: "domaines_agence", label: "Domaines de l'agence", help: "Les mêmes que dans les réglages Leads" },
    { name: "limite", label: "Nombre de leads (les plus récents, répartis entre les portails)", type: "int", default: 200 },
    { name: "moteur_crm", label: "Le moteur cherche contacts et biens dans le vrai CRM (lecture seule)", type: "bool", default: true, help: "Décoché : il cherche les biens dans le catalogue de l'ancien système, sans appel au CRM" },
    { name: "fichier", label: "Nom du rapport", default: "controle-crm.json" },
  ],
  run: async (p, ctx = {}) => {
    const Table = require("@saltcorn/data/models/table");
    const api = require("../api");
    const { controler } = require("../lib/leads/controle");
    const K = lu(p.correspondances, {}) || {};
    const c = Object.fromEntries(Object.entries(DEFAUT).map(([k, v]) => [k, { ...v, ...(K[k] || {}) }]));
    const T = (n) => { const t = Table.findOne({ name: n }); if (!t) throw Object.assign(new Error(`table « ${n} » introuvable`), { permanent: true }); return t; };
    const tous = async (n) => { const t = Table.findOne({ name: n }); if (!t) return []; const out = []; for (let depuis = 0; ; ) { const l = await t.getRows({ id: { gt: depuis } }, { orderBy: "id", limit: 1000 }); if (!l.length) break; out.push(...l); depuis = l[l.length - 1].id; } return out; };
    const limite = Math.max(1, +p.limite || 200);

    /* réglages Leads (s'ils existent) : CRM, origines, consentement */
    let cd = null; try { cd = await require("../lib/leads/tables/conf").charger(); } catch (e) { cd = null; }
    const R0 = (cd && cd.reglages) || {};
    const crmR = lu(R0.crm_reglages, {}) || {};
    if (!crmR.base || !crmR.site_id) {
      const ci = (await tous("config_immofacile"))[0];
      if (ci) { crmR.base = crmR.base || ci.base; crmR.site_id = crmR.site_id || ci.site_id; }
    }
    if (!crmR.base || !crmR.site_id) throw Object.assign(new Error("CRM non réglé : lance d'abord l'installation des réglages Leads (base et site_id)"), { permanent: true });
    const crm = api.crmDepuisCoffre("immofacile", crmR, R0.prefixe_secrets || "LEADS_CRM", "ombre");

    /* leads à contrôler, avec leur mail */
    let choisis = [];
    if (p.source === "solution Leads") {
      const L = (await tous(require("../lib/leads/tables/schema").nom("leads"))).filter((l) => l.contact_crm && !/^ombre/.test(String(l.contact_crm)) && l.mode === "reel");
      choisis = L.map((l) => ({ mail_id: l.mail_id, contact_id: l.contact_crm, bien: l.bien_crm, source: l.portail, date: l.recu_le }));
    } else {
      const envoyes = new Set(String(c.leads.envoyes || "").split(/[\s,;]+/).filter(Boolean));
      const L = (await tous(c.leads.table)).filter((l) => l[c.leads.contact] && l[c.leads.mail] && (!envoyes.size || envoyes.has(String(l[c.leads.statut]))));
      choisis = L.map((l) => ({ mail_id: l[c.leads.mail], contact_id: l[c.leads.contact], bien: l[c.leads.bien], negociateur: l[c.leads.negociateur], agence: l[c.leads.agence], source: l[c.leads.source], id: l.id }));
    }
    /* les plus récents d'abord, répartis entre les sources (un tour par source) */
    choisis.sort((a, b) => (+b.id || +b.mail_id || 0) - (+a.id || +a.mail_id || 0));
    const files = new Map(); for (const x of choisis) { const k = String(x.source || "?").toLowerCase(); if (!files.has(k)) files.set(k, []); files.get(k).push(x); }
    const echantillon = [];
    for (let i = 0; echantillon.length < limite && [...files.values()].some((f) => f.length > i); i++) for (const f of files.values()) if (f[i] && echantillon.length < limite) echantillon.push(f[i]);

    const tM = p.source === "solution Leads" ? Table.findOne({ name: require("../lib/leads/tables/schema").nom("mails") }) : T(c.mails.table);
    const m = p.source === "solution Leads" ? { expediteur: "expediteur", destinataire: "destinataire", objet: "objet", texte: "corps_texte", html: "corps_html", date: "date_envoi" } : c.mails;
    const lignes = [];
    for (const x of echantillon) {
      const r = await tM.getRow({ id: +x.mail_id }); if (!r) continue;
      lignes.push({ ...x, mail: { id: r.id, expediteur: r[m.expediteur], destinataire: r[m.destinataire], objet: r[m.objet], texte: r[m.texte], html: r[m.html], date: r[m.date] } });
    }
    /* catalogue, agences, origines */
    const biens = (await tous(c.biens.table)).map((r) => ({ id: r[c.biens.id], reference: r[c.biens.reference], prix: r[c.biens.prix], surface: r[c.biens.surface], pieces: r[c.biens.pieces], type: r[c.biens.type],
      ville: r[c.biens.ville], code_postal: r[c.biens.code_postal], negociateur_id: r[c.biens.negociateur], agence_id: r[c.biens.agence] }));
    const agences = (await tous(c.agences.table)).map((r) => ({ id: String(r[c.agences.id] ?? r.id), nom: r[c.agences.nom], boites: [].concat(c.agences.boites).flatMap((f) => String(r[f] || "").toLowerCase().match(/[\w.+-]+@[\w.-]+/g) || []) }));
    const conf = { ...((cd && cd.conf) || {}), agences: agences.length ? agences : ((cd && cd.conf.agences) || []) };
    if (p.domaines_agence) conf.domaines_agence = String(p.domaines_agence).split(/[\s,;]+/).filter(Boolean);
    if (!conf.origines || !conf.origines.length) conf.origines = (await tous(c.origines.table)).map((o) => ({ id: o[c.origines.id], code: o[c.origines.code] }));
    conf.consentement = { actif: true, libelle: (conf.consentement && conf.consentement.libelle) || R0.consentement_libelle || "Demande de contact via {portail} le {date}" };
    /* groupe « Demandeur » : celui des réglages, sinon celui du CRM */
    let groupe = crmR.groupe_demandeur ?? null;
    if (groupe == null && crm.groupes) { try { const g = (await crm.groupes()) || []; const d = g.find((x) => /^demandeurs?$/i.test(String(x.label || x.name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim())); groupe = d ? d.id : null; } catch (e) { groupe = null; } }

    const R = await controler({ lignes, crm, crmMoteur: p.moteur_crm === false ? null : crm, biens, conf, groupeDemandeur: groupe, origines: conf.origines });
    R.le = new Date().toISOString(); R.source = p.source || "ancien système"; R.echantillon = lignes.length; R.leads_disponibles = choisis.length; R.groupe_demandeur_connu = groupe != null;
    const File = require("@saltcorn/data/models/file");
    const nom = String(p.fichier || "controle-crm.json").replace(/[^\w.-]/g, "_");
    await File.from_contents(nom, "application/json", JSON.stringify(R, null, 1), ctx.user && ctx.user.id, 1);
    const acc = Object.values(R.controles).reduce((s, C) => { for (const [k, v] of Object.entries(C)) if (k === "accord") s.a += v; else if (k !== "rien à contrôler") s.e += v; return s; }, { a: 0, e: 0 });
    return { fichier: nom, leads: R.echantillon, lus: R.lus_dans_le_crm, accords: acc.a, ecarts: acc.e, resume: `${R.echantillon} leads, ${R.lus_dans_le_crm} fiches relues, ${acc.a} accords, ${acc.e} écarts, ${R.erreurs_crm} erreurs de lecture — Fichiers → ${nom}` };
  },
}];
