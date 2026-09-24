# Créer un bloc

## Dans l'atelier (sans toucher au dépôt)

`/dysizz-flow/atelier` → Nouveau bloc :

1. **Réglages** : chaque ligne devient un champ du formulaire (texte, nombre, oui/non, liste de choix, table, JSON, code, mot de passe).
2. **Code** : il tourne dans le bac à sable de Saltcorn.
   - `params` contient les réglages déjà remplis (les `{{variables}}` sont remplacées).
   - `row` contient le contexte du workflow.
   - Tu as `Table`, `fetch`, `User`, `Notification`, `File`, `sleep`, et `Actions` pour appeler n'importe quel bloc (`await Actions.dzf_http({...})`).
   - Ce que le code renvoie devient la sortie.
3. **Essayer** : lance le bloc avec des réglages et un contexte de test.

Le bloc devient l'action `dzf_u_<nom>`, disponible tout de suite sur tous les serveurs. Exporte / importe tes blocs en JSON pour les passer d'un tenant à l'autre.

## Dans le dépôt (bloc intégré)

Ajoute un objet dans `src/blocks/<catégorie>.js` :

```js
{
  name: "dzf_slack", label: "Slack : envoyer un message", category: "Messagerie", icon: "fab fa-slack", output: "slack",
  description: "Envoie un message dans un canal Slack (webhook entrant).",
  params: [
    { name: "variable_webhook", label: "Variable d'env. du webhook", default: "SLACK_WEBHOOK_URL" },
    { name: "texte", label: "Texte", type: "text", required: true },
  ],
  run: async (p, ctx, api) => {
    const url = api.env(p.variable_webhook);
    if (!url) throw new Error("webhook manquant");
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: p.texte }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return true;
  },
},
```

Règles :

- `run(p, ctx, api)` : `p` = réglages résolus, `ctx` = contexte, `api` = `{ Table, user, req, env(nom), log(), out }`.
- Une liste en entrée : traiter par lots et avec un parallélisme borné (`pool` du moteur).
- Jamais de secret dans un réglage : une variable d'environnement.
- `raw: true` sur un réglage qui contient des `{{item.x}}` à remplacer par le bloc lui-même.
- Renvoyer `{ __merge: {...} }` pour écrire plusieurs variables dans le contexte.
- Un test dans `tests/engine.test.cjs` si le bloc transforme des données.
