/* Construit index.js (un seul fichier, dépendances incluses) depuis src/ et client/. */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = (...p) => path.join(root, ...p);
const pkg = JSON.parse(fs.readFileSync(r("package.json"), "utf8"));

/* fichiers du navigateur, embarqués dans le plugin */
const assets = {};
for (const f of ["dzf.css", "dzf.js", "editeur.css", "editeur.js", "hook.js"]) {
  let src = fs.readFileSync(r("client", f), "utf8");
  if (f.endsWith(".css")) src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "\n").replace(/\n+/g, "\n").trim();
  assets[f] = { src };
}
fs.mkdirSync(r("src", "generated"), { recursive: true });
fs.writeFileSync(r("src", "generated", "assets.js"), `/* généré par tools/build.mjs */\nmodule.exports = { ASSETS: ${JSON.stringify(assets)} };\n`);

await build({
  entryPoints: [r("src", "index.js")],
  outfile: r("index.js"),
  bundle: true, platform: "node", target: "node18", format: "cjs",
  external: ["@saltcorn/*", "pg"],
  nodePaths: [r("tools", "node_modules")],
  define: { __DZF_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: `/* dysizz-flow ${pkg.version} — FICHIER GÉNÉRÉ par tools/build.mjs depuis src/. Ne pas modifier à la main. */` },
  legalComments: "none", logLevel: "warning",
});
console.log("index.js", Math.round(fs.statSync(r("index.js")).size / 1024), "Ko");
