"use strict";
/* lieu dit par un prospect → termes du critère « C.P. ou ville » et débuts de code postal gardés */
const assert = require("node:assert/strict");
const { zonesDe } = require("../src/lib/leads/crm/immofacile");
const idf = ["75", "77", "78", "91", "92", "93", "94", "95"];
assert.deepEqual(zonesDe("régions parisiennes"), { termes: idf, prefixes: idf });
assert.deepEqual(zonesDe("Île-de-France").prefixes, idf);
assert.deepEqual(zonesDe("dans le 91"), { termes: ["91"], prefixes: ["91"] });
assert.deepEqual(zonesDe("2B"), { termes: ["20"], prefixes: ["20"] });
assert.deepEqual(zonesDe("près de Onet-le-Château"), { termes: ["onet le chateau", "Onet-le-Château"], prefixes: null });
assert.deepEqual(zonesDe("12000"), { termes: ["12000"], prefixes: null });
assert.deepEqual(zonesDe("La Rochelle").termes, ["la rochelle", "La Rochelle"], "l'article d'un nom de ville est gardé");
console.log("zones de lieu (région, département, ville, code postal) OK");
