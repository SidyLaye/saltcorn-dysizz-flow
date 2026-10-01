/* Suivi en direct des leads (administrateur) : /dysizz-flow/leads/suivi
   - chiffres des dernières heures par statut, erreurs d'IA et envois en échec ;
   - chaque lead avec sa décision, ses motifs et ses alertes ; les erreurs d'abord ;
   - recherche (e-mail, référence, objet, expéditeur) et filtre par statut ;
   - détail d'un lead : toutes ses valeurs et d'où vient chacune (règles, gabarit, IA).
   Lecture seule. La page se recharge toute seule toutes les 30 secondes. */
"use strict";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COULEUR = { erreur: "#b91c1c", echec: "#b91c1c", alerte: "#b45309", a_verifier: "#b45309", a_trier: "#b45309", non_automatise: "#b45309", pret: "#15803d", envoye: "#15803d", ecrit: "#15803d", ignore: "#6b7280" };
const quand = (d) => { try { return new Date(d).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };
const admin = (req, res) => { if (!req.user || req.user.role_id !== 1) { res.status(403).send("réservé à l'administrateur"); return false; } return true; };
const CSS = `<style>.dzs{font:14px/1.45 system-ui,sans-serif}.dzs table{width:100%;border-collapse:collapse}.dzs td,.dzs th{padding:.35rem .5rem;border-bottom:1px solid #e5e7eb;vertical-align:top;text-align:left}.dzs .st{font-weight:600}.dzs .k{display:inline-block;margin:0 .5rem .5rem 0;padding:.45rem .7rem;border:1px solid #e5e7eb;border-radius:10px}.dzs .k b{font-size:1.2rem;display:block}.dzs small{color:#6b7280}.dzs form{margin:.5rem 0 1rem}.dzs input,.dzs select{padding:.3rem .5rem}</style>`;

const page = async (req, res) => {
  if (!admin(req, res)) return;
  const { tables } = require("./tables/schema");
  const t = await tables();
  const h = Math.min(24 * 30, Math.max(1, +req.query.h || 24));
  const depuis = Date.now() - h * 3600e3;
  const q = String(req.query.q || "").trim().toLowerCase(), st = String(req.query.statut || "");
  const tous = await t.leads.getRows({}, { orderBy: "id", orderDesc: true, limit: 3000 });
  const recents = tous.filter((l) => new Date(l.traite_le || l.recu_le || 0).getTime() >= depuis);
  const parStatut = {};
  for (const l of recents) parStatut[l.statut || "?"] = (parStatut[l.statut || "?"] || 0) + 1;
  let iaKo = 0; try { iaKo = (await t.ia.getRows({ ok: false }, { orderBy: "id", orderDesc: true, limit: 500 })).filter((x) => new Date(x.quand).getTime() >= depuis).length; } catch (e) { /* rien */ }
  let envoisKo = null; try { if (t.envois) envoisKo = (await t.envois.getRows({}, { orderBy: "id", orderDesc: true, limit: 1000 })).filter((x) => /echec|erreur|abandon/i.test(String(x.statut || "")) && new Date(x.maj_le || x.cree_le || x.quand || 0).getTime() >= depuis).length; } catch (e) { /* rien */ }
  const grave = (l) => (/erreur|echec/i.test(l.statut) ? 0 : /alerte|a_verifier|a_trier|non_auto/i.test(l.statut) ? 1 : 2);
  const liste = recents.filter((l) => (!st || l.statut === st) && (!q || [l.contact_email, l.contact_nom, l.reference, l.objet, l.expediteur, l.bien_ref_crm, l.contact_tel].some((x) => String(x || "").toLowerCase().includes(q))))
    .sort((a, b) => grave(a) - grave(b) || b.id - a.id).slice(0, 300);
  const cartes = Object.entries(parStatut).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<a class="k" href="?h=${h}&statut=${encodeURIComponent(k)}" style="color:${COULEUR[k] || "#111"}"><b>${n}</b>${esc(k)}</a>`).join("")
    + `<span class="k" style="color:${iaKo ? "#b91c1c" : "#111"}"><b>${iaKo}</b>erreurs d'IA</span>` + (envoisKo === null ? "" : `<span class="k" style="color:${envoisKo ? "#b91c1c" : "#111"}"><b>${envoisKo}</b>envois en échec</span>`);
  const lignes = liste.map((l) => `<tr><td><small>${quand(l.traite_le || l.recu_le)}</small><br><a href="/dysizz-flow/leads/suivi/${l.id}">#${l.id}</a></td>
<td class="st" style="color:${COULEUR[l.statut] || "#111"}">${esc(l.statut)}<br><small>${esc(l.portail || "")} ${esc(l.mode || "")}</small></td>
<td>${esc(l.contact_nom || "")}<br><small>${esc(l.contact_email || "")} ${esc(l.contact_tel || "")}</small></td>
<td>${esc(l.reference || "")}${l.bien_crm ? `<br><small>bien ${esc(l.bien_ref_crm || l.bien_crm)} (${esc(l.bien_methode || "")})</small>` : ""}</td>
<td><small>${esc(String(l.motifs || "").slice(0, 300))}${l.alertes ? `<br><span style="color:#b45309">${esc(String(l.alertes).slice(0, 200))}</span>` : ""}</small></td>
<td><small>${esc(l.negociateur || "")}<br>${l.duree_ms ? l.duree_ms + " ms" : ""}</small></td></tr>`).join("");
  const html = `${CSS}<meta http-equiv="refresh" content="30"><div class="dzs"><h1>Leads : suivi en direct</h1>
<p><small>${recents.length} lead(s) sur ${h} h. Les erreurs et les leads à reprendre sont en tête. Mise à jour toutes les 30 s.</small></p>
<div>${cartes}</div>
<form><input name="q" value="${esc(req.query.q || "")}" placeholder="e-mail, nom, référence, objet…"> <select name="h">${[1, 6, 24, 72, 168, 720].map((x) => `<option value="${x}"${x === h ? " selected" : ""}>${x < 48 ? x + " h" : x / 24 + " j"}</option>`).join("")}</select>
<input type="hidden" name="statut" value="${esc(st)}"> <button>Chercher</button> ${st ? `<a href="?h=${h}">tous les statuts</a>` : ""}</form>
<table><thead><tr><th>Reçu</th><th>Statut</th><th>Prospect</th><th>Bien</th><th>Motifs / alertes</th><th>Négociateur</th></tr></thead><tbody>${lignes || '<tr><td colspan="6">Rien sur cette période.</td></tr>'}</tbody></table></div>`;
  res.sendWrap("Leads : suivi", html);
};

const detail = async (req, res) => {
  if (!admin(req, res)) return;
  const { tables } = require("./tables/schema");
  const t = await tables();
  const l = await t.leads.getRow({ id: +req.params.id });
  if (!l) return res.status(404).send("lead introuvable");
  let champs = []; try { champs = await t.champs.getRows({ lead: l.id }); } catch (e) { /* rien */ }
  const lignes = Object.entries(l).filter(([k, v]) => v !== null && v !== "" && k !== "id").map(([k, v]) => `<tr><th>${esc(k)}</th><td><pre style="white-space:pre-wrap;margin:0">${esc(typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v, null, 1) : v instanceof Date ? quand(v) : v)}</pre></td></tr>`).join("");
  const prov = champs.map((c) => `<tr><td>${esc(c.champ)}</td><td>${esc(c.valeur)}</td><td><small>${esc(c.provenance)}</small></td></tr>`).join("");
  res.sendWrap(`Lead #${l.id}`, `${CSS}<div class="dzs"><p><a href="/dysizz-flow/leads/suivi">← suivi</a></p><h1>Lead #${l.id} — <span style="color:${COULEUR[l.statut] || "#111"}">${esc(l.statut)}</span></h1>
${prov ? `<h2>Valeurs lues et leur origine</h2><table><tr><th>Champ</th><th>Valeur</th><th>Lu par</th></tr>${prov}</table>` : ""}
<h2>Tout le lead</h2><table>${lignes}</table></div>`);
};

module.exports = { page, detail };
