/* Qui reçoit le lead ?
   - le négociateur du bien (sauf s'il est coupé par une règle) ;
   - son assistant(e) : gardé(e), coupé(e) ou remplacé(e) ;
   - des adresses libres en plus, sans limite ;
   - le siège, toujours.
   Chaque personne absente (congés) ou hors de ses jours de travail (mi-temps)
   est remplacée par la personne choisie ; la chaîne de remplacement est suivie
   (sans boucle). Tout est expliqué dans « trace ».

   conf = {
     personnes: [{ id, nom, email, role, actif, assistante_id, temps: "plein"|"mi_temps",
                   jours: [1..7] (1 = lundi), remplacant_hors_jours: ref }],
     regles:   [{ cible: { negociateurs: [id…] } | { tous: true }, couper_negociateur, assistante: "garder"|"couper"|"remplacer",
                  assistante_remplacante: ref, adresses_libres: [email…], actif }],
     absences: [{ personne_id, debut: "AAAA-MM-JJ", fin: "AAAA-MM-JJ", remplacant: ref, motif }],
     siege:    [email…]
   }
   ref = { personne: id } | { email: "x@y" } */
"use strict";

const jour = (d) => { const x = new Date(d); return x.toISOString().slice(0, 10); };
const isoJour = (d) => { const n = new Date(d).getUTCDay(); return n === 0 ? 7 : n; };
const NOMS_JOURS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

const absenceDe = (conf, id, quand) => {
  const j = jour(quand);
  return (conf.absences || []).find((a) => String(a.personne_id) === String(id) && a.actif !== false && a.debut <= j && (!a.fin || a.fin >= j));
};

/* Personne disponible à cette date ? Sinon pourquoi et par qui la remplacer. */
const disponibilite = (conf, p, quand) => {
  if (!p) return { dispo: false, raison: "personne inconnue" };
  if (p.actif === false) return { dispo: false, raison: `${p.nom} est inactif(ve)`, remplacant: p.remplacant_inactif || null };
  const a = absenceDe(conf, p.id, quand);
  if (a) return { dispo: false, raison: `${p.nom} est en ${a.motif || "congés"} du ${a.debut} au ${a.fin || "…"}`, remplacant: a.remplacant || null, type: "absence" };
  if (p.temps === "mi_temps" && Array.isArray(p.jours) && p.jours.length && !p.jours.includes(isoJour(quand)))
    return { dispo: false, raison: `${p.nom} ne travaille pas le ${NOMS_JOURS[isoJour(quand)]} (mi-temps)`, remplacant: p.remplacant_hors_jours || null, type: "hors_jours" };
  return { dispo: true };
};

const regleDe = (conf, negoId) => {
  const rs = (conf.regles || []).filter((r) => r.actif !== false);
  return rs.find((r) => r.cible && (r.cible.negociateurs || []).map(String).includes(String(negoId)))
    || rs.find((r) => r.cible && r.cible.tous) || {};
};

const destinataires = (negoId, quand = new Date(), conf = {}) => {
  const P = new Map((conf.personnes || []).map((p) => [String(p.id), p]));
  const liste = [], trace = [];
  const vu = new Set();
  const ajouterAdresse = (email, role, pour, raison) => {
    const e = String(email || "").trim().toLowerCase();
    if (!e || !/@/.test(e)) return;
    const deja = liste.find((x) => x.email === e);
    if (deja) { if (!deja.roles.includes(role)) deja.roles.push(role); return; }
    liste.push({ email: e, role, roles: [role], pour, raison });
  };
  /* Ajoute une personne (ou son remplaçant, en suivant la chaîne). */
  const ajouterPersonne = (ref, role, pour, chemin = []) => {
    if (!ref) return;
    if (ref.email) return ajouterAdresse(ref.email, role, pour, chemin.length ? "remplace " + chemin.join(" → ") : "adresse libre");
    const p = P.get(String(ref.personne));
    if (!p) { trace.push(`${role} : personne ${ref.personne} introuvable`); return; }
    if (chemin.includes(p.nom) || chemin.length > 5) { trace.push(`${role} : boucle de remplacement (${chemin.concat(p.nom).join(" → ")}) — arrêt`); return; }
    const d = disponibilite(conf, p, quand);
    if (d.dispo) return ajouterAdresse(p.email, role, pour, chemin.length ? `remplace ${chemin.join(" → ")}` : "titulaire");
    trace.push(`${role} : ${d.raison}`);
    if (!d.remplacant) { trace.push(`${role} : aucun remplaçant prévu — ${p.nom} ne reçoit rien`); return; }
    ajouterPersonne(d.remplacant, role, pour, chemin.concat(p.nom));
  };

  const nego = P.get(String(negoId));
  const r = regleDe(conf, negoId);
  if (!nego) trace.push(negoId ? `négociateur ${negoId} inconnu` : "aucun négociateur trouvé pour ce lead");
  else {
    if (r.couper_negociateur) trace.push(`négociateur : ${nego.nom} coupé(e) par une règle d'envoi`);
    else ajouterPersonne({ personne: nego.id }, "negociateur", nego.nom);
    const modeA = r.assistante || "garder";
    if (modeA === "couper") trace.push("assistant(e) : coupé(e) par une règle d'envoi");
    else if (modeA === "remplacer") ajouterPersonne(r.assistante_remplacante, "assistante", nego.nom, []);
    else if (nego.assistante_id) ajouterPersonne({ personne: nego.assistante_id }, "assistante", nego.nom);
    else if (nego.email_assistante) ajouterAdresse(nego.email_assistante, "assistante", nego.nom, "assistante déclarée");
    for (const e of r.adresses_libres || []) ajouterAdresse(e, "adresse_libre", nego.nom, "adresse ajoutée par une règle");
  }
  for (const e of conf.siege || []) ajouterAdresse(e, "siege", "tous", "le siège reçoit toujours");
  return { liste, trace, regle: r.id || null };
};

/* Vue « qui est absent cette semaine, et qui prend le relais ». */
const absentsSemaine = (conf, lundi = new Date()) => {
  const d0 = new Date(lundi); d0.setUTCHours(12, 0, 0, 0);
  d0.setUTCDate(d0.getUTCDate() - (isoJour(d0) - 1));
  const P = new Map((conf.personnes || []).map((p) => [String(p.id), p]));
  const nom = (ref) => (!ref ? "personne (rien n'est transféré)" : ref.email ? ref.email : (P.get(String(ref.personne)) || {}).nom || "?");
  const out = [];
  for (const p of conf.personnes || []) {
    const jours = [];
    for (let i = 0; i < 7; i++) {
      const q = new Date(d0); q.setUTCDate(d0.getUTCDate() + i);
      const d = disponibilite(conf, p, q);
      if (!d.dispo && p.actif !== false) jours.push({ jour: jour(q), type: d.type, relais: nom(d.remplacant) });
    }
    if (jours.length) out.push({ personne: p.nom, role: p.role, jours, resume: [...new Set(jours.map((j) => (j.type === "absence" ? "congés" : "hors jours") + " → " + j.relais))].join(" ; ") });
  }
  return out;
};

module.exports = { destinataires, disponibilite, absentsSemaine, isoJour };
