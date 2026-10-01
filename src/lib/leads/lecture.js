/* Lecture d'un mail en trois étages, du moins cher au plus cher :
   1. règles écrites pour les portails connus (extraire) — instantané, gratuit ;
   2. gabarits appris (apprentissage) — instantané, gratuit, appris tout seul ;
   3. IA — seulement si le mail reste incomplet ou inconnu ; sa lecture apprend un gabarit,
      pour que le mail suivant de la même forme n'ait plus besoin d'elle.

   opts = {
     ia:        client de ia.creer() (facultatif : sans IA, on s'arrête à l'étage 2),
     gabarits:  stockage { lister, creer, maj } (facultatif),
     budget:    async () => true/false (plafond d'appels du client),
     noter:     async (appel) => void (journal des appels à l'IA),
   } */
"use strict";
const { extraire } = require("./extraire");
const { texteMail } = require("./texte");
const A = require("./apprentissage");

const LEADS = ["lead", "relance", "recherche", "estimation", "direct"];
/* Natures décidées par les règles, qu'aucun étage suivant ne doit contredire. */
const DEFINITIVES = ["non_lead", "auto_reponse", "interne", "alerte_spam", "hameconnage", "notification", "b2b", "masse", "desabonnement", "test"];

const manquantsImportants = (r) => (r.manquants || []).filter((m) => ["coordonnees", "nom", "reference"].includes(m));
/* Valeurs venues d'un gabarit ou de l'IA : mêmes contrôles que la lecture par règles (numéro de l'équipe, de l'agence
   ou du portail ; adresse de l'agence ou relais ; forme de chaque champ). */
const recalculer = (r, ctx = {}) => {
  const c = r.contact || {}, b = r.bien || {};
  const X = require("./extraire"), V = require("./valeurs");
  if (ctx.texte !== undefined) {
    if (c.telephone) { const t = V.telephone(c.telephone); if (!t || !X.telephoneDuProspect(ctx.texte, ctx.conf || {})(t)) delete c.telephone; else c.telephone = t; }
    const domA = ((ctx.conf || {}).domaines_agence || []).map((x) => String(x).toLowerCase());
    if (c.email) { const e = V.email(c.email); if (!e || domA.some((x) => e.endsWith("@" + x))) delete c.email; else if (X.RELAIS.test(e)) { c.email_relais = c.email_relais || e; delete c.email; } else c.email = e; }
    for (const k of ["nom", "prenom", "nom_complet"]) if (c[k] && !A.valeurValide(k, c[k])) delete c[k];
    for (const [k, n] of [["ville", "ville"], ["code_postal", "code_postal"], ["reference", "reference"]]) if (b[k] && !A.valeurValide(n, b[k])) delete b[k];
  }
  X.nettoyerNoms(c);
  r.manquants = [];
  if (LEADS.includes(r.nature) || r.nature === "reponse_campagne") {
    if (!c.email && !c.telephone) r.manquants.push("coordonnees");
    if (!c.email && !c.email_relais) r.manquants.push("email");
    if (!c.nom && !c.prenom) r.manquants.push("nom");
    if (["lead", "relance"].includes(r.nature) && !b.reference && !b.id_crm && !b.reference_portail) r.manquants.push("reference");
  }
  if (c.nom && !c.nom_complet) c.nom_complet = [c.prenom, c.nom].filter(Boolean).join(" ");
  return r;
};

/* Faut-il aller plus loin que les règles ? */
const aCompleter = (r) => {
  if (DEFINITIVES.includes(r.nature)) return false;
  if (["inconnu", "reponse_campagne"].includes(r.nature)) return true;
  if (r.portail === "inconnu" || !r.portail) return LEADS.includes(r.nature) ? manquantsImportants(r).length > 0 : true;
  /* portail connu : ses règles sont écrites ; on n'appelle l'IA que si elles n'ont pas trouvé comment joindre le prospect
     (le portail a sans doute changé sa mise en page). Une référence absente du mail, l'IA ne l'inventera pas. */
  return LEADS.includes(r.nature) && (r.manquants || []).includes("coordonnees");
};

const NATURE_IA = { lead: "lead", reclamation: "lead", recherche: "recherche", estimation: "estimation", notification: "notification", test: "test", autre: "autre" };

const lire = async (mail, conf = {}, opts = {}) => {
  const r = extraire(mail, conf);
  r.lu_par = ["regles"];
  if (!aCompleter(r) || (!opts.ia && !opts.gabarits)) return r;
  /* un mail transféré par l'agence se lit sur le mail d'origine */
  const m = r.mail_deballe ? { ...mail, ...r.mail_deballe, html: "" } : mail;
  const texte = texteMail({ texte: m.texte ?? m.corps_texte, html: m.html ?? m.corps_html });
  r.lecture = { etapes: [] };

  /* 2. gabarit appris */
  let g = null;
  if (opts.gabarits) {
    const tous = await opts.gabarits.lister().catch(() => []);
    /* on essaie les gabarits qui reconnaissent la forme, du plus précis au moins précis ; le premier qui lit tout gagne */
    const essais = A.candidats(tous, m, texte);
    let meilleur = null;
    for (const x of essais) {
      const copie = JSON.parse(JSON.stringify(r));
      A.versExtraction(copie, A.appliquer(x, texte), "gabarit:" + x.id);
      if (["inconnu", "reponse_campagne"].includes(copie.nature) && ["lead", "recherche", "estimation"].includes(x.nature)) copie.nature = x.nature;
      recalculer(copie, { texte, conf });
      if (!meilleur) meilleur = { g: x, r: copie };
      if (!aCompleter(copie)) { meilleur = { g: x, r: copie }; break; }
    }
    if (meilleur) {
      g = meilleur.g;
      Object.assign(r, meilleur.r);
      if (r.portail === "inconnu" || !r.portail) r.portail_nom = g.source;
      r.lu_par.push("gabarit");
      r.lecture.gabarit = { id: g.id, source: g.source, essayes: essais.length, observations: +g.nb_observations || 0, echecs: +g.nb_echecs || 0, origine: g.origine || null };
      if (!aCompleter(r)) { await A.reussite(opts.gabarits, g).catch(() => {}); r.lecture.etapes.push("gabarit suffisant"); return r; }
      r.lecture.etapes.push("gabarit incomplet : " + manquantsImportants(r).join(", "));
    }
  }

  /* 3. IA */
  if (!opts.ia) return r;
  if (opts.budget && !(await opts.budget().catch(() => false))) { r.lecture.etapes.push("IA non appelée : plafond du jour atteint"); r.lecture.ia = { statut: "plafond" }; return r; }
  let lu;
  try { lu = await opts.ia.lire(m, texte); }
  catch (e) {
    r.lecture.ia = { statut: "erreur", erreur: String(e.message || e).slice(0, 200) };
    r.lecture.etapes.push("IA indisponible : le mail reste à relire");
    if (opts.noter) await opts.noter({ ok: false, erreur: r.lecture.ia.erreur }).catch(() => {});
    return r;
  }
  const s = lu.sortie;
  r.lecture.ia = { statut: "ok", nature: s.nature, confiance: s.confiance_nature, source: s.source, justification: s.justification, rejets: lu.rejets, ms: lu.ms, cache: !!lu.cache };
  if (opts.noter && !lu.cache) await opts.noter({ ok: true, ms: lu.ms, nature: s.nature, source: s.source }).catch(() => {});
  r.lu_par.push("ia");

  /* Nature : l'IA ne tranche que ce que les règles n'ont pas su classer, et seulement si elle est sûre d'elle. */
  const nia = NATURE_IA[s.nature] || "autre";
  if (["inconnu", "reponse_campagne"].includes(r.nature)) {
    if (s.confiance_nature >= 0.7) r.nature = nia;
    else r.lecture.etapes.push(`IA peu sûre (${s.confiance_nature}) : à relire`);
  } else if (r.portail === "inconnu" && !LEADS.includes(nia) && s.confiance_nature >= 0.8) r.nature = nia;
  if (s.nature === "reclamation") r.reclamation = true;
  if ((r.portail === "inconnu" || !r.portail) && s.source) r.portail_nom = r.portail_nom && r.portail_nom !== r.portail_inconnu ? r.portail_nom : s.source;

  /* Les valeurs des règles et du gabarit restent prioritaires ; l'IA comble les trous. */
  A.versExtraction(r, s, "ia");
  recalculer(r, { texte, conf });

  /* Apprentissage : la lecture de l'IA devient un gabarit pour les prochains mails de cette forme. */
  if (opts.gabarits) {
    if (g) r.lecture.gabarit.echec = await A.echec(opts.gabarits, g).catch(() => null);
    r.lecture.apprentissage = await A.apprendre(opts.gabarits, { mail: m, texte, ia: s }).catch((e) => ({ fait: "erreur", raison: String(e.message || e) }));
  }
  return r;
};

module.exports = { lire, aCompleter, recalculer, DEFINITIVES };
