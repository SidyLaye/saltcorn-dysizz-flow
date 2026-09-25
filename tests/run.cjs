/* node tests/run.cjs — chaque fichier dans son propre processus (les simulations de fetch ne se mélangent pas) */
const { execFileSync } = require("child_process");
const path = require("path");
for (const t of ["engine.test.cjs", "redis.test.cjs", "templates.test.cjs", "feeds.test.cjs", "blocs2.test.cjs", "emplois.test.cjs", "blocs3.test.cjs", "leads.test.cjs", "load-plugin.cjs"]) {
  try { process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, t)], { env: { ...process.env, NODE_PATH: path.join(__dirname, "..", "tools", "node_modules") }, encoding: "utf8" })); } catch (e) { process.stdout.write(e.stdout || ""); process.stderr.write(e.stderr || ""); console.error(`ÉCHEC : ${t}`); process.exit(1); }
}
