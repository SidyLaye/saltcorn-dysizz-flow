/* Blocs « Transformer » : préparer les données entre deux étapes, sans code. */
"use strict";
const { asList, deep, getPath, parseJSON } = require("../engine");
const { plain } = require("../core");

/* condition écrite en JavaScript (réservé aux admins, comme les formules de Saltcorn) */
const fn = (expr, args) => {
  try { return new Function(...args, `"use strict"; return (${expr});`); } catch (e) { throw new Error(`condition invalide : ${e.message}`); }
};
const OPS = {
  "=": (a, b) => String(a ?? "") === String(b ?? ""),
  "≠": (a, b) => String(a ?? "") !== String(b ?? ""),
  "contient": (a, b) => String(a ?? "").toLowerCase().includes(String(b ?? "").toLowerCase()),
  "ne contient pas": (a, b) => !String(a ?? "").toLowerCase().includes(String(b ?? "").toLowerCase()),
  "commence par": (a, b) => String(a ?? "").toLowerCase().startsWith(String(b ?? "").toLowerCase()),
  ">": (a, b) => Number(a) > Number(b),
  "<": (a, b) => Number(a) < Number(b),
  "vide": (a) => a === undefined || a === null || a === "",
  "non vide": (a) => !(a === undefined || a === null || a === ""),
  "vrai": (a) => !!a,
  "faux": (a) => !a,
};

const fmt = (d, f) => {
  const x = new Date(d);
  if (isNaN(x)) return null;
  switch (f) {
    case "fr court": return x.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
    case "fr long": return x.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    case "fr date et heure": return x.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    case "jour (AAAA-MM-JJ)": return x.toISOString().slice(0, 10);
    default: return x.toISOString();
  }
};

const csvCell = (v, sep) => { const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s; };
const parseCsv = (txt, sep) => {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"' && txt[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head, ...rest] = rows;
  return (rest || []).filter((r) => r.some((x) => x !== "")).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])));
};

module.exports = [
  {
    name: "dzf_definir", label: "Définir des valeurs", category: "Transformer", icon: "fas fa-equals", output: "valeurs",
    description: "Crée des variables à partir de textes, de nombres ou d'autres variables.",
    params: [{ name: "valeurs", label: "Valeurs (JSON)", type: "json", required: true, help: 'Ex. {"titre":"Mail de {{de_nom}}","priorite":"haute"}' },
      { name: "fusionner", label: "Mettre directement dans le contexte (sans passer par « sortie »)", type: "bool" }],
    run: async (p) => (p.fusionner ? { __merge: p.valeurs } : p.valeurs),
  },
  {
    name: "dzf_liste_transformer", label: "Liste : transformer chaque élément", category: "Transformer", icon: "fas fa-exchange-alt", output: "liste",
    description: "Construit un nouvel objet pour chaque élément d'une liste (comme « map »). Dans le modèle : {{item.champ}}, {{index}} et tout le contexte.",
    params: [{ name: "liste", label: "Liste (variable)", required: true, help: "Ex. {{articles}}" },
      { name: "modele", label: "Modèle d'un élément (JSON)", type: "json", raw: true, required: true, help: 'Ex. {"titre":"{{item.title}}","url":"{{item.link}}","source":"{{source.id}}"}' }],
    run: async (p, ctx) => {
      return asList(p.liste).map((item, index) => deep(p.modele, { ...ctx, item, index }));
    },
  },
  {
    name: "dzf_liste_filtrer", label: "Liste : filtrer", category: "Transformer", icon: "fas fa-filter", output: "liste",
    description: "Garde les éléments qui respectent une condition simple (champ, opérateur, valeur) ou une expression JavaScript.",
    params: [{ name: "liste", label: "Liste (variable)", required: true },
      { name: "champ", label: "Champ", help: "Ex. theme ou source.nom" },
      { name: "operateur", label: "Opérateur", type: "select", options: Object.keys(OPS), default: "=" },
      { name: "valeur", label: "Valeur", help: "Peut contenir des {{variables}}" },
      { name: "expression", label: "…ou expression JavaScript", help: "Remplace les 3 réglages au-dessus. Ex. item.prix > 100 && item.stock" }],
    run: async (p, ctx) => {
      const list = asList(p.liste);
      if (p.expression) { const f = fn(p.expression, ["item", "index", "ctx"]); return list.filter((x, i) => f(x, i, ctx)); }
      const op = OPS[p.operateur || "="];
      return list.filter((x) => op(getPath(x, p.champ), p.valeur));
    },
  },
  {
    name: "dzf_liste_dedoublonner", label: "Liste : enlever les doublons", category: "Transformer", icon: "fas fa-clone", output: "liste",
    description: "Retire les éléments en double (même clé), et en option ceux qui existent déjà dans une table. Évite de retraiter ce qui est déjà vu.",
    params: [{ name: "liste", label: "Liste (variable)", required: true }, { name: "cle", label: "Champ clé", required: true, help: "Ex. url" },
      { name: "table", label: "Déjà présents dans la table (facultatif)", type: "table" }, { name: "champ_table", label: "Champ de la table", help: "Vide = même nom que la clé" }],
    run: async (p, ctx, api) => {
      const seen = new Set();
      let list = asList(p.liste).filter((x) => { const k = String(getPath(x, p.cle) ?? ""); if (!k || seen.has(k)) return false; seen.add(k); return true; });
      if (p.table && list.length) {
        const t = api.Table.findOne({ name: p.table });
        if (!t) throw new Error(`table « ${p.table} » introuvable`);
        const f = p.champ_table || p.cle;
        const known = new Set();
        for (let i = 0; i < list.length; i += 500) {
          const part = list.slice(i, i + 500).map((x) => getPath(x, p.cle));
          for (const r of await t.getRows({ [f]: { in: part } }, { fields: [f] })) known.add(String(r[f]));
        }
        list = list.filter((x) => !known.has(String(getPath(x, p.cle))));
      }
      return list;
    },
  },
  {
    name: "dzf_liste_trier", label: "Liste : trier et limiter", category: "Transformer", icon: "fas fa-sort-amount-down", output: "liste",
    description: "Trie une liste sur un champ et garde les N premiers.",
    params: [{ name: "liste", label: "Liste (variable)", required: true }, { name: "champ", label: "Trier par" },
      { name: "ordre", label: "Ordre", type: "select", options: ["croissant", "décroissant"], default: "décroissant" }, { name: "limite", label: "Garder les N premiers", type: "int" }],
    run: async (p) => {
      const l = [...asList(p.liste)];
      if (p.champ) l.sort((a, b) => { const x = getPath(a, p.champ), y = getPath(b, p.champ); const r = x > y ? 1 : x < y ? -1 : 0; return p.ordre === "croissant" ? r : -r; });
      return p.limite ? l.slice(0, +p.limite) : l;
    },
  },
  {
    name: "dzf_liste_lots", label: "Liste : découper en lots", category: "Transformer", icon: "fas fa-th-large", output: "lots",
    description: "Découpe une grosse liste en paquets (à traiter avec une boucle), pour ne pas surcharger le serveur ou une API.",
    params: [{ name: "liste", label: "Liste (variable)", required: true }, { name: "taille", label: "Taille d'un lot", type: "int", default: 50 }],
    run: async (p) => { const l = asList(p.liste), n = Math.max(1, +p.taille || 50), out = []; for (let i = 0; i < l.length; i += n) out.push(l.slice(i, i + n)); return out; },
  },
  {
    name: "dzf_texte", label: "Texte depuis un modèle", category: "Transformer", icon: "fas fa-align-left", output: "texte",
    description: "Écrit un texte avec des {{variables}}. En option, une ligne par élément d'une liste, insérée à la place de {{lignes}}.",
    params: [{ name: "modele", label: "Modèle", type: "text", raw: true, required: true, help: "Ex. Bonjour, {{nombre}} tâches aujourd'hui :\n{{lignes}}" },
      { name: "liste", label: "Liste pour {{lignes}} (facultatif)" }, { name: "modele_ligne", label: "Modèle d'une ligne", raw: true, default: "- {{item.titre}}" }],
    run: async (p, ctx) => {
      const { interpolate } = require("../engine");
      const lignes = p.liste ? asList(p.liste).map((item, index) => interpolate(p.modele_ligne || "- {{item}}", { ...ctx, item, index })).join("\n") : "";
      return interpolate(String(p.modele).replace(/\{\{\s*lignes\s*\}\}/g, "\u0000L"), ctx).replace("\u0000L", lignes);
    },
  },
  {
    name: "dzf_dates", label: "Dates", category: "Transformer", icon: "far fa-calendar-alt", output: "date",
    description: "Maintenant, dans N jours, début du mois ou de la semaine, ou une date mise en forme en français.",
    params: [{ name: "operation", label: "Opération", type: "select", options: ["maintenant", "ajouter des jours", "début du jour", "début de la semaine", "début du mois", "mettre en forme"], default: "maintenant" },
      { name: "date", label: "Date de départ", help: "Vide = maintenant. Ex. {{echeance}}" }, { name: "jours", label: "Jours à ajouter (peut être négatif)", type: "int", default: 0 },
      { name: "format", label: "Format du résultat", type: "select", options: ["iso", "jour (AAAA-MM-JJ)", "fr court", "fr long", "fr date et heure"], default: "iso" }],
    run: async (p) => {
      const d = p.date ? new Date(p.date) : new Date();
      if (isNaN(d)) throw new Error("date invalide");
      if (p.operation === "ajouter des jours") d.setDate(d.getDate() + (+p.jours || 0));
      if (["début du jour", "début de la semaine", "début du mois"].includes(p.operation)) d.setHours(0, 0, 0, 0);
      if (p.operation === "début de la semaine") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      if (p.operation === "début du mois") d.setDate(1);
      return fmt(d, p.format || "iso");
    },
  },
  {
    name: "dzf_json", label: "JSON : lire ou écrire", category: "Transformer", icon: "fas fa-code", output: "json",
    description: "Transforme un texte JSON en objet, ou un objet en texte JSON.",
    params: [{ name: "operation", label: "Sens", type: "select", options: ["texte → objet", "objet → texte"], default: "texte → objet" }, { name: "valeur", label: "Valeur", required: true, help: "Ex. {{http.data}}" }],
    run: async (p) => (p.operation === "objet → texte" ? JSON.stringify(p.valeur) : typeof p.valeur === "string" ? parseJSON(p.valeur, "valeur") : p.valeur),
  },
  {
    name: "dzf_csv", label: "CSV : lire ou écrire", category: "Transformer", icon: "fas fa-file-csv", output: "csv",
    description: "Transforme un texte CSV en liste d'objets (1re ligne = en-têtes), ou une liste en CSV.",
    params: [{ name: "operation", label: "Sens", type: "select", options: ["CSV → liste", "liste → CSV"], default: "CSV → liste" }, { name: "valeur", label: "Valeur", required: true },
      { name: "separateur", label: "Séparateur", type: "select", options: [";", ",", "tab"], default: ";" }],
    run: async (p) => {
      const sep = p.separateur === "tab" ? "\t" : p.separateur || ";";
      if (p.operation === "liste → CSV") {
        const l = asList(p.valeur);
        const cols = [...new Set(l.flatMap((x) => Object.keys(x || {})))];
        return [cols.join(sep), ...l.map((x) => cols.map((c) => csvCell(x[c], sep)).join(sep))].join("\n");
      }
      return parseCsv(String(p.valeur).replace(/^﻿/, ""), sep);
    },
  },
  {
    name: "dzf_html_texte", label: "HTML → texte", category: "Transformer", icon: "fas fa-eraser", output: "texte",
    description: "Retire les balises, scripts et styles d'un HTML (mail, article) et coupe à la longueur voulue.",
    params: [{ name: "valeur", label: "HTML", required: true }, { name: "max", label: "Longueur max (0 = tout)", type: "int", default: 0 }],
    run: async (p) => plain(p.valeur, +p.max || 0),
  },
];
