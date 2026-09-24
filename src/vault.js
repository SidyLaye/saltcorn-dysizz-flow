/* Coffre de secrets : les valeurs sont chiffrées (AES-256-GCM) dans la table
   dzf_secrets. La clé vient de la variable d'environnement DZF_CLE_COFFRE
   (ou, à défaut, est dérivée de SALTCORN_SESSION_SECRET). Une sauvegarde de
   la base ne contient donc jamais un secret lisible.
   Priorité de lecture partout : variable d'environnement > coffre. */
"use strict";
const crypto = require("crypto");
const { ensureTables } = require("./store");

const key = () => {
  const raw = process.env.DZF_CLE_COFFRE || process.env.SALTCORN_SESSION_SECRET;
  if (!raw) throw new Error("clé du coffre absente : définis DZF_CLE_COFFRE sur le serveur");
  return crypto.createHash("sha256").update(`dysizz-flow:${raw}`).digest();
};
const encrypt = (plain) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
};
const decrypt = (blob) => {
  const [v, iv, tag, data] = String(blob || "").split(":");
  if (v !== "v1") throw new Error("secret illisible");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
};
const readSecret = async (nom) => {
  const { secrets } = await ensureTables();
  const r = await secrets.getRow({ nom });
  return r ? decrypt(r.valeur) : undefined;
};
const writeSecret = async (nom, valeur, note) => {
  const { secrets } = await ensureTables();
  const row = { nom, valeur: encrypt(valeur), note: note || "", maj_le: new Date() };
  const ex = await secrets.getRow({ nom });
  if (ex) await secrets.updateRow(row, ex.id); else await secrets.insertRow(row);
};
module.exports = { encrypt, decrypt, readSecret, writeSecret };
