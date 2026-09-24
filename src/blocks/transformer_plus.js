/* Blocs « Transformer » (suite) : regrouper, joindre, comparer, extraire. */
"use strict";
const { asList, getPath } = require("../engine");

const slug = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")));

module.exports = [
  {
    name: "dzf_liste_grouper", label: "Liste : regrouper et compter", category: "Transformer", icon: "fas fa-layer-group", output: "groupes",
    description: "Regroupe une liste par un champ et calcule, pour chaque groupe, le nombre d'éléments et la somme / moyenne / min / max d'un champ.",
    params: [{ name: "liste", label: "Liste", required: true }, { name: "par", label: "Regrouper par (champ)", required: true },
      { name: "champ", label: "Champ à calculer (facultatif)" }, { name: "tri", label: "Trier par", type: "select", options: ["nombre", "somme", "groupe"], default: "nombre" }],
    run: async (p) => {
      const g = new Map();
      for (const it of asList(p.liste)) {
        const k = String(getPath(it, p.par) ?? "(vide)");
        const x = g.get(k) || { groupe: k, nombre: 0, somme: 0, min: null, max: null };
        x.nombre++;
        if (p.champ) { const v = num(getPath(it, p.champ)); if (Number.isFinite(v)) { x.somme += v; x.min = x.min === null ? v : Math.min(x.min, v); x.max = x.max === null ? v : Math.max(x.max, v); } }
        g.set(k, x);
      }
      const out = [...g.values()].map((x) => ({ ...x, moyenne: x.nombre ? +(x.somme / x.nombre).toFixed(4) : 0 }));
      return out.sort((a, b) => (p.tri === "groupe" ? a.groupe.localeCompare(b.groupe) : (b[p.tri || "nombre"] || 0) - (a[p.tri || "nombre"] || 0)));
    },
  },
  {
    name: "dzf_liste_joindre", label: "Liste : joindre deux listes", category: "Transformer", icon: "fas fa-object-group", output: "liste",
    description: "Complète chaque élément d'une liste avec l'élément de l'autre liste qui a la même clé (comme une jointure SQL).",
    params: [{ name: "gauche", label: "Liste principale", required: true }, { name: "droite", label: "Liste à joindre", required: true },
      { name: "cle_gauche", label: "Clé dans la principale", required: true }, { name: "cle_droite", label: "Clé dans l'autre", required: true },
      { name: "prefixe", label: "Préfixe des champs ajoutés", default: "" }, { name: "type", label: "Type", type: "select", options: ["garder tout (left)", "seulement les correspondances (inner)"], default: "garder tout (left)" }],
    run: async (p) => {
      const idx = new Map(asList(p.droite).map((r) => [String(getPath(r, p.cle_droite)), r]));
      const out = [];
      for (const l of asList(p.gauche)) {
        const r = idx.get(String(getPath(l, p.cle_gauche)));
        if (!r && p.type !== "garder tout (left)") continue;
        out.push({ ...l, ...(r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [`${p.prefixe || ""}${k}`, v])) : {}) });
      }
      return out;
    },
  },
  {
    name: "dzf_liste_comparer", label: "Liste : ce qui a changé", category: "Transformer", icon: "fas fa-not-equal", output: "changements",
    description: "Compare l'ancienne et la nouvelle version d'une liste par une clé : éléments ajoutés, retirés, modifiés. Idéal pour détecter ce qui a bougé sur un site ou une API.",
    params: [{ name: "avant", label: "Liste d'avant", required: true }, { name: "apres", label: "Liste d'après", required: true }, { name: "cle", label: "Clé", required: true },
      { name: "champs", label: "Champs comparés (facultatif)", help: "Séparés par des virgules. Vide = tous" }],
    run: async (p) => {
      const A = new Map(asList(p.avant).map((x) => [String(getPath(x, p.cle)), x]));
      const B = new Map(asList(p.apres).map((x) => [String(getPath(x, p.cle)), x]));
      const f = String(p.champs || "").split(",").map((s) => s.trim()).filter(Boolean);
      const same = (a, b) => (f.length ? f : [...new Set([...Object.keys(a), ...Object.keys(b)])]).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
      const ajoutes = [...B.keys()].filter((k) => !A.has(k)).map((k) => B.get(k));
      const retires = [...A.keys()].filter((k) => !B.has(k)).map((k) => A.get(k));
      const modifies = [...B.keys()].filter((k) => A.has(k) && !same(A.get(k), B.get(k))).map((k) => ({ avant: A.get(k), apres: B.get(k) }));
      return { ajoutes, retires, modifies, change: !!(ajoutes.length || retires.length || modifies.length) };
    },
  },
  {
    name: "dzf_liste_aplatir", label: "Liste : aplatir / extraire un champ", category: "Transformer", icon: "fas fa-compress", output: "liste",
    description: "Transforme une liste de listes en une seule liste, ou garde seulement la valeur d'un champ de chaque élément (ex. la liste des e-mails).",
    params: [{ name: "liste", label: "Liste", required: true }, { name: "champ", label: "Garder seulement ce champ (facultatif)" }, { name: "sans_vides", label: "Retirer les valeurs vides", type: "bool", default: true }],
    run: async (p) => {
      let l = asList(p.liste).flat(Infinity);
      if (p.champ) l = l.map((x) => getPath(x, p.champ)).flat(Infinity);
      return p.sans_vides === false ? l : l.filter((x) => x !== undefined && x !== null && x !== "");
    },
  },
  {
    name: "dzf_liste_element", label: "Liste : premier, dernier, N-ième, taille", category: "Transformer", icon: "fas fa-list-ol", output: "element",
    description: "Prend un élément d'une liste (premier, dernier, position N, au hasard) ou donne sa taille.",
    params: [{ name: "liste", label: "Liste", required: true }, { name: "quoi", label: "Quoi", type: "select", options: ["premier", "dernier", "position", "au hasard", "taille"], default: "premier" }, { name: "position", label: "Position (commence à 0)", type: "int", default: 0 }],
    run: async (p) => {
      const l = asList(p.liste);
      if (p.quoi === "taille") return l.length;
      if (p.quoi === "dernier") return l[l.length - 1] ?? null;
      if (p.quoi === "position") return l[+p.position || 0] ?? null;
      if (p.quoi === "au hasard") return l.length ? l[require("crypto").randomInt(l.length)] : null;
      return l[0] ?? null;
    },
  },
  {
    name: "dzf_objet_champs", label: "Objet : garder, renommer, retirer des champs", category: "Transformer", icon: "fas fa-columns", output: "objet",
    description: "Sur un objet ou chaque élément d'une liste : garde seulement certains champs, en renomme, en retire. Pour envoyer à une API exactement ce qu'elle attend.",
    params: [{ name: "valeur", label: "Objet ou liste", required: true }, { name: "garder", label: "Garder (facultatif)", help: "Champs séparés par des virgules" },
      { name: "retirer", label: "Retirer (facultatif)" }, { name: "renommer", label: "Renommer (JSON)", type: "json", help: '{"ancien":"nouveau"}' }],
    run: async (p) => {
      const keep = String(p.garder || "").split(",").map((s) => s.trim()).filter(Boolean);
      const drop = new Set(String(p.retirer || "").split(",").map((s) => s.trim()).filter(Boolean));
      const ren = p.renommer || {};
      const one = (o) => {
        if (!o || typeof o !== "object") return o;
        let e = Object.entries(o);
        if (keep.length) e = e.filter(([k]) => keep.includes(k));
        e = e.filter(([k]) => !drop.has(k)).map(([k, v]) => [ren[k] || k, v]);
        return Object.fromEntries(e);
      };
      return Array.isArray(p.valeur) ? p.valeur.map(one) : one(p.valeur);
    },
  },
  {
    name: "dzf_regex", label: "Texte : chercher avec une expression régulière", category: "Transformer", icon: "fas fa-asterisk", output: "regex",
    description: "Teste, extrait ou remplace dans un texte avec une expression régulière (ex. extraire un numéro de commande d'un mail).",
    params: [{ name: "texte", label: "Texte", required: true }, { name: "motif", label: "Expression régulière", required: true, help: "Ex. Commande n°\\s*(\\d+)" },
      { name: "action", label: "Action", type: "select", options: ["tester", "premier résultat", "tous les résultats", "remplacer"], default: "premier résultat" },
      { name: "remplacement", label: "Remplacer par", help: "$1 = 1er groupe" }, { name: "options", label: "Options", default: "i", help: "i = sans casse, m = multiligne, s = . inclut les retours" }],
    run: async (p) => {
      const flags = String(p.options || "").replace(/[^imsu]/g, "");
      const t = String(p.texte ?? "");
      if (t.length > 1e6) throw new Error("texte trop long (1 Mo max)");
      const re = new RegExp(p.motif, flags);
      if (p.action === "tester") return re.test(t);
      if (p.action === "remplacer") return t.replace(new RegExp(p.motif, flags + "g"), p.remplacement ?? "");
      if (p.action === "tous les résultats") return [...t.matchAll(new RegExp(p.motif, flags + "g"))].slice(0, 1000).map((m) => (m.length > 1 ? (m.length > 2 ? m.slice(1) : m[1]) : m[0]));
      const m = re.exec(t);
      return m ? (m.groups ? { ...m.groups } : m.length > 1 ? (m.length > 2 ? m.slice(1) : m[1]) : m[0]) : null;
    },
  },
  {
    name: "dzf_texte_outils", label: "Texte : outils", category: "Transformer", icon: "fas fa-font", output: "texte",
    description: "Majuscules, minuscules, première lettre en majuscule, slug d'URL, couper à N caractères, enlever les espaces, découper en liste, assembler une liste.",
    params: [{ name: "valeur", label: "Texte ou liste", required: true }, { name: "operation", label: "Opération", type: "select", options: ["majuscules", "minuscules", "capitaliser", "slug", "couper", "nettoyer les espaces", "découper", "assembler", "longueur"], default: "nettoyer les espaces" },
      { name: "n", label: "Longueur (pour couper)", type: "int", default: 160 }, { name: "separateur", label: "Séparateur (découper / assembler)", default: "," }],
    run: async (p) => {
      const v = p.valeur;
      const s = Array.isArray(v) ? v : String(v ?? "");
      switch (p.operation) {
        case "majuscules": return String(s).toUpperCase();
        case "minuscules": return String(s).toLowerCase();
        case "capitaliser": return String(s).charAt(0).toUpperCase() + String(s).slice(1);
        case "slug": return slug(s);
        case "couper": { const t = String(s); const n = +p.n || 160; return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; }
        case "découper": return String(s).split(p.separateur ?? ",").map((x) => x.trim()).filter(Boolean);
        case "assembler": return asList(v).join(p.separateur ?? ", ");
        case "longueur": return Array.isArray(s) ? s.length : String(s).length;
        default: return String(s).replace(/\s+/g, " ").trim();
      }
    },
  },
  {
    name: "dzf_calcul", label: "Nombre : calculer", category: "Transformer", icon: "fas fa-square-root-alt", output: "nombre",
    description: "Calcule une formule avec des variables (ex. {{prix}} * 1.2), arrondit, met en forme (€, %, séparateurs français).",
    params: [{ name: "formule", label: "Formule", required: true, help: "Ex. ({{total}} - {{rembourse}}) / {{jours}}. Chiffres, + - * / % ( ) et Math.round/min/max/abs" },
      { name: "decimales", label: "Décimales", type: "int", default: 2 }, { name: "format", label: "Format du résultat", type: "select", options: ["nombre", "texte fr", "euros", "pourcentage"], default: "nombre" }],
    run: async (p) => {
      const f = String(p.formule);
      if (!/^[\d\s+\-*/%().,eE]*$/.test(f.replace(/Math\.(round|min|max|abs|floor|ceil|sqrt|pow)\b/g, ""))) throw Object.assign(new Error("formule refusée : seulement des nombres, opérations et Math.*"), { permanent: true });
      // eslint-disable-next-line no-new-func
      const v = Number(new Function(`"use strict"; return (${f});`)());
      if (!Number.isFinite(v)) throw new Error("le résultat n'est pas un nombre");
      const d = +p.decimales >= 0 ? +p.decimales : 2;
      const r = Math.round(v * 10 ** d) / 10 ** d;
      if (p.format === "texte fr") return r.toLocaleString("fr-FR", { maximumFractionDigits: d });
      if (p.format === "euros") return r.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: d });
      if (p.format === "pourcentage") return `${r.toLocaleString("fr-FR", { maximumFractionDigits: d })} %`;
      return r;
    },
  },
  {
    name: "dzf_xml", label: "XML : lire", category: "Transformer", icon: "fas fa-file-code", output: "xml",
    description: "Transforme un texte XML (API SOAP, fichiers d'échange, sitemaps) en objet utilisable par les autres blocs.",
    params: [{ name: "valeur", label: "XML", required: true }],
    run: async (p) => {
      const { XMLParser } = require("fast-xml-parser");
      return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", processEntities: true }).parse(String(p.valeur));
    },
  },
];
