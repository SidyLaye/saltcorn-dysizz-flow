const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class { constructor(o) { Object.assign(this, o); } }; return orig.call(this, req, ...rest); };
const assert = require("assert");
const plugin = require("../index.js");
assert.strictEqual(plugin.plugin_name, "dysizz-flow");
assert(Object.keys(plugin.actions).length >= 30);
for (const a of Object.values(plugin.actions)) { assert.strictEqual(typeof a.run, "function"); assert.strictEqual(typeof a.configFields, "function"); }
assert(plugin.routes.some((r) => r.url === "/dysizz-flow/atelier/:nom"));
console.log("plugin OK :", Object.keys(plugin.actions).length, "blocs,", plugin.routes.length, "routes");
