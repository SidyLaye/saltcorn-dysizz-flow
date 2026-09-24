/* Blockchain : Ethereum et réseaux compatibles (Polygon, Base, Arbitrum,
   Optimism, BNB, Avalanche, Gnosis…), Bitcoin, prix des cryptos.
   Les clés privées restent dans le coffre chiffré, jamais dans les tables. */
"use strict";
const evm = require("../lib/evm");

const perm = (m) => Object.assign(new Error(m), { permanent: true });
const need = async (api, name) => { const v = await api.secret(name); if (!v) throw perm(`secret ${name} introuvable (variable d'environnement ou coffre)`); return v; };

/* nœuds publics gratuits (publicnode.com) ; remplaçables par le tien (Infura, Alchemy…) */
const RESEAUX = {
  "Ethereum": { id: 1, rpc: "https://ethereum-rpc.publicnode.com", sym: "ETH", scan: "https://etherscan.io" },
  "Polygon": { id: 137, rpc: "https://polygon-bor-rpc.publicnode.com", sym: "POL", scan: "https://polygonscan.com" },
  "Base": { id: 8453, rpc: "https://base-rpc.publicnode.com", sym: "ETH", scan: "https://basescan.org" },
  "Arbitrum": { id: 42161, rpc: "https://arbitrum-one-rpc.publicnode.com", sym: "ETH", scan: "https://arbiscan.io" },
  "Optimism": { id: 10, rpc: "https://optimism-rpc.publicnode.com", sym: "ETH", scan: "https://optimistic.etherscan.io" },
  "BNB Chain": { id: 56, rpc: "https://bsc-rpc.publicnode.com", sym: "BNB", scan: "https://bscscan.com" },
  "Avalanche": { id: 43114, rpc: "https://avalanche-c-chain-rpc.publicnode.com", sym: "AVAX", scan: "https://snowtrace.io" },
  "Gnosis": { id: 100, rpc: "https://gnosis-rpc.publicnode.com", sym: "xDAI", scan: "https://gnosisscan.io" },
  "Sepolia (test)": { id: 11155111, rpc: "https://ethereum-sepolia-rpc.publicnode.com", sym: "ETH", scan: "https://sepolia.etherscan.io" },
  "Polygon Amoy (test)": { id: 80002, rpc: "https://polygon-amoy-bor-rpc.publicnode.com", sym: "POL", scan: "https://amoy.polygonscan.com" },
};
const NET = [
  { name: "reseau", label: "Réseau", type: "select", options: [...Object.keys(RESEAUX), "autre (adresse RPC)"], default: "Ethereum" },
  { name: "rpc", label: "Adresse RPC (facultatif)", help: "Ton propre nœud ou Infura/Alchemy. Peut être un nom de secret si elle contient une clé." },
];
const net = async (p, api) => {
  const n = RESEAUX[p.reseau] || {};
  let url = p.rpc || n.rpc;
  if (url && !/^https?:\/\//.test(url)) url = await need(api, url);
  if (!url) throw perm("indique l'adresse RPC du réseau");
  return { ...n, rpc: url };
};
let rid = 1;
const rpc = async (n, method, params = []) => {
  const r = await fetch(n.rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: rid++, method, params }) });
  if (!r.ok) throw new Error(`nœud ${method} : HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`nœud ${method} : ${j.error.message || JSON.stringify(j.error)}`);
  return j.result;
};
const num = (h) => (h === null || h === undefined ? null : Number(BigInt(h)));
const ERC20 = { symbol: "symbol() returns (string)", decimals: "decimals() returns (uint8)", balanceOf: "balanceOf(address) returns (uint256)", name: "name() returns (string)" };
const read = async (n, to, sig, args = []) => { const s = evm.parseSig(sig); const out = await rpc(n, "eth_call", [{ to: evm.checksum(to), data: evm.callData(sig, args) }, "latest"]); return evm.decode(s.outputs, out); };
const token = async (n, addr) => { const [[symbol], [decimals]] = await Promise.all([read(n, addr, ERC20.symbol).catch(() => ["?"]), read(n, addr, ERC20.decimals).catch(() => ["18"])]); return { symbol, decimals: +decimals }; };
const args = (v) => { if (v === undefined || v === null || v === "") return []; if (Array.isArray(v)) return v; try { const j = JSON.parse(v); return Array.isArray(j) ? j : [j]; } catch (e) { return String(v).split(",").map((x) => x.trim()); } };

module.exports = [
  {
    name: "dzf_evm_solde", label: "Blockchain : solde d'une adresse", category: "Blockchain", icon: "fab fa-ethereum", output: "solde", timeout: 30,
    description: "Solde d'un portefeuille en monnaie du réseau (ETH, POL, BNB…) et, si tu les indiques, en jetons ERC-20 (USDC, EURC…).",
    params: [...NET, { name: "adresse", label: "Adresse du portefeuille", required: true, help: "0x…" }, { name: "jetons", label: "Contrats de jetons ERC-20 (facultatif)", type: "json", help: 'Ex. ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"] (USDC sur Ethereum)' }],
    run: async (p, ctx, api) => {
      const n = await net(p, api);
      const a = evm.checksum(p.adresse);
      const wei = await rpc(n, "eth_getBalance", [a, "latest"]);
      const out = { adresse: a, reseau: p.reseau, symbole: n.sym || "", solde: evm.fromUnits(BigInt(wei)), wei: BigInt(wei).toString(), jetons: [], lien: n.scan ? `${n.scan}/address/${a}` : "" };
      for (const t of args(p.jetons)) {
        const [{ symbol, decimals }, [bal]] = await Promise.all([token(n, t), read(n, t, ERC20.balanceOf, [a])]);
        out.jetons.push({ contrat: evm.checksum(t), symbole: symbol, solde: evm.fromUnits(bal, decimals), brut: bal });
      }
      return out;
    },
  },
  {
    name: "dzf_evm_lire_contrat", label: "Blockchain : lire un contrat", category: "Blockchain", icon: "fas fa-file-contract", output: "contrat",
    description: "Appelle une fonction en lecture d'un contrat intelligent (gratuit, rien n'est écrit). Tu écris simplement la signature, ex. « balanceOf(address) returns (uint256) ».",
    params: [...NET, { name: "contrat", label: "Adresse du contrat", required: true }, { name: "fonction", label: "Fonction", required: true, default: "totalSupply() returns (uint256)", help: "Ex. ownerOf(uint256 id) returns (address owner)" },
      { name: "arguments", label: "Arguments", type: "json", help: 'Liste JSON ou séparés par des virgules. Ex. ["0x…", 5]' }, { name: "bloc", label: "Au bloc (facultatif)", help: "Numéro, vide = le plus récent" }],
    run: async (p, ctx, api) => {
      const n = await net(p, api);
      const s = evm.parseSig(p.fonction);
      if (!s.outputs.length) throw perm("ajoute ce que la fonction renvoie : « … returns (uint256) »");
      const res = evm.decode(s.outputs, await rpc(n, "eth_call", [{ to: evm.checksum(p.contrat), data: evm.callData(p.fonction, args(p.arguments)) }, p.bloc ? evm.toHexQ(p.bloc) : "latest"]));
      if (res.length === 1) return res[0];
      return Object.fromEntries(res.map((v, i) => [s.outNames[i], v]));
    },
  },
  {
    name: "dzf_evm_evenements", label: "Blockchain : événements d'un contrat", category: "Blockchain", icon: "fas fa-stream", output: "evenements", timeout: 60,
    description: "Récupère les événements récents d'un contrat (transferts, ventes, votes…) et les décode. Idéal avec un déclencheur planifié pour suivre un portefeuille ou un jeton.",
    params: [...NET, { name: "contrat", label: "Adresse du contrat", required: true }, { name: "evenement", label: "Événement", required: true, default: "Transfer(address indexed from, address indexed to, uint256 value)" },
      { name: "derniers_blocs", label: "Sur les N derniers blocs", type: "int", default: 1000 }, { name: "depuis_bloc", label: "…ou depuis le bloc", help: "Ex. {{dernier_bloc_vu}} pour ne rien rater entre deux passages" },
      { name: "filtre_1", label: "Filtre 1er champ indexé (facultatif)", help: "Ex. l'adresse « from »" }, { name: "filtre_2", label: "Filtre 2e champ indexé (facultatif)", help: "Ex. l'adresse « to »" }],
    run: async (p, ctx, api) => {
      const n = await net(p, api);
      const s = evm.parseSig(p.evenement);
      const last = num(await rpc(n, "eth_blockNumber"));
      const from = p.depuis_bloc ? +p.depuis_bloc : Math.max(0, last - Math.min(50000, +p.derniers_blocs || 1000));
      const idxTypes = s.inputs.filter((_, i) => s.indexed[i]);
      const topic = (v, i) => (v ? "0x" + evm.encode([idxTypes[i] || "address"], [v]).toString("hex") : null);
      const logs = await rpc(n, "eth_getLogs", [{ address: evm.checksum(p.contrat), fromBlock: evm.toHexQ(from), toBlock: evm.toHexQ(last), topics: ["0x" + evm.keccak(s.canon).toString("hex"), topic(p.filtre_1, 0), topic(p.filtre_2, 1)] }]);
      return { dernier_bloc: last, depuis: from, nombre: logs.length, liste: logs.map((l) => ({ ...evm.decodeLog(p.evenement, l), bloc: num(l.blockNumber), tx: l.transactionHash, lien: n.scan ? `${n.scan}/tx/${l.transactionHash}` : "" })) };
    },
  },
  {
    name: "dzf_evm_transaction", label: "Blockchain : état d'une transaction", category: "Blockchain", icon: "fas fa-receipt", output: "transaction", timeout: 30,
    description: "Dit si une transaction est en attente, réussie ou échouée, avec son nombre de confirmations, les frais payés et le montant.",
    params: [...NET, { name: "hash", label: "Hash de la transaction", required: true, help: "0x… (64 caractères)" }],
    run: async (p, ctx, api) => {
      const n = await net(p, api);
      const [tx, rc, last] = await Promise.all([rpc(n, "eth_getTransactionByHash", [p.hash]), rpc(n, "eth_getTransactionReceipt", [p.hash]), rpc(n, "eth_blockNumber")]);
      if (!tx) return { etat: "introuvable", hash: p.hash };
      const etat = !rc ? "en attente" : rc.status === "0x1" ? "réussie" : "échouée";
      return { etat, hash: p.hash, de: tx.from, vers: tx.to, montant: evm.fromUnits(BigInt(tx.value)), symbole: n.sym || "", bloc: num(tx.blockNumber), confirmations: rc ? num(last) - num(rc.blockNumber) + 1 : 0,
        frais: rc ? evm.fromUnits(BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice || tx.gasPrice || 0)) : null, lien: n.scan ? `${n.scan}/tx/${p.hash}` : "" };
    },
  },
  {
    name: "dzf_evm_envoyer", label: "Blockchain : envoyer (crypto, jeton, contrat)", category: "Blockchain", icon: "fas fa-paper-plane", output: "envoi", timeout: 120,
    description: "Envoie de la crypto, un jeton ERC-20, ou appelle une fonction d'un contrat qui écrit (mint, vote…). Signé sur le serveur avec une clé du coffre. Essaie d'abord sur un réseau de test !",
    params: [...NET, { name: "cle", label: "Secret de la clé privée", required: true, default: "PORTEFEUILLE_CLE", help: "Nom d'un secret du coffre (0x…). Utilise un portefeuille dédié avec peu de fonds." },
      { name: "type_envoi", label: "Quoi", type: "select", options: ["monnaie du réseau", "jeton ERC-20", "appel de contrat"], default: "monnaie du réseau" },
      { name: "vers", label: "Destinataire (ou contrat appelé)", required: true },
      { name: "montant", label: "Montant", help: "Ex. 0.01 (en ETH, POL… ou en jetons)" },
      { name: "jeton", label: "Contrat du jeton", showIf: { type_envoi: "jeton ERC-20" } },
      { name: "fonction", label: "Fonction", showIf: { type_envoi: "appel de contrat" }, help: "Ex. mint(address to, uint256 amount)" }, { name: "arguments", label: "Arguments", type: "json", showIf: { type_envoi: "appel de contrat" } },
      { name: "plafond", label: "Montant max autorisé (sécurité)", default: "0.1", help: "Refuse d'envoyer plus que ça. En monnaie du réseau ou en jetons." },
      { name: "attendre", label: "Attendre la confirmation", type: "bool", default: true }],
    run: async (p, ctx, api) => {
      const n = await net(p, api);
      if (!n.id) n.id = num(await rpc(n, "eth_chainId"));
      const pk = (await need(api, p.cle)).trim();
      const from = evm.addrOfKey(pk);
      let to = p.vers, value = 0n, data;
      if (p.montant && p.plafond && Number(p.montant) > Number(p.plafond)) throw perm(`montant ${p.montant} au-dessus du plafond ${p.plafond}`);
      if (p.type_envoi === "jeton ERC-20") {
        const { decimals } = await token(n, p.jeton);
        data = evm.callData("transfer(address,uint256)", [p.vers, evm.toUnits(p.montant, decimals)]);
        to = p.jeton;
      } else if (p.type_envoi === "appel de contrat") { data = evm.callData(p.fonction, args(p.arguments)); if (p.montant) value = evm.toUnits(p.montant); }
      else value = evm.toUnits(p.montant || "0");
      const [nonce, block, tip] = await Promise.all([rpc(n, "eth_getTransactionCount", [from, "pending"]), rpc(n, "eth_getBlockByNumber", ["latest", false]), rpc(n, "eth_maxPriorityFeePerGas").catch(() => "0x3b9aca00")]);
      const base = BigInt(block.baseFeePerGas || "0x0");
      const txq = { from, to: evm.checksum(to), value: evm.toHexQ(value), ...(data ? { data } : {}) };
      const gas = (BigInt(await rpc(n, "eth_estimateGas", [txq])) * 12n) / 10n;
      const signed = evm.signTx1559({ chainId: n.id, nonce: BigInt(nonce), maxPriorityFeePerGas: BigInt(tip), maxFeePerGas: base * 2n + BigInt(tip), gas, to, value, data }, pk);
      const hash = await rpc(n, "eth_sendRawTransaction", [signed.raw]);
      let etat = "envoyée";
      if (p.attendre) {
        for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 2500)); const rc = await rpc(n, "eth_getTransactionReceipt", [hash]); if (rc) { etat = rc.status === "0x1" ? "réussie" : "échouée"; break; } }
      }
      return { hash, etat, de: from, vers: evm.checksum(to), lien: n.scan ? `${n.scan}/tx/${hash}` : "" };
    },
  },
  {
    name: "dzf_evm_signature", label: "Blockchain : signer / vérifier un message", category: "Blockchain", icon: "fas fa-signature", output: "signature",
    description: "Vérifie qu'un message a été signé par un portefeuille (connexion « Sign-In with Ethereum », preuve de propriété), ou signe un message avec une clé du coffre.",
    params: [{ name: "action", label: "Action", type: "select", options: ["vérifier", "signer"], default: "vérifier" }, { name: "message", label: "Message", required: true },
      { name: "signature", label: "Signature reçue", showIf: { action: "vérifier" } }, { name: "adresse", label: "Adresse attendue (facultatif)", showIf: { action: "vérifier" } }, { name: "cle", label: "Secret de la clé privée", default: "PORTEFEUILLE_CLE", showIf: { action: "signer" } }],
    run: async (p, ctx, api) => {
      if (p.action === "signer") { const pk = (await need(api, p.cle)).trim(); return { signature: evm.signMessage(p.message, pk), adresse: evm.addrOfKey(pk) }; }
      const a = evm.recoverMessage(p.message, p.signature);
      return { adresse: a, valide: p.adresse ? a.toLowerCase() === String(p.adresse).toLowerCase() : true };
    },
  },
  {
    name: "dzf_evm_portefeuille", label: "Blockchain : créer un portefeuille", category: "Blockchain", icon: "fas fa-wallet", output: "portefeuille",
    description: "Crée une nouvelle adresse Ethereum/compatible. La clé privée est rangée directement dans le coffre chiffré (jamais montrée ni stockée dans une table).",
    params: [{ name: "nom_secret", label: "Nom du secret à créer", required: true, default: "PORTEFEUILLE_{{id}}", help: "Refuse d'écraser un secret existant" }],
    run: async (p, ctx, api) => {
      const vault = require("../vault");
      const name = String(p.nom_secret).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      if (await vault.readSecret(name)) throw perm(`le secret ${name} existe déjà`);
      const w = evm.newKey();
      await vault.writeSecret(name, w.cle);
      return { adresse: w.adresse, secret: name };
    },
  },
  {
    name: "dzf_evm_rpc", label: "Blockchain : appel RPC libre", category: "Blockchain", icon: "fas fa-terminal", output: "rpc",
    description: "Pour les techniciens : n'importe quelle méthode JSON-RPC (eth_blockNumber, eth_getBlockByNumber, debug_…) sur le réseau choisi.",
    params: [...NET, { name: "methode", label: "Méthode", required: true, default: "eth_blockNumber" }, { name: "parametres", label: "Paramètres (liste JSON)", type: "json", default: "[]" }, { name: "convertir", label: "Convertir les 0x… en nombres", type: "bool", default: true }],
    run: async (p, ctx, api) => {
      const r = await rpc(await net(p, api), p.methode, args(p.parametres));
      return p.convertir && typeof r === "string" && /^0x[0-9a-f]{1,15}$/i.test(r) ? num(r) : r;
    },
  },
  {
    name: "dzf_bitcoin", label: "Blockchain : Bitcoin", category: "Blockchain", icon: "fab fa-bitcoin", output: "bitcoin", timeout: 30,
    description: "Solde et dernières transactions d'une adresse Bitcoin, état d'une transaction, ou frais conseillés — via mempool.space (ou ton instance).",
    params: [{ name: "action", label: "Action", type: "select", options: ["solde d'une adresse", "transactions d'une adresse", "état d'une transaction", "frais conseillés", "hauteur du dernier bloc"], default: "solde d'une adresse" },
      { name: "valeur", label: "Adresse ou identifiant de transaction" }, { name: "serveur", label: "Serveur", default: "https://mempool.space", help: "Testnet : https://mempool.space/testnet4" }],
    run: async (p) => {
      const base = String(p.serveur || "https://mempool.space").replace(/\/$/, "") + "/api";
      const get = async (u) => { const r = await fetch(base + u); if (!r.ok) throw new Error(`mempool : HTTP ${r.status}`); const t = await r.text(); try { return JSON.parse(t); } catch (e) { return t; } };
      const v = encodeURIComponent(String(p.valeur || "").trim());
      const btc = (s) => s / 1e8;
      if (p.action === "frais conseillés") return get("/v1/fees/recommended");
      if (p.action === "hauteur du dernier bloc") return +(await get("/blocks/tip/height"));
      if (!v) throw perm("indique l'adresse ou la transaction");
      if (p.action === "solde d'une adresse") { const a = await get(`/address/${v}`); const c = a.chain_stats, m = a.mempool_stats; return { adresse: a.address, solde: btc(c.funded_txo_sum - c.spent_txo_sum), en_attente: btc(m.funded_txo_sum - m.spent_txo_sum), transactions: c.tx_count, lien: `https://mempool.space/address/${a.address}` }; }
      if (p.action === "transactions d'une adresse") return (await get(`/address/${v}/txs`)).slice(0, 25).map((t) => ({ txid: t.txid, confirmee: t.status.confirmed, bloc: t.status.block_height, quand: t.status.block_time ? new Date(t.status.block_time * 1000).toISOString() : null, frais: btc(t.fee) }));
      const t = await get(`/tx/${v}`);
      const tip = t.status.confirmed ? +(await get("/blocks/tip/height")) : 0;
      return { txid: t.txid, etat: t.status.confirmed ? "confirmée" : "en attente", confirmations: t.status.confirmed ? tip - t.status.block_height + 1 : 0, frais: btc(t.fee), montant_sorties: btc(t.vout.reduce((s, o) => s + o.value, 0)), lien: `https://mempool.space/tx/${t.txid}` };
    },
  },
  {
    name: "dzf_crypto_prix", label: "Blockchain : cours des cryptos", category: "Blockchain", icon: "fas fa-coins", output: "cours",
    description: "Prix actuel (et variation sur 24 h) de cryptomonnaies en euros, dollars… via CoinGecko (gratuit, sans clé).",
    params: [{ name: "ids", label: "Cryptos (identifiants CoinGecko)", default: "bitcoin,ethereum,solana", help: "Séparés par des virgules. Ex. bitcoin, ethereum, usd-coin, polygon-ecosystem-token" },
      { name: "devises", label: "Devises", default: "eur,usd" }, { name: "cle", label: "Secret de la clé CoinGecko (facultatif)", default: "COINGECKO_KEY" }],
    run: async (p, ctx, api) => {
      const k = await api.secret(p.cle);
      const u = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(p.ids)}&vs_currencies=${encodeURIComponent(p.devises)}&include_24hr_change=true&include_last_updated_at=true`;
      const r = await fetch(u, { headers: k ? { "x-cg-demo-api-key": k } : {} });
      if (!r.ok) throw new Error(`CoinGecko : HTTP ${r.status}`);
      return r.json();
    },
  },
];
module.exports.RESEAUX = RESEAUX;
