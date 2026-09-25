/* Tests de mutation : chaque mail de test est abîmé exprès (comme le font les messageries et
   les portails d'une semaine à l'autre) et la lecture doit donner le même résultat.
   Si un de ces tests casse, c'est qu'une petite différence de mise en page suffit à tromper le moteur. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { extraire } = require("../src/lib/leads/extraire");
const { CONF, MAILS } = require("./fixtures-leads.cjs");

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MUTATIONS = {
  "fins de ligne Windows": (m) => ({ ...m, texte: m.texte && m.texte.replace(/\n/g, "\r\n") }),
  "lignes vides en plus": (m) => ({ ...m, texte: m.texte && m.texte.replace(/\n/g, "\n\n") }),
  "espaces en trop": (m) => ({ ...m, texte: m.texte && m.texte.split("\n").map((l) => "  " + l.replace(/ /g, "  ") + "   ").join("\n") }),
  "espaces insécables": (m) => ({ ...m, texte: m.texte && m.texte.replace(/ :/g, " :").replace(/ (€|m²)/g, " $1") }),
  "texte recoupé à 60 colonnes": (m) => ({ ...m, texte: m.texte && m.texte.split("\n").flatMap((l) => { if (l.length <= 60 || /@|https?:/.test(l)) return [l]; const out = []; let cur = ""; for (const w of l.split(" ")) { if ((cur + " " + w).trim().length > 60) { out.push(cur.trim()); cur = w; } else cur += " " + w; } out.push(cur.trim()); return out; }).join("\n") }),
  "HTML seulement": (m) => (m.texte ? { ...m, texte: "", html: "<html><body>" + m.texte.split("\n").map((l) => `<p>${esc(l)}</p>`).join("") + "</body></html>" } : m),
  "HTML en tableau": (m) => (m.texte ? { ...m, texte: "", html: "<table>" + m.texte.split("\n").map((l) => { const x = l.match(/^([^:]{1,40}):\s*(.*)$/); return x ? `<tr><td>${esc(x[1])} :</td><td>${esc(x[2])}</td></tr>` : `<tr><td colspan=2>${esc(l)}</td></tr>`; }).join("") + "</table>" } : m),
  "objet avec préfixe de transfert perdu": (m) => ({ ...m, objet: String(m.objet || "").replace(/^(tr|fwd?)\s*:\s*/i, "") }),
  "caractères mal décodés (latin-1)": (m) => ({ ...m, texte: m.texte && Buffer.from(m.texte, "utf8").toString("latin1") }),
};

/* ce qui doit rester identique */
const cle = (r) => ({ nature: r.nature, portail: r.portail, email: r.contact.email || r.contact.email_relais || null, telephone: r.contact.telephone || null, reference: r.bien.reference || r.bien.id_crm || null });

let n = 0; const echecs = [];
for (const [nom, mail] of Object.entries(MAILS)) {
  const base = cle(extraire(mail, CONF));
  for (const [mut, f] of Object.entries(MUTATIONS)) {
    if (nom === "transfert" && mut === "objet avec préfixe de transfert perdu") continue;
    const m = f(mail);
    if (!m.texte && !m.html) continue;
    const r = cle(extraire(m, CONF));
    n++;
    for (const k of Object.keys(base)) if (String(base[k]) !== String(r[k])) echecs.push(`${nom} / ${mut} : ${k} « ${base[k]} » devient « ${r[k]} »`);
  }
}

/* Un champ qui manque ne doit rien casser d'autre. */
for (const [nom, mail] of Object.entries(MAILS)) {
  if (!mail.texte) continue;
  const base = cle(extraire(mail, CONF));
  const sansTel = { ...mail, texte: mail.texte.split("\n").filter((l) => !/^(t[ée]l[ée]phone|tel|phone)\b/i.test(l.trim())).join("\n") };
  const r = cle(extraire(sansTel, CONF));
  n++;
  for (const k of ["nature", "portail", "email", "reference"]) if (String(base[k]) !== String(r[k])) echecs.push(`${nom} / sans téléphone : ${k} « ${base[k]} » devient « ${r[k]} »`);
}

if (echecs.length) { console.error(echecs.join("\n")); }
assert.strictEqual(echecs.length, 0, `${echecs.length} lecture(s) cassée(s) par une petite différence de mise en page`);
console.log(`mutations OK : ${n} variantes relues à l'identique`);
