/* Blocs « Données » : lire et écrire dans les tables Saltcorn, vite et sans doublon. */
"use strict";
const { asList } = require("../engine");

const T = (api, name) => {
  const t = api.Table.findOne({ name });
  if (!t) throw new Error(`table « ${name} » introuvable`);
  const role = api.user ? api.user.role_id : 1;
  return { t, canRead: role <= t.min_role_read, canWrite: role <= t.min_role_write };
};
/* les workflows planifiés tournent sans utilisateur : ils ont les droits admin (comme Saltcorn) */
const needRead = (x, api) => { if (api.user && !x.canRead) throw new Error("lecture refusée pour ton rôle"); return x.t; };
const needWrite = (x, api) => { if (api.user && !x.canWrite) throw new Error("écriture refusée pour ton rôle"); return x.t; };

const FILTRE = { name: "filtre", label: "Filtre (JSON)", type: "json", help: 'Ex. {"statut":"à faire"}, {"not":{"statut":"fait"}}, {"date":{"gt":"{{depuis}}"}}. Vide = toutes les lignes' };
const CHUNK = 500;

module.exports = [
  {
    name: "dzf_table_chercher", label: "Table : chercher des lignes", category: "Données", icon: "fas fa-search", output: "lignes",
    description: "Lit des lignes d'une table avec un filtre, un tri et une limite.",
    params: [{ name: "table", label: "Table", type: "table", required: true }, FILTRE,
      { name: "tri", label: "Trier par (champ)", default: "id" }, { name: "decroissant", label: "Ordre décroissant", type: "bool" },
      { name: "limite", label: "Nombre max de lignes", type: "int", default: 200 }],
    run: async (p, ctx, api) => needRead(T(api, p.table), api).getRows(p.filtre || {}, { orderBy: p.tri || "id", orderDesc: !!p.decroissant, limit: Math.min(+p.limite || 200, 10000) }),
  },
  {
    name: "dzf_table_compter", label: "Table : compter ou additionner", category: "Données", icon: "fas fa-calculator", output: "total",
    description: "Compte les lignes, ou fait une somme / moyenne / min / max d'un champ.",
    params: [{ name: "table", label: "Table", type: "table", required: true }, FILTRE,
      { name: "stat", label: "Calcul", type: "select", options: ["compter", "somme", "moyenne", "min", "max"], default: "compter" },
      { name: "champ", label: "Champ (sauf pour compter)" }],
    run: async (p, ctx, api) => {
      const t = needRead(T(api, p.table), api);
      if (p.stat === "compter" || !p.champ) return t.countRows(p.filtre || {});
      const agg = { somme: "Sum", moyenne: "Avg", min: "Min", max: "Max" }[p.stat];
      const r = await t.aggregationQuery({ v: { field: p.champ, aggregate: agg } }, { where: p.filtre || {} });
      return Number((r && r.v) || 0);
    },
  },
  {
    name: "dzf_table_ajouter", label: "Table : ajouter", category: "Données", icon: "fas fa-plus", output: "ajout",
    description: "Ajoute une ligne, ou toute une liste de lignes d'un coup.",
    params: [{ name: "table", label: "Table", type: "table", required: true },
      { name: "valeurs", label: "Une ligne (JSON)", type: "json", help: 'Ex. {"titre":"{{sujet}}","statut":"à faire"}' },
      { name: "liste", label: "…ou une liste (variable)", help: "Ex. {{articles}} : une ligne par élément" },
      { name: "sans_declencheurs", label: "Ne pas lancer les déclencheurs de la table", type: "bool" }],
    run: async (p, ctx, api) => {
      const t = needWrite(T(api, p.table), api);
      const rows = p.liste ? asList(p.liste) : [p.valeurs || {}];
      const ids = [];
      for (const r of rows) ids.push(await t.insertRow(r, api.user, undefined, !!p.sans_declencheurs));
      return rows.length === 1 && !p.liste ? ids[0] : { nombre: ids.length, ids };
    },
  },
  {
    name: "dzf_table_upsert", label: "Table : ajouter ou mettre à jour", category: "Données", icon: "fas fa-sync", output: "upsert",
    description: "Pour chaque élément : met à jour la ligne qui a la même clé, sinon l'ajoute. Idéal pour synchroniser sans doublon (lu par paquets de 500).",
    params: [{ name: "table", label: "Table", type: "table", required: true },
      { name: "liste", label: "Éléments (variable)", required: true, help: "Ex. {{articles}}" },
      { name: "cle", label: "Champ clé", required: true, help: "Ex. url, ref, message_id" },
      { name: "mettre_a_jour", label: "Champs mis à jour si la ligne existe", help: "Séparés par des virgules. Vide = aucun (on ignore les existantes)" },
      { name: "sans_declencheurs", label: "Ne pas lancer les déclencheurs de la table", type: "bool" }],
    run: async (p, ctx, api) => {
      const t = needWrite(T(api, p.table), api);
      const items = asList(p.liste).filter((x) => x && x[p.cle] !== undefined && x[p.cle] !== null && x[p.cle] !== "");
      const upd = String(p.mettre_a_jour || "").split(",").map((s) => s.trim()).filter(Boolean);
      const out = { ajoutes: 0, mis_a_jour: 0, ignores: 0, ids: [] };
      for (let i = 0; i < items.length; i += CHUNK) {
        const part = items.slice(i, i + CHUNK);
        const existing = await t.getRows({ [p.cle]: { in: part.map((x) => x[p.cle]) } });
        const byKey = new Map(existing.map((r) => [String(r[p.cle]), r]));
        for (const x of part) {
          const ex = byKey.get(String(x[p.cle]));
          if (!ex) { const id = await t.insertRow(x, api.user, undefined, !!p.sans_declencheurs); out.ids.push(id); out.ajoutes++; byKey.set(String(x[p.cle]), { id }); }
          else if (upd.length) { await t.updateRow(Object.fromEntries(upd.filter((f) => f in x).map((f) => [f, x[f]])), ex.id, api.user, !!p.sans_declencheurs); out.mis_a_jour++; }
          else out.ignores++;
        }
      }
      return out;
    },
  },
  {
    name: "dzf_table_modifier", label: "Table : modifier", category: "Données", icon: "fas fa-pen", output: "modifies",
    description: "Modifie toutes les lignes qui correspondent au filtre (ou la ligne dont l'id est donné).",
    params: [{ name: "table", label: "Table", type: "table", required: true }, { name: "id", label: "Id de la ligne (sinon filtre)", help: "Ex. {{id}}" },
      { name: "ids", label: "…ou une liste d'ids (ou de lignes)", help: "Ex. {{a_prevenir}} : chaque élément ou son champ id" }, FILTRE,
      { name: "valeurs", label: "Nouvelles valeurs (JSON)", type: "json", required: true }, { name: "sans_declencheurs", label: "Ne pas lancer les déclencheurs", type: "bool" }],
    run: async (p, ctx, api) => {
      const t = needWrite(T(api, p.table), api);
      if (p.id) { await t.updateRow(p.valeurs, +p.id, api.user, !!p.sans_declencheurs); return 1; }
      if (p.ids) {
        const ids = asList(p.ids).map((x) => (x && typeof x === "object" ? x.id : x)).map(Number).filter(Boolean);
        for (const id of ids) await t.updateRow(p.valeurs, id, api.user, !!p.sans_declencheurs);
        return ids.length;
      }
      if (!p.filtre || !Object.keys(p.filtre).length) throw new Error("filtre vide : je refuse de modifier toute la table");
      const rows = await t.getRows(p.filtre, { fields: ["id"] });
      for (const r of rows) await t.updateRow(p.valeurs, r.id, api.user, !!p.sans_declencheurs);
      return rows.length;
    },
  },
  {
    name: "dzf_table_supprimer", label: "Table : supprimer", category: "Données", icon: "fas fa-trash", output: "supprimes",
    description: "Supprime les lignes qui correspondent au filtre. Refuse un filtre vide.",
    params: [{ name: "table", label: "Table", type: "table", required: true }, { ...FILTRE, required: true }],
    run: async (p, ctx, api) => {
      const t = needWrite(T(api, p.table), api);
      if (!p.filtre || !Object.keys(p.filtre).length) throw new Error("filtre vide : je refuse de vider la table");
      const n = await t.countRows(p.filtre);
      await t.deleteRows(p.filtre, api.user);
      return n;
    },
  },
];
