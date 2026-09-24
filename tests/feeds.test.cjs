/* Lecture des flux : RSS, Atom/YouTube, nettoyage du HTML, liens refusés. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
Module._initPaths && (process.env.NODE_PATH = path.join(__dirname, "..", "tools", "node_modules"), Module._initPaths());
const { parseFeed } = require("../src/lib/feeds");
const fx = (f) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");

const rss = parseFeed(fx("rss.xml"));
assert.strictEqual(rss.length, 2, "les éléments sans lien ou avec un lien javascript: sont ignorés");
assert.strictEqual(rss[0].titre, "Alerte critique & correctif");
assert(!/[<>]/.test(rss[0].resume), "aucune balise dans le résumé");
assert(!/alert/.test(rss[0].resume), "le script est retiré");
assert.strictEqual(rss[0].image, "https://exemple.fr/i.jpg");
assert.strictEqual(rss[0].auteur, "CERT");
assert(rss[0].date instanceof Date && !isNaN(rss[0].date));
assert.strictEqual(rss[1].url, "https://exemple.fr/a2");
assert.strictEqual(rss[1].image, "https://exemple.fr/m.jpg");

const yt = parseFeed(fx("youtube.xml"));
assert.strictEqual(yt.length, 2);
assert.strictEqual(yt[0].video_id, "dQw4w9WgXcQ");
assert.strictEqual(yt[0].image, "https://i1.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
assert.strictEqual(yt[0].resume, "Description ici");
assert.strictEqual(yt[1].video_id, "", "un identifiant de vidéo invalide est refusé");

assert.throws(() => parseFeed("<html><body>pas un flux</body></html>"), /pas un flux/);
console.log("feeds OK");
