/* Les blocs 2.0 (sécurité, texte, listes, calendrier…), sans Saltcorn ni réseau. */
const assert = require("assert");
const crypto = require("crypto");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { BLOCKS } = require("../src/blocks");
const B = (n) => BLOCKS.find((b) => b.name === n);
const SECRETS = { K: "cle-de-test-assez-longue", J: "secret-jwt", W: "whsec" };
const api = { secret: async (n) => SECRETS[n], user: { id: 1, role_id: 1 }, log: () => {} };
const run = (n, p, ctx = {}) => B(n).run(p, ctx, api);

(async () => {
  /* sécurité */
  assert.strictEqual(await run("dzf_hacher", { texte: "abc", algo: "sha256", format: "hex" }), crypto.createHash("sha256").update("abc").digest("hex"));
  assert.strictEqual(await run("dzf_hacher", { texte: "abc", algo: "sha256", format: "hex", secret_hmac: "K" }), crypto.createHmac("sha256", SECRETS.K).update("abc").digest("hex"));
  const c = await run("dzf_chiffrer", { sens: "chiffrer", valeur: "top secret", secret_cle: "K" });
  assert.notStrictEqual(c, "top secret");
  assert.strictEqual(await run("dzf_chiffrer", { sens: "déchiffrer", valeur: c, secret_cle: "K" }), "top secret");
  const jwt = await run("dzf_jwt", { action: "créer", secret: "J", donnees: { sub: 7 }, duree: 60 });
  assert.strictEqual(jwt.split(".").length, 3);
  const v = await run("dzf_jwt", { action: "vérifier", secret: "J", jeton: jwt });
  assert(v.valide && v.donnees.sub === 7, "jwt valide");
  const bad = await run("dzf_jwt", { action: "vérifier", secret: "J", jeton: jwt.slice(0, -2) + "xx" }).catch((e) => ({ valide: false, e }));
  assert.strictEqual(bad.valide, false, "jwt falsifié refusé");
  assert.match(await run("dzf_generer", { type: "uuid" }), /^[0-9a-f-]{36}$/);
  assert.strictEqual(String(await run("dzf_generer", { type: "code chiffres", longueur: 6 })).length, 6);
  const m = await run("dzf_masquer", { texte: "écris à a.b@c.fr ou 06 12 34 56 78", quoi: "email,téléphone", remplacement: "[x]" });
  assert(!/a\.b@c\.fr/.test(m) && !/06 12/.test(m), "masqué : " + m);
  const s = await run("dzf_detecter_secrets", { texte: "key=AKIAABCDEFGHIJKLMNOP et ghp_" + "a".repeat(36) });
  assert(Array.isArray(s) ? s.length >= 2 : s.nombre >= 2, "secrets : " + JSON.stringify(s));

  /* webhook signé */
  const corps = '{"a":1}';
  const sig = "sha256=" + crypto.createHmac("sha256", SECRETS.W).update(corps).digest("hex");
  const w = await run("dzf_webhook_verifier", { corps, signature: sig, secret: "W", algo: "sha256", format: "hex (avec ou sans « sha256= »)" });
  assert(w === true || w.valide === true, "webhook ok");
  const w2 = await run("dzf_webhook_verifier", { corps: corps + " ", signature: sig, secret: "W", algo: "sha256", format: "hex (avec ou sans « sha256= »)" }).catch(() => false);
  assert(w2 === false || w2.valide === false, "webhook modifié refusé");

  /* listes */
  const items = [{ c: "a", m: 2 }, { c: "b", m: 5 }, { c: "a", m: 3 }];
  const g = await run("dzf_liste_grouper", { liste: items, par: "c", champ: "m", tri: "nombre" });
  const ga = g.find((x) => x.groupe === "a");
  assert(ga && ga.nombre === 2 && ga.somme === 5, "grouper : " + JSON.stringify(g));
  const cmp = await run("dzf_liste_comparer", { avant: [{ id: 1, p: 1 }, { id: 2, p: 1 }], apres: [{ id: 1, p: 2 }, { id: 3, p: 1 }], cle: "id" });
  assert.strictEqual(cmp.ajoutes.length, 1); assert.strictEqual(cmp.retires.length, 1); assert.strictEqual(cmp.modifies.length, 1);
  const j = await run("dzf_liste_joindre", { gauche: [{ id: 1 }, { id: 2 }], droite: [{ ref: 1, n: "x" }], cle_gauche: "id", cle_droite: "ref", type: "seulement les correspondances (inner)" });
  assert.strictEqual(j.length, 1);
  assert.deepStrictEqual(await run("dzf_liste_aplatir", { liste: [{ t: ["a", "b"] }, { t: ["c", ""] }], champ: "t", sans_vides: true }), ["a", "b", "c"]);
  assert.deepStrictEqual(await run("dzf_objet_champs", { valeur: { a: 1, b: 2, c: 3 }, retirer: "c", renommer: { a: "x" } }), { x: 1, b: 2 });

  /* texte et calcul */
  assert.deepStrictEqual(await run("dzf_regex", { texte: "cmd 123 et 456", motif: "\\d+", action: "tous les résultats", options: "" }).then((r) => r.map((x) => (typeof x === "string" ? x : x[0] || x.valeur))), ["123", "456"]);
  assert.strictEqual(await run("dzf_regex", { texte: "a-b", motif: "-", action: "remplacer", remplacement: "+", options: "g" }), "a+b");
  assert.strictEqual(await run("dzf_texte_outils", { valeur: "Été à Dakar !", operation: "slug" }), "ete-a-dakar");
  assert.strictEqual(await run("dzf_calcul", { formule: "(2 + 3) * 4 / 2", decimales: 2, format: "nombre" }), 10);
  await assert.rejects(run("dzf_calcul", { formule: "process.exit()", format: "nombre" }), "calcul refuse le code");
  const x = await run("dzf_xml", { valeur: "<r><i a=\"1\">x</i><i>y</i></r>" });
  assert(JSON.stringify(x).includes("x") && JSON.stringify(x).includes("y"), "xml : " + JSON.stringify(x));

  /* aiguiller */
  const a = await run("dzf_aiguiller", { valeur: "haute", cas: { haute: "alerte" }, defaut: "suite" });
  assert(a === "alerte" || a.chemin === "alerte", "aiguiller");

  /* calendrier */
  const ics = await run("dzf_ics_creer", { titre: "RDV, test", debut: "2026-10-01T09:00:00Z", fin: "2026-10-01T10:00:00Z" });
  const icsTxt = typeof ics === "string" ? ics : ics.ics || ics.contenu;
  assert(/BEGIN:VEVENT/.test(icsTxt) && /DTSTART:20261001T090000Z/.test(icsTxt) && /RDV\\, test/.test(icsTxt), "ics : " + icsTxt);

  /* similarité */
  const sim = await run("dzf_similarite", { vecteur: [1, 0], liste: [{ n: "a", vecteur: [1, 0] }, { n: "b", vecteur: [0, 1] }], champ_vecteur: "vecteur", n: 1, seuil: 0 });
  assert.strictEqual(sim[0].n, "a");

  console.log("blocs 2.0 ok");
})().catch((e) => { console.error(e); process.exit(1); });
