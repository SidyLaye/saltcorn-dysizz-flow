/* Le moteur et les blocs de transformation, sans Saltcorn. */
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { interpolate, deep, resolveParams, toAction } = require("../src/engine");
const { BLOCKS } = require("../src/blocks");
const B = (n) => BLOCKS.find((b) => b.name === n);

(async () => {
  const ctx = { a: { b: 2 }, liste: [1, 2], nom: "Sidy" };
  assert.strictEqual(interpolate("{{a.b}}", ctx), 2, "valeur brute si tout le champ");
  assert.deepStrictEqual(interpolate("{{liste}}", ctx), [1, 2]);
  assert.strictEqual(interpolate("Salut {{nom}} ({{a.b}}) {{absent}}", ctx), "Salut Sidy (2) ");
  assert.deepStrictEqual(deep({ x: "{{nom}}", y: ["{{a.b}}"] }, ctx), { x: "Sidy", y: [2] });
  const p = resolveParams({ params: [{ name: "j", type: "json" }, { name: "n", type: "int" }, { name: "m", type: "json", raw: true }] }, { j: '{"k":"{{nom}}"}', n: "5", m: '{"t":"{{item.x}}"}' }, ctx);
  assert.deepStrictEqual(p, { j: { k: "Sidy" }, n: 5, m: { t: "{{item.x}}" } }, "raw garde les {{ }}");
  assert.deepStrictEqual(resolveParams({ params: [{ name: "v", type: "json" }] }, { v: '{"p":"{{vide}}","n":"{{a.b}}","t":"x {{nom}}"}' }, { vide: null, ...ctx }).v, { p: null, n: 2, t: "x Sidy" }, "types gardés dans le JSON");
  assert.deepStrictEqual(resolveParams({ params: [{ name: "v", type: "json" }] }, { v: "{{a}}" }, ctx).v, { b: 2 }, "JSON donné par une variable");
  assert.throws(() => resolveParams({ params: [{ name: "x", required: true, label: "X" }] }, {}, {}), /X/);

  const items = [{ t: "A", p: 3, u: "x" }, { t: "B", p: 10, u: "y" }, { t: "C", p: 7, u: "x" }];
  assert.deepStrictEqual(await B("dzf_liste_transformer").run({ liste: items, modele: { titre: "{{item.t}}!", n: "{{index}}" } }, {}), [{ titre: "A!", n: 0 }, { titre: "B!", n: 1 }, { titre: "C!", n: 2 }]);
  assert.strictEqual((await B("dzf_liste_filtrer").run({ liste: items, champ: "p", operateur: ">", valeur: "5" }, {})).length, 2);
  assert.strictEqual((await B("dzf_liste_filtrer").run({ liste: items, expression: "item.t !== 'B'" }, {})).length, 2);
  assert.strictEqual((await B("dzf_liste_dedoublonner").run({ liste: items, cle: "u" }, {}, {})).length, 2);
  assert.deepStrictEqual((await B("dzf_liste_trier").run({ liste: items, champ: "p", ordre: "décroissant", limite: 2 }, {})).map((x) => x.t), ["B", "C"]);
  assert.strictEqual((await B("dzf_liste_lots").run({ liste: [1, 2, 3, 4, 5], taille: 2 }, {})).length, 3);
  assert.strictEqual(await B("dzf_texte").run({ modele: "{{n}} :\n{{lignes}}", liste: items, modele_ligne: "- {{item.t}}" }, { n: 3 }), "3 :\n- A\n- B\n- C");
  const csv = await B("dzf_csv").run({ operation: "liste → CSV", valeur: [{ a: 1, b: 'x;"y"' }], separateur: ";" }, {});
  assert.strictEqual(csv, 'a;b\n1;"x;""y"""');
  assert.deepStrictEqual(await B("dzf_csv").run({ operation: "CSV → liste", valeur: csv, separateur: ";" }, {}), [{ a: "1", b: 'x;"y"' }]);
  assert.strictEqual(await B("dzf_dates").run({ operation: "ajouter des jours", date: "2026-01-30T10:00:00Z", jours: 2, format: "jour (AAAA-MM-JJ)" }, {}), "2026-02-01");
  assert.strictEqual(await B("dzf_html_texte").run({ valeur: "<p>Bonjour <script>x</script><b>toi</b></p>", max: 0 }, {}), "Bonjour toi");
  assert.deepStrictEqual(await B("dzf_definir").run({ valeurs: { a: 1 }, fusionner: true }, {}), { __merge: { a: 1 } });

  /* l'action complète : sortie, erreur arrêtée ou continuée */
  const act = toAction({ name: "t", label: "Test", params: [{ name: "x", type: "int" }], output: "o", run: async (q) => { if (q.x < 0) throw new Error("négatif"); return q.x * 2; } });
  assert.deepStrictEqual(await act.run({ configuration: { x: "{{v}}" }, row: { v: 4 } }), { o: 8 });
  assert.deepStrictEqual(await act.run({ configuration: { x: "{{v}}", sortie: "r" }, row: { v: 1 } }), { r: 2 });
  await assert.rejects(act.run({ configuration: { x: -1 }, row: {} }), /Test\] négatif/);
  assert.deepStrictEqual(await act.run({ configuration: { x: -1, si_erreur: "continuer" }, row: {} }), { o: null, o_erreur: "négatif" });

  /* tous les blocs : bien formés */
  const names = new Set();
  for (const b of BLOCKS) {
    for (const k of ["name", "label", "category", "icon", "description", "run"]) assert(b[k], `${b.name} : ${k}`);
    assert(/^dzf_[a-z_]+$/.test(b.name), b.name);
    assert(!names.has(b.name), `${b.name} en double`); names.add(b.name);
    for (const p of b.params || []) assert(/^[a-z_]+$/.test(p.name), `${b.name}.${p.name}`);
  }
  console.log(`moteur OK, ${BLOCKS.length} blocs`);
})().catch((e) => { console.error(e); process.exit(1); });
