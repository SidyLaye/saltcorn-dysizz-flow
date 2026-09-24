/* =====================================================================
   dysizz-flow — éditeur visuel de workflows (toile façon n8n).
   Aucune dépendance. Tout se passe dans le navigateur ; le serveur n'est
   appelé que pour lire les réglages d'un bloc, enregistrer et essayer.
   ===================================================================== */
(function () {
  "use strict";
  var root = document.getElementById("dzfe");
  var dataEl = document.getElementById("dzfe-data");
  if (!root || !dataEl) return;
  var B = JSON.parse(dataEl.textContent);
  var NW = 232, NH = 66, TRIG = "__trigger";

  /* ---------------- état ---------------- */
  var S = {
    wf: B.wf, steps: B.wf.steps.map(clone), layout: clone(B.wf.layout || {}),
    sel: null, zoom: 1, px: 40, py: 30, dirty: false, fields: {}, run: null, tab: "form",
    undo: [], redo: [],
  };
  var BY = {}; B.palette.blocks.forEach(function (b) { BY[b.name] = b; });

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(sel, el) { return (el || root).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }
  function stepBy(name) { for (var i = 0; i < S.steps.length; i++) if (S.steps[i].name === name) return S.steps[i]; return null; }
  function blockOf(s) { return BY[s.action_name] || { label: s.action_name, icon: "fas fa-question", category: "?" }; }
  function snapshot() { return JSON.stringify({ steps: S.steps, layout: S.layout, wf: { name: S.wf.name, description: S.wf.description, when_trigger: S.wf.when_trigger, table: S.wf.table } }); }
  function push() { S.undo.push(snapshot()); if (S.undo.length > 60) S.undo.shift(); S.redo = []; }
  function restore(snap) { var o = JSON.parse(snap); S.steps = o.steps; S.layout = o.layout; Object.assign(S.wf, o.wf); if (S.sel && S.sel !== TRIG && !stepBy(S.sel)) S.sel = null; changed(true); }
  function changed(full) { S.dirty = true; drawAll(); if (full) panel(); status(); }
  function status() { var el = $(".dzfe-status"); if (el) { el.textContent = S.dirty ? "Modifications non enregistrées" : "Tout est enregistré"; el.className = "dzfe-status" + (S.dirty ? " dirty" : ""); } }

  /* ---------------- routage : ce que devient next_step ---------------- */
  var COND = /^\s*\(?\s*([\s\S]+?)\s*\)?\s*\?\s*"([^"]*)"\s*:\s*"([^"]*)"\s*$/;
  function routeOf(s) {
    var n = (s.next_step || "").trim();
    if (!n) return { mode: "end" };
    if (stepBy(n) || /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return { mode: "simple", to: n };
    var m = COND.exec(n);
    if (m) return { mode: "cond", expr: m[1], yes: m[2], no: m[3] };
    var t = []; n.replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, function (_, x) { if (stepBy(x)) t.push(x); });
    return { mode: "expr", expr: n, targets: t };
  }
  function setRoute(s, r) {
    if (r.mode === "end") s.next_step = "";
    else if (r.mode === "simple") s.next_step = r.to || "";
    else if (r.mode === "cond") s.next_step = (r.expr || "true") + ' ? "' + (r.yes || "") + '" : "' + (r.no || "") + '"';
    else s.next_step = r.expr || "";
  }
  function edges() {
    var out = [];
    var first = S.steps.filter(function (s) { return s.initial_step; })[0];
    if (first) out.push({ from: TRIG, port: "out", to: first.name });
    S.steps.forEach(function (s) {
      var r = routeOf(s);
      if (r.mode === "simple" && stepBy(r.to)) out.push({ from: s.name, port: "out", to: r.to });
      if (r.mode === "cond") { if (stepBy(r.yes)) out.push({ from: s.name, port: "yes", to: r.yes, kind: "oui" }); if (stepBy(r.no)) out.push({ from: s.name, port: "no", to: r.no, kind: "non" }); }
      if (r.mode === "expr") r.targets.forEach(function (t) { out.push({ from: s.name, port: "out", to: t, label: "?", dashed: true }); });
      var c = s.configuration || {};
      if (s.action_name === "ForLoop" && stepBy(c.loop_body_initial_step)) out.push({ from: s.name, port: "loop", to: c.loop_body_initial_step, label: "pour chaque", dashed: true });
      if (s.action_name === "SetErrorHandler" && stepBy(c.error_handling_step)) out.push({ from: s.name, port: "loop", to: c.error_handling_step, label: "si erreur", dashed: true });
    });
    return out;
  }
  function renameRefs(oldN, newN) {
    S.steps.forEach(function (s) {
      var r = routeOf(s);
      if (r.mode === "simple" && r.to === oldN) r.to = newN;
      if (r.mode === "cond") { if (r.yes === oldN) r.yes = newN; if (r.no === oldN) r.no = newN; }
      if (r.mode === "expr") r.expr = r.expr.split('"' + oldN + '"').join('"' + newN + '"');
      setRoute(s, r);
      var c = s.configuration || {};
      if (c.loop_body_initial_step === oldN) c.loop_body_initial_step = newN;
      if (c.error_handling_step === oldN) c.error_handling_step = newN;
    });
    if (S.layout[oldN]) { S.layout[newN] = S.layout[oldN]; delete S.layout[oldN]; }
  }

  /* ---------------- disposition automatique ---------------- */
  function autoLayout(force) {
    var need = force || S.steps.some(function (s) { return !S.layout[s.name]; }) || !S.layout[TRIG];
    if (!need) return;
    var level = {}, order = [], q = [];
    var first = S.steps.filter(function (s) { return s.initial_step; })[0];
    if (first) { level[first.name] = 1; q.push(first.name); }
    var es = edges();
    while (q.length) {
      var n = q.shift(); order.push(n);
      es.filter(function (e) { return e.from === n; }).forEach(function (e) { if (level[e.to] === undefined) { level[e.to] = level[n] + 1; q.push(e.to); } });
    }
    var maxL = Math.max.apply(null, [1].concat(Object.keys(level).map(function (k) { return level[k]; })));
    S.steps.forEach(function (s) { if (level[s.name] === undefined) { level[s.name] = ++maxL; } });
    var rows = {};
    S.steps.forEach(function (s) { var l = level[s.name]; (rows[l] = rows[l] || []).push(s.name); });
    if (force || !S.layout[TRIG]) S.layout[TRIG] = { x: 0, y: 0 };
    Object.keys(rows).forEach(function (l) {
      var r = rows[l];
      r.forEach(function (n, i) { if (force || !S.layout[n]) S.layout[n] = { x: (i - (r.length - 1) / 2) * (NW + 60), y: l * (NH + 56) }; });
    });
  }

  /* ---------------- structure de la page ---------------- */
  root.innerHTML =
    '<div class="dzfe-top">' +
    '<a class="dzfe-back" href="/dysizz-flow/workflows" title="Tous les workflows"><i class="fas fa-arrow-left"></i></a>' +
    '<input class="dzfe-name" placeholder="Nom du workflow (ex. releve_mails)" value="' + esc(S.wf.name) + '">' +
    '<span class="dzfe-status"></span>' +
    '<span class="dzfe-sp"></span>' +
    '<button class="dzfe-btn" data-a="undo" title="Annuler (Ctrl Z)"><i class="fas fa-undo"></i></button>' +
    '<button class="dzfe-btn" data-a="redo" title="Rétablir (Ctrl Y)"><i class="fas fa-redo"></i></button>' +
    '<button class="dzfe-btn" data-a="tidy" title="Ranger les blocs"><i class="fas fa-magic"></i><span>Ranger</span></button>' +
    '<button class="dzfe-btn" data-a="code" title="Tout le workflow en JSON"><i class="fas fa-code"></i><span>Code</span></button>' +
    '<button class="dzfe-btn" data-a="run" title="Lancer un essai"><i class="fas fa-play"></i><span>Essayer</span></button>' +
    '<button class="dzfe-btn primary" data-a="save" title="Enregistrer (Ctrl S)"><i class="fas fa-save"></i><span>Enregistrer</span></button>' +
    "</div>" +
    '<div class="dzfe-body">' +
    '<aside class="dzfe-pal"><div class="dzfe-pal-head"><input class="dzfe-pal-q" placeholder="Chercher un bloc (mail, table, IA…)"><button class="dzfe-btn dzfe-only-m" data-a="pal"><i class="fas fa-times"></i></button></div><div class="dzfe-pal-list"></div></aside>' +
    '<section class="dzfe-canvas" tabindex="0"><div class="dzfe-world"><svg class="dzfe-svg"></svg><div class="dzfe-nodes"></div></div>' +
    '<div class="dzfe-zoom"><button data-a="zin" title="Zoomer">+</button><button data-a="zout" title="Dézoomer">−</button><button data-a="fit" title="Tout voir"><i class="fas fa-expand"></i></button></div>' +
    '<button class="dzfe-fab dzfe-only-m" data-a="pal"><i class="fas fa-plus"></i></button>' +
    '<div class="dzfe-hint"></div></section>' +
    '<aside class="dzfe-panel"></aside>' +
    "</div>" +
    '<div class="dzfe-run"></div><div class="dzfe-modal"></div>';

  /* ---------------- palette ---------------- */
  function drawPalette() {
    var q = ($(".dzfe-pal-q").value || "").toLowerCase().trim();
    var html = "";
    B.palette.categories.forEach(function (c) {
      var bs = B.palette.blocks.filter(function (b) { return (b.category || "Actions Saltcorn et modules") === c && (!q || (b.label + " " + b.description + " " + b.name).toLowerCase().indexOf(q) >= 0); });
      if (!bs.length) return;
      html += '<details class="dzfe-cat"' + (q || c === "Données" || c === "Transformer" ? " open" : "") + "><summary>" + esc(c) + " <small>" + bs.length + "</small></summary>" +
        bs.map(function (b) {
          return '<div class="dzfe-pb" draggable="true" data-b="' + esc(b.name) + '" title="' + esc(b.description) + '"><i class="' + esc(b.icon || "fas fa-cube") + '"></i><span><b>' + esc(b.label) + "</b><small>" + esc(b.description || b.name) + "</small></span></div>";
        }).join("") + "</details>";
    });
    $(".dzfe-pal-list").innerHTML = html || '<p class="dzfe-mute">Aucun bloc ne correspond.</p>';
  }
  $(".dzfe-pal-q").addEventListener("input", drawPalette);
  $(".dzfe-pal-list").addEventListener("click", function (e) { var p = e.target.closest(".dzfe-pb"); if (p) { addStep(p.dataset.b); root.classList.remove("pal-open"); } });
  $(".dzfe-pal-list").addEventListener("dragstart", function (e) { var p = e.target.closest(".dzfe-pb"); if (p) e.dataTransfer.setData("text/dzf", p.dataset.b); });

  /* ---------------- ajout / suppression d'étapes ---------------- */
  function uniqueName(base) {
    base = String(base || "etape").replace(/^dzf_u?_?/, "").replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]/, "e_").slice(0, 40) || "etape";
    var n = base, i = 2; while (stepBy(n)) n = base + "_" + i++; return n;
  }
  function defaults(action) {
    return getFields(action).then(function (F) {
      var c = {};
      (F.fields || []).concat(F.advanced || []).forEach(function (f) {
        if (!f.required || f.def === undefined || f.def === null || f.def === "") return;
        if (f.name === "si_erreur" || f.name === "delai_max" || f.name === "essais" || f.name === "pause_essais") return;
        c[f.name] = typeof f.def === "object" ? JSON.stringify(f.def) : f.def;
      });
      if (F.dz) c.sortie = F.output || "resultat";
      return c;
    });
  }
  function addStep(action, pos) {
    defaults(action).then(function (cfg) {
      push();
      var b = BY[action] || {};
      var name = uniqueName(cfg.sortie || b.output || action);
      if (cfg.sortie) cfg.sortie = uniqueVar(cfg.sortie);
      var s = { id: null, name: name, action_name: action, configuration: cfg, next_step: "", only_if: "", initial_step: !S.steps.length };
      var prev = S.sel && S.sel !== TRIG ? stepBy(S.sel) : null;
      if (!prev && S.sel === TRIG && S.steps.length) { /* insérer en tête */
        var first = S.steps.filter(function (x) { return x.initial_step; })[0];
        if (first) { first.initial_step = false; s.initial_step = true; s.next_step = first.name; }
      }
      if (!prev && !pos && !S.sel && S.steps.length) prev = lastStep();
      if (prev) { var r = routeOf(prev); if (r.mode === "simple" || r.mode === "end") { s.next_step = r.mode === "simple" ? r.to : ""; prev.next_step = name; } }
      S.steps.push(s);
      if (pos) S.layout[name] = pos;
      else { var ref = prev ? S.layout[prev.name] : S.layout[TRIG]; S.layout[name] = { x: ref ? ref.x : 0, y: (ref ? ref.y : 0) + NH + 56 }; shiftBelow(name); }
      S.sel = name; S.tab = "form";
      changed(true);
    });
  }
  function uniqueVar(v) { var used = {}; S.steps.forEach(function (s) { if (s.configuration && s.configuration.sortie) used[s.configuration.sortie] = 1; }); var n = v, i = 2; while (used[n]) n = v + i++; return n; }
  function lastStep() { var ends = S.steps.filter(function (s) { return routeOf(s).mode === "end"; }); return ends.length ? ends[ends.length - 1] : S.steps[S.steps.length - 1]; }
  function shiftBelow(name) {
    var p = S.layout[name];
    S.steps.forEach(function (s) { if (s.name === name) return; var l = S.layout[s.name]; if (l && Math.abs(l.x - p.x) < NW && l.y >= p.y - 10 && l.y < p.y + NH + 40) l.y += NH + 56; });
  }
  function removeStep(name) {
    var s = stepBy(name); if (!s) return;
    push();
    var r = routeOf(s), next = r.mode === "simple" ? r.to : "";
    S.steps.forEach(function (x) {
      var rx = routeOf(x);
      if (rx.mode === "simple" && rx.to === name) rx.to = next;
      if (rx.mode === "cond") { if (rx.yes === name) rx.yes = next; if (rx.no === name) rx.no = next; }
      setRoute(x, rx);
      if (rx.mode === "simple" && !rx.to) x.next_step = "";
    });
    if (s.initial_step && next && stepBy(next)) stepBy(next).initial_step = true;
    S.steps = S.steps.filter(function (x) { return x !== s; });
    if (S.steps.length && !S.steps.some(function (x) { return x.initial_step; })) S.steps[0].initial_step = true;
    delete S.layout[name];
    S.sel = null; changed(true);
  }

  /* ---------------- dessin de la toile ---------------- */
  var world = $(".dzfe-world"), svg = $(".dzfe-svg"), nodesEl = $(".dzfe-nodes"), canvas = $(".dzfe-canvas");
  function applyView() { world.style.transform = "translate(" + S.px + "px," + S.py + "px) scale(" + S.zoom + ")"; }
  function summary(s) {
    var c = s.configuration || {};
    var keys = ["table", "url", "cibles", "sources", "workflow", "modele", "message", "titre", "operation", "array_expression", "code", "valeurs", "liste"];
    for (var i = 0; i < keys.length; i++) if (c[keys[i]]) return keys[i] === "code" ? "code JavaScript" : String(c[keys[i]]).replace(/\s+/g, " ").slice(0, 46);
    return "";
  }
  function nodeHtml(s) {
    var b = blockOf(s), r = routeOf(s), c = s.configuration || {};
    var err = S.run && S.run.errStep === s.name, done = S.run && S.run.okSteps && S.run.okSteps[s.name];
    var ports = r.mode === "cond" ? '<span class="dzfe-port yes" data-p="yes" title="Si oui">oui</span><span class="dzfe-port no" data-p="no" title="Sinon">non</span>' : '<span class="dzfe-port" data-p="out" title="Tirer pour relier à l\'étape suivante"></span>';
    if (s.action_name === "ForLoop" || s.action_name === "SetErrorHandler") ports += '<span class="dzfe-port side" data-p="loop" title="' + (s.action_name === "ForLoop" ? "Première étape de la boucle" : "Étape en cas d'erreur") + '"></span>';
    return '<div class="dzfe-node' + (S.sel === s.name ? " sel" : "") + (err ? " err" : "") + (done ? " ok" : "") + (b.builtin ? " builtin" : "") + '" data-n="' + esc(s.name) + '" style="left:' + S.layout[s.name].x + "px;top:" + S.layout[s.name].y + 'px">' +
      '<span class="dzfe-ic"><i class="' + esc(b.icon || "fas fa-cube") + '"></i></span><span class="dzfe-nt"><b>' + esc(b.label) + "</b><small>" + esc(s.name) + (c.sortie ? " → " + esc(c.sortie) : "") + "</small>" +
      (summary(s) ? '<em>' + esc(summary(s)) + "</em>" : "") + "</span>" +
      (s.only_if ? '<span class="dzfe-if" title="Seulement si : ' + esc(s.only_if) + '"><i class="fas fa-filter"></i></span>' : "") +
      '<span class="dzfe-in"></span>' + ports + "</div>";
  }
  function drawNodes() {
    var t = S.layout[TRIG] || { x: 0, y: 0 };
    var wl = (B.when.filter(function (w) { return w[0] === S.wf.when_trigger; })[0] || [0, S.wf.when_trigger])[1];
    var html = '<div class="dzfe-node trig' + (S.sel === TRIG ? " sel" : "") + '" data-n="' + TRIG + '" style="left:' + t.x + "px;top:" + t.y + 'px"><span class="dzfe-ic"><i class="fas fa-bolt"></i></span><span class="dzfe-nt"><b>Déclencheur</b><small>' + esc(wl) + (S.wf.table ? " · " + esc(S.wf.table) : "") + '</small></span><span class="dzfe-port" data-p="out" title="Tirer vers la première étape"></span></div>';
    html += S.steps.map(nodeHtml).join("");
    nodesEl.innerHTML = html;
    var hint = $(".dzfe-hint");
    hint.innerHTML = S.steps.length ? "" : '<div><i class="fas fa-hand-pointer"></i><b>Commence ici</b><p>Clique sur un bloc à gauche (ou glisse-le sur la toile) : il se relie tout seul au déclencheur. Tu peux aussi partir d\'un <a href="/dysizz-flow/modeles">modèle prêt à l\'emploi</a>.</p></div>';
  }
  function portPos(name, port) {
    var l = S.layout[name] || { x: 0, y: 0 };
    if (port === "yes") return { x: l.x + NW * 0.3, y: l.y + NH };
    if (port === "no") return { x: l.x + NW * 0.7, y: l.y + NH };
    if (port === "loop") return { x: l.x + NW, y: l.y + NH / 2 };
    return { x: l.x + NW / 2, y: l.y + NH };
  }
  function path(a, b, side) {
    if (side) { var dx = Math.max(60, Math.abs(b.x - a.x) / 2); return "M" + a.x + "," + a.y + " C" + (a.x + dx) + "," + a.y + " " + (b.x + dx) + "," + (b.y - 40) + " " + b.x + "," + b.y; }
    var dy = Math.max(40, Math.abs(b.y - a.y) / 2);
    if (b.y < a.y) dy = Math.max(120, Math.abs(b.y - a.y) / 2);
    return "M" + a.x + "," + a.y + " C" + a.x + "," + (a.y + dy) + " " + b.x + "," + (b.y - dy) + " " + b.x + "," + b.y;
  }
  function drawEdges(extra) {
    var html = '<defs><marker id="dzfe-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dzfe-arrow"/></marker></defs>';
    edges().forEach(function (e) {
      var a = portPos(e.from, e.port), tl = S.layout[e.to]; if (!tl) return;
      var b = { x: tl.x + NW / 2, y: tl.y };
      var d = path(a, b, e.port === "loop");
      html += '<path class="dzfe-edge' + (e.dashed ? " dashed" : "") + (e.kind === "non" ? " no" : e.kind === "oui" ? " yes" : "") + '" d="' + d + '" marker-end="url(#dzfe-arr)" data-from="' + esc(e.from) + '" data-port="' + e.port + '"/>';
      if (e.label) { var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; html += '<text class="dzfe-el" x="' + mx + '" y="' + my + '">' + esc(e.label) + "</text>"; }
    });
    if (extra) html += '<path class="dzfe-edge live" d="' + extra + '"/>';
    svg.innerHTML = html;
  }
  function drawAll() { autoLayout(false); drawNodes(); drawEdges(); applyView(); }

  /* ---------------- déplacer, relier, zoomer ---------------- */
  var drag = null;
  function toWorld(ev) { var r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left - S.px) / S.zoom, y: (ev.clientY - r.top - S.py) / S.zoom }; }
  canvas.addEventListener("pointerdown", function (ev) {
    if (ev.button !== 0 || ev.target.closest(".dzfe-zoom,.dzfe-fab,.dzfe-hint a")) return;
    var port = ev.target.closest(".dzfe-port"), node = ev.target.closest(".dzfe-node");
    if (port && node) { drag = { kind: "link", from: node.dataset.n, port: port.dataset.p }; ev.preventDefault(); canvas.setPointerCapture(ev.pointerId); return; }
    if (node) {
      var n = node.dataset.n, w = toWorld(ev), l = S.layout[n];
      drag = { kind: "move", n: n, dx: w.x - l.x, dy: w.y - l.y, moved: false };
      canvas.setPointerCapture(ev.pointerId); return;
    }
    drag = { kind: "pan", x: ev.clientX, y: ev.clientY, px: S.px, py: S.py, moved: false };
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (!drag) return;
    if (drag.kind === "pan") { S.px = drag.px + ev.clientX - drag.x; S.py = drag.py + ev.clientY - drag.y; if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) > 3) drag.moved = true; applyView(); return; }
    var w = toWorld(ev);
    if (drag.kind === "move") {
      if (!drag.moved) { push(); drag.moved = true; }
      S.layout[drag.n] = { x: Math.round((w.x - drag.dx) / 8) * 8, y: Math.round((w.y - drag.dy) / 8) * 8 };
      var el = nodesEl.querySelector('[data-n="' + cssEsc(drag.n) + '"]'); if (el) { el.style.left = S.layout[drag.n].x + "px"; el.style.top = S.layout[drag.n].y + "px"; }
      drawEdges(); return;
    }
    if (drag.kind === "link") { var a = portPos(drag.from, drag.port); drawEdges(path(a, w, drag.port === "loop")); var over = document.elementFromPoint(ev.clientX, ev.clientY); $$(".dzfe-node.target").forEach(function (x) { x.classList.remove("target"); }); var tn = over && over.closest && over.closest(".dzfe-node"); if (tn && tn.dataset.n !== drag.from && tn.dataset.n !== TRIG) tn.classList.add("target"); }
  });
  canvas.addEventListener("pointerup", function (ev) {
    if (!drag) return;
    var d = drag; drag = null;
    if (d.kind === "pan" && !d.moved) { S.sel = null; drawNodes(); panel(); return; }
    if (d.kind === "move") { if (d.moved) { S.dirty = true; status(); } else { S.sel = d.n; S.tab = "form"; drawNodes(); panel(); } return; }
    if (d.kind === "link") {
      var over = document.elementFromPoint(ev.clientX, ev.clientY), tn = over && over.closest && over.closest(".dzfe-node");
      $$(".dzfe-node.target").forEach(function (x) { x.classList.remove("target"); });
      if (tn && tn.dataset.n !== d.from && tn.dataset.n !== TRIG) link(d.from, d.port, tn.dataset.n);
      else if (!tn) { S.sel = d.from === TRIG ? TRIG : d.from; pickNext(d.from, d.port, toWorld(ev)); }
      drawEdges();
    }
  });
  function cssEsc(s) { return String(s).replace(/"/g, '\\"'); }
  function link(from, port, to) {
    push();
    if (from === TRIG) { S.steps.forEach(function (s) { s.initial_step = s.name === to; }); changed(true); return; }
    var s = stepBy(from), r = routeOf(s);
    if (port === "loop") { s.configuration = s.configuration || {}; s.configuration[s.action_name === "ForLoop" ? "loop_body_initial_step" : "error_handling_step"] = to; }
    else if (port === "yes" || port === "no") { r[port] = to; setRoute(s, r); }
    else setRoute(s, { mode: "simple", to: to });
    changed(true);
  }
  /* relâché dans le vide : on propose d'ajouter un bloc à cet endroit */
  function pickNext(from, port, pos) {
    modal('<h3>Ajouter une étape ici</h3><input class="dzfe-in-q" placeholder="Chercher un bloc…" autofocus><div class="dzfe-pick"></div>', function (m) {
      var q = m.querySelector(".dzfe-in-q"), list = m.querySelector(".dzfe-pick");
      function draw() { var v = q.value.toLowerCase(); list.innerHTML = B.palette.blocks.filter(function (b) { return !v || (b.label + " " + b.description).toLowerCase().indexOf(v) >= 0; }).slice(0, 40).map(function (b) { return '<button class="dzfe-pb" data-b="' + esc(b.name) + '"><i class="' + esc(b.icon) + '"></i><span><b>' + esc(b.label) + "</b><small>" + esc(b.category) + "</small></span></button>"; }).join(""); }
      q.addEventListener("input", draw); draw(); setTimeout(function () { q.focus(); }, 30);
      list.addEventListener("click", function (e) {
        var p = e.target.closest(".dzfe-pb"); if (!p) return; closeModal();
        defaults(p.dataset.b).then(function (cfg) {
          push();
          var name = uniqueName(cfg.sortie || p.dataset.b); if (cfg.sortie) cfg.sortie = uniqueVar(cfg.sortie);
          S.steps.push({ id: null, name: name, action_name: p.dataset.b, configuration: cfg, next_step: "", only_if: "", initial_step: false });
          S.layout[name] = { x: Math.round(pos.x - NW / 2), y: Math.round(pos.y) };
          if (from === TRIG) S.steps.forEach(function (s) { s.initial_step = s.name === name; });
          else { var s = stepBy(from), r = routeOf(s); if (port === "loop") s.configuration[s.action_name === "ForLoop" ? "loop_body_initial_step" : "error_handling_step"] = name; else if (port === "yes" || port === "no") { r[port] = name; setRoute(s, r); } else setRoute(s, { mode: "simple", to: name }); }
          S.sel = name; changed(true);
        });
      });
    });
  }
  canvas.addEventListener("dragover", function (e) { e.preventDefault(); });
  canvas.addEventListener("drop", function (e) { var b = e.dataTransfer.getData("text/dzf"); if (!b) return; e.preventDefault(); var w = toWorld(e); S.sel = null; addStep(b, { x: Math.round(w.x - NW / 2), y: Math.round(w.y - NH / 2) }); });
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    if (!e.ctrlKey && Math.abs(e.deltaX) + Math.abs(e.deltaY) < 50 && !e.deltaMode) { S.px -= e.deltaX; S.py -= e.deltaY; applyView(); return; }
    zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
  }, { passive: false });
  function zoomAt(f, cx, cy) {
    var r = canvas.getBoundingClientRect(); cx = cx === undefined ? r.left + r.width / 2 : cx; cy = cy === undefined ? r.top + r.height / 2 : cy;
    var nz = Math.min(2, Math.max(0.3, S.zoom * f)), k = nz / S.zoom;
    S.px = cx - r.left - (cx - r.left - S.px) * k; S.py = cy - r.top - (cy - r.top - S.py) * k; S.zoom = nz; applyView();
  }
  function fit() {
    var ns = [TRIG].concat(S.steps.map(function (s) { return s.name; })).map(function (n) { return S.layout[n]; }).filter(Boolean);
    if (!ns.length) return;
    var x0 = Math.min.apply(null, ns.map(function (l) { return l.x; })), y0 = Math.min.apply(null, ns.map(function (l) { return l.y; }));
    var x1 = Math.max.apply(null, ns.map(function (l) { return l.x + NW; })), y1 = Math.max.apply(null, ns.map(function (l) { return l.y + NH; }));
    var r = canvas.getBoundingClientRect();
    S.zoom = Math.min(1.2, Math.max(0.3, Math.min((r.width - 80) / (x1 - x0 || 1), (r.height - 80) / (y1 - y0 || 1))));
    S.px = (r.width - (x1 - x0) * S.zoom) / 2 - x0 * S.zoom; S.py = 40 - y0 * S.zoom; applyView();
  }

  /* ---------------- panneau de droite ---------------- */
  var panelEl = $(".dzfe-panel");
  function getFields(action) {
    if (S.fields[action]) return Promise.resolve(S.fields[action]);
    return fetch("/dysizz-flow/editeur-api/fields/" + encodeURIComponent(action) + "?table=" + encodeURIComponent(S.wf.table || ""), { credentials: "same-origin" })
      .then(function (r) { return r.json(); }).then(function (j) { S.fields[action] = j; return j; }).catch(function () { return { fields: [] }; });
  }
  function vars(upto) {
    var out = [{ v: "user.email", l: "l'utilisateur" }];
    var t = B.tables.filter(function (x) { return x.name === S.wf.table; })[0];
    if (t) t.fields.forEach(function (f) { out.push({ v: f, l: "champ de la ligne (" + S.wf.table + ")" }); });
    if (S.wf.when_trigger === "API call") out.push({ v: "corps", l: "données reçues" });
    var seen = {}, order = [], first = S.steps.filter(function (s) { return s.initial_step; })[0];
    (function walk(s) { if (!s || seen[s.name]) return; seen[s.name] = 1; order.push(s); edges().filter(function (e) { return e.from === s.name; }).forEach(function (e) { walk(stepBy(e.to)); }); })(first);
    S.steps.forEach(function (s) { if (!seen[s.name]) order.push(s); });
    for (var i = 0; i < order.length; i++) {
      var s = order[i]; if (s.name === upto) break;
      var c = s.configuration || {};
      if (c.sortie) out.push({ v: c.sortie, l: "résultat de « " + blockOf(s).label + " »" });
      if (s.action_name === "ForLoop" && c.item_variable) out.push({ v: c.item_variable, l: "élément de la boucle" });
      if (s.action_name === "TableQuery" && c.query_variable) out.push({ v: c.query_variable, l: "lignes lues" });
    }
    return out;
  }
  function fieldHtml(f, val, withVars) {
    var id = "f_" + f.name, v = val === undefined || val === null ? "" : val, ph = f.def !== undefined && f.def !== null && typeof f.def !== "object" ? String(f.def) : "";
    var head = '<label for="' + id + '">' + esc(f.label) + (f.required ? ' <span class="req">*</span>' : "") + "</label>";
    var help = f.help ? '<small class="help">' + esc(f.help) + "</small>" : "";
    var vb = withVars && f.vars !== false ? '<button type="button" class="dzfe-vb" data-for="' + id + '" title="Insérer une variable">{ }</button>' : "";
    var input;
    if (f.kind === "header") return '<h4 class="dzfe-fh">' + esc(f.label) + "</h4>";
    if (f.kind === "bool") input = '<label class="dzfe-sw"><input type="checkbox" id="' + id + '" data-f="' + esc(f.name) + '"' + (v === true || v === "true" || v === "on" ? " checked" : "") + '><span></span>' + esc(f.label) + "</label>";
    else if (f.options && f.options.length) {
      var has = f.options.some(function (o) { return o.v === String(v); });
      input = '<select id="' + id + '" data-f="' + esc(f.name) + '"><option value=""' + (!v ? " selected" : "") + ">" + (ph ? "(par défaut : " + esc(ph) + ")" : "— choisir —") + "</option>" +
        f.options.map(function (o) { return '<option value="' + esc(o.v) + '"' + (o.v === String(v) ? " selected" : "") + ">" + esc(o.l) + "</option>"; }).join("") +
        (v && !has ? '<option value="' + esc(v) + '" selected>' + esc(v) + "</option>" : "") + "</select>";
    } else if (f.kind === "json" || f.kind === "code" || f.kind === "text") {
      input = '<textarea id="' + id + '" data-f="' + esc(f.name) + '" class="' + (f.kind !== "text" ? "mono" : "") + '" rows="' + (f.kind === "code" ? 12 : f.kind === "json" ? 6 : 4) + '" spellcheck="false" placeholder="' + esc(ph) + '">' + esc(typeof v === "object" ? JSON.stringify(v, null, 2) : v) + "</textarea>";
    } else input = '<input id="' + id + '" data-f="' + esc(f.name) + '" type="' + (f.kind === "number" ? "number" : f.kind === "password" ? "password" : "text") + '" value="' + esc(v) + '" placeholder="' + esc(ph) + '">';
    return '<div class="dzfe-f' + (f.kind === "bool" ? " bool" : "") + '" data-show=\'' + esc(JSON.stringify(f.showIf || null)) + "'>" + (f.kind === "bool" ? "" : head) + '<div class="dzfe-fi">' + input + vb + "</div>" + help + '<small class="dzfe-ferr"></small></div>';
  }
  function panel() {
    root.classList.toggle("panel-open", !!S.sel);
    if (!S.sel) { panelEl.innerHTML = panelEmpty(); return; }
    if (S.sel === TRIG) return panelTrigger();
    var s = stepBy(S.sel); if (!s) { S.sel = null; return panel(); }
    var b = blockOf(s);
    panelEl.innerHTML = '<div class="dzfe-ph"><span class="dzfe-ic"><i class="' + esc(b.icon) + '"></i></span><div><b>' + esc(b.label) + '</b><small>' + esc(b.category || "") + '</small></div><button class="dzfe-x" data-a="close" title="Fermer"><i class="fas fa-times"></i></button></div>' +
      '<p class="dzfe-desc">' + esc(b.description || "") + (b.dz ? ' <a href="/dysizz-flow/bloc/' + encodeURIComponent(s.action_name) + '" target="_blank">Exemples et essai <i class="fas fa-external-link-alt"></i></a>' : "") + "</p>" +
      '<div class="dzfe-tabs"><button data-tab="form" class="' + (S.tab === "form" ? "on" : "") + '">Réglages</button><button data-tab="flow" class="' + (S.tab === "flow" ? "on" : "") + '">Enchaînement</button><button data-tab="json" class="' + (S.tab === "json" ? "on" : "") + '">Code</button></div>' +
      '<div class="dzfe-pb-body">Chargement…</div>';
    var body = $(".dzfe-pb-body", panelEl);
    if (S.tab === "json") return panelJson(s, body);
    if (S.tab === "flow") return panelFlow(s, body);
    getFields(s.action_name).then(function (F) {
      if (S.sel !== s.name || S.tab !== "form") return;
      var c = s.configuration || {};
      var html = '<div class="dzfe-f"><label>Nom de l\'étape</label><div class="dzfe-fi"><input data-meta="name" value="' + esc(s.name) + '"></div><small class="help">Lettres, chiffres et _. Sert à relier les étapes.</small><small class="dzfe-ferr"></small></div>';
      if (F.unknown) html += '<p class="dzfe-warn">Ce bloc n\'existe pas (module retiré ?). Ses réglages restent visibles dans l\'onglet Code.</p>';
      html += (F.fields || []).map(function (f) { return fieldHtml(f, c[f.name], F.dz); }).join("") || '<p class="dzfe-mute">Ce bloc n\'a pas de réglage.</p>';
      if ((F.advanced || []).length) html += '<details class="dzfe-adv"><summary>Réglages avancés (résultat, erreurs, essais)</summary>' + F.advanced.map(function (f) { return fieldHtml(f, c[f.name], false); }).join("") + "</details>";
      body.innerHTML = html;
      showIfs(body, s);
    });
  }
  function showIfs(body, s) {
    $$(".dzfe-f", body).forEach(function (el) {
      var cond = JSON.parse(el.getAttribute("data-show") || "null"); if (!cond) return;
      var ok = Object.keys(cond).every(function (k) { var want = [].concat(cond[k]); var v = (s.configuration || {})[k]; return want.some(function (w) { return String(w) === String(v) || (w === true && (v === true || v === "on")); }); });
      el.style.display = ok ? "" : "none";
    });
  }
  function panelEmpty() {
    return '<div class="dzfe-pe"><i class="fas fa-mouse-pointer"></i><b>Clique sur un bloc pour le régler</b><p>Astuces :</p><ul>' +
      "<li>Tire le petit rond sous un bloc vers un autre pour les relier.</li><li>Relâche dans le vide pour ajouter une étape à cet endroit.</li>" +
      "<li>Chaque étape range son résultat dans une variable ; les suivantes la lisent avec <code>{{nom}}</code> (bouton <b>{ }</b>).</li>" +
      "<li>Molette : se déplacer · Ctrl + molette : zoomer · Suppr : effacer le bloc choisi.</li><li>Ctrl S : enregistrer · Ctrl Z : annuler.</li></ul></div>";
  }
  function panelTrigger() {
    var need = B.tableWhen.indexOf(S.wf.when_trigger) >= 0;
    panelEl.innerHTML = '<div class="dzfe-ph"><span class="dzfe-ic trig"><i class="fas fa-bolt"></i></span><div><b>Déclencheur</b><small>Quand le workflow démarre</small></div><button class="dzfe-x" data-a="close"><i class="fas fa-times"></i></button></div>' +
      '<div class="dzfe-pb-body"><div class="dzfe-f"><label>Nom du workflow</label><div class="dzfe-fi"><input data-w="name" value="' + esc(S.wf.name) + '" placeholder="ex. releve_mails"></div></div>' +
      '<div class="dzfe-f"><label>Description</label><div class="dzfe-fi"><textarea data-w="description" rows="2" placeholder="Ce que fait ce workflow, en une phrase">' + esc(S.wf.description) + "</textarea></div></div>" +
      '<div class="dzfe-f"><label>Quand démarre-t-il ?</label><div class="dzfe-when">' + B.when.map(function (w) { return '<label class="' + (S.wf.when_trigger === w[0] ? "on" : "") + '"><input type="radio" name="when" value="' + esc(w[0]) + '"' + (S.wf.when_trigger === w[0] ? " checked" : "") + ">" + esc(w[1]) + "</label>"; }).join("") + "</div></div>" +
      '<div class="dzfe-f" style="' + (need ? "" : "display:none") + '"><label>Quelle table ?</label><div class="dzfe-fi"><select data-w="table"><option value="">— choisir —</option>' + B.tables.map(function (t) { return '<option' + (t.name === S.wf.table ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("") + '</select></div><small class="help">Dans les étapes, les champs de la ligne sont disponibles directement : {{nom_du_champ}}.</small></div>' +
      (S.wf.when_trigger === "API call" ? '<p class="dzfe-note">Adresse Saltcorn : <code>POST /api/action/' + esc(S.wf.name || "nom") + '</code>. Pour une adresse publique protégée (jeton, signature, limite), utilise plutôt les <a href="/dysizz-flow/api" target="_blank">Points d\'API</a> : laisse ce workflow « à la main » et choisis-le dans un point.</p>' : "") +
      "</div>";
  }
  function panelFlow(s, body) {
    var r = routeOf(s), others = S.steps.filter(function (x) { return x !== s; }).map(function (x) { return x.name; });
    function opts(cur) { return '<option value="">(fin du workflow)</option>' + others.map(function (n) { return "<option" + (n === cur ? " selected" : "") + ">" + esc(n) + "</option>"; }).join(""); }
    body.innerHTML =
      '<div class="dzfe-f"><label>Seulement si… <small>(sinon l\'étape est sautée)</small></label><div class="dzfe-fi"><input data-meta="only_if" value="' + esc(s.only_if) + '" placeholder="ex. nouveaux.length > 0" class="mono"></div><small class="help">Une condition JavaScript sur les variables du contexte. Vide = toujours.</small><div class="dzfe-chips">' +
      vars(s.name).slice(0, 12).map(function (v) { return '<button type="button" data-ins="only_if" data-v="' + esc(v.v) + '" title="' + esc(v.l) + '">' + esc(v.v) + "</button>"; }).join("") + "</div></div>" +
      '<div class="dzfe-f"><label>Ensuite</label><div class="dzfe-seg">' +
      [["end", "Fin"], ["simple", "Étape suivante"], ["cond", "Si… sinon…"], ["expr", "Expression"]].map(function (m) { return '<button type="button" data-mode="' + m[0] + '" class="' + (r.mode === m[0] ? "on" : "") + '">' + m[1] + "</button>"; }).join("") + "</div></div>" +
      (r.mode === "simple" ? '<div class="dzfe-f"><label>Aller à</label><div class="dzfe-fi"><select data-r="to">' + opts(r.to) + "</select></div></div>" : "") +
      (r.mode === "cond" ? '<div class="dzfe-f"><label>Si cette condition est vraie</label><div class="dzfe-fi"><input data-r="expr" class="mono" value="' + esc(r.expr) + '" placeholder="ex. verrou"></div></div><div class="dzfe-f"><label>alors aller à</label><div class="dzfe-fi"><select data-r="yes">' + opts(r.yes) + '</select></div></div><div class="dzfe-f"><label>sinon aller à</label><div class="dzfe-fi"><select data-r="no">' + opts(r.no) + "</select></div></div>" : "") +
      (r.mode === "expr" ? '<div class="dzfe-f"><label>Expression qui donne le nom de l\'étape suivante</label><div class="dzfe-fi"><textarea data-r="expr" class="mono" rows="3">' + esc(r.expr) + '</textarea></div><small class="help">JavaScript. Ex. <code>statut === "urgent" ? "alerte" : "ranger"</code></small></div>' : "") +
      '<div class="dzfe-f"><label class="dzfe-sw"><input type="checkbox" data-meta="initial_step"' + (s.initial_step ? " checked" : "") + "><span></span>Première étape du workflow</label></div>" +
      '<div class="dzfe-danger"><button type="button" class="dzfe-btn danger" data-a="del"><i class="far fa-trash-alt"></i> Supprimer cette étape</button></div>';
  }
  function panelJson(s, body) {
    body.innerHTML = '<p class="dzfe-mute">Pour les techniciens : l\'étape telle que Saltcorn la range. Modifie puis applique.</p><textarea class="mono dzfe-json" rows="22" spellcheck="false">' + esc(JSON.stringify({ action_name: s.action_name, configuration: s.configuration, only_if: s.only_if, next_step: s.next_step }, null, 2)) + '</textarea><small class="dzfe-ferr"></small><button type="button" class="dzfe-btn primary" data-a="applyjson">Appliquer</button>';
  }

  /* saisie dans le panneau : l'état change, seul le bloc concerné est redessiné (pas de lag) */
  var typing = null;
  panelEl.addEventListener("focusin", function (e) { if (e.target.matches("input,textarea,select") && !typing) { push(); typing = true; } });
  panelEl.addEventListener("focusout", function () { typing = null; });
  panelEl.addEventListener("input", onPanelInput);
  panelEl.addEventListener("change", onPanelInput);
  function onPanelInput(e) {
    var t = e.target;
    if (t.name === "when") { S.wf.when_trigger = t.value; changed(false); panelTrigger(); return; }
    if (t.dataset.w) { S.wf[t.dataset.w] = t.value; if (t.dataset.w === "name") $(".dzfe-name").value = t.value; if (t.dataset.w === "table") S.fields = {}; S.dirty = true; status(); drawNodes(); return; }
    var s = stepBy(S.sel); if (!s) return;
    if (t.dataset.f) {
      s.configuration = s.configuration || {};
      var v = t.type === "checkbox" ? t.checked : t.type === "number" ? (t.value === "" ? "" : Number(t.value)) : t.value;
      if (v === "" && t.type !== "checkbox") delete s.configuration[t.dataset.f]; else s.configuration[t.dataset.f] = v;
      var err = t.closest(".dzfe-f").querySelector(".dzfe-ferr");
      if (err) { err.textContent = ""; if (t.classList.contains("mono") && /^\s*[\[{]/.test(t.value) && e.type === "change") { try { JSON.parse(t.value.replace(/\{\{[^}]*\}\}/g, "0")); } catch (x) { err.textContent = "JSON invalide : " + x.message; } } }
      showIfs(panelEl, s); redrawNode(s); return;
    }
    if (t.dataset.meta === "name") {
      var nv = t.value.trim(), err2 = t.closest(".dzfe-f").querySelector(".dzfe-ferr");
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(nv)) { err2.textContent = "Lettres, chiffres et _ seulement"; return; }
      if (nv !== s.name && stepBy(nv)) { err2.textContent = "Ce nom est déjà pris"; return; }
      err2.textContent = ""; renameRefs(s.name, nv); s.name = nv; S.sel = nv; S.dirty = true; status(); drawNodes(); drawEdges(); return;
    }
    if (t.dataset.meta === "only_if") { s.only_if = t.value; redrawNode(s); S.dirty = true; status(); return; }
    if (t.dataset.meta === "initial_step") { S.steps.forEach(function (x) { x.initial_step = x === s ? t.checked : false; }); if (!S.steps.some(function (x) { return x.initial_step; })) s.initial_step = true; changed(false); return; }
    if (t.dataset.r) { var r = routeOf(s); r[t.dataset.r] = t.value; if (r.mode === "simple" && !r.to) r = { mode: "end" }; setRoute(s, r); S.dirty = true; status(); drawEdges(); redrawNode(s); }
  }
  function redrawNode(s) { var el = nodesEl.querySelector('[data-n="' + cssEsc(s.name) + '"]'); if (!el) return drawNodes(); var tmp = document.createElement("div"); tmp.innerHTML = nodeHtml(s); el.replaceWith(tmp.firstChild); S.dirty = true; status(); }
  panelEl.addEventListener("click", function (e) {
    var t = e.target.closest("button"); if (!t) return;
    var s = stepBy(S.sel);
    if (t.dataset.tab) { S.tab = t.dataset.tab; panel(); return; }
    if (t.dataset.a === "close") { S.sel = null; drawNodes(); panel(); return; }
    if (t.dataset.a === "del" && s && confirm("Supprimer l'étape « " + s.name + " » ?")) { removeStep(s.name); return; }
    if (t.dataset.mode && s) {
      push(); var r = routeOf(s), m = t.dataset.mode, next = r.mode === "simple" ? r.to : r.mode === "cond" ? r.yes : "";
      if (m === "end") setRoute(s, { mode: "end" });
      if (m === "simple") setRoute(s, { mode: "simple", to: next || "" });
      if (m === "cond") setRoute(s, { mode: "cond", expr: r.expr && r.mode !== "expr" ? r.expr : "true", yes: next, no: "" });
      if (m === "expr") setRoute(s, { mode: "expr", expr: s.next_step || '""' });
      if (m === "simple" && !next) s.next_step = "";
      S.tab = "flow"; changed(true); return;
    }
    if (t.dataset.ins && s) { var inp = panelEl.querySelector('[data-meta="' + t.dataset.ins + '"]'); inp.value = (inp.value ? inp.value + " " : "") + t.dataset.v; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.focus(); return; }
    if (t.dataset.a === "applyjson" && s) {
      var ta = panelEl.querySelector(".dzfe-json"), er = panelEl.querySelector(".dzfe-ferr");
      try { var o = JSON.parse(ta.value); push(); s.action_name = o.action_name || s.action_name; s.configuration = o.configuration || {}; s.only_if = o.only_if || ""; s.next_step = o.next_step || ""; er.textContent = ""; changed(true); } catch (x) { er.textContent = "JSON invalide : " + x.message; }
      return;
    }
    if (t.classList.contains("dzfe-vb")) varMenu(t);
  });
  function varMenu(btn) {
    var s = stepBy(S.sel), input = panelEl.querySelector("#" + btn.dataset.for), list = vars(s ? s.name : "");
    var old = panelEl.querySelector(".dzfe-vm"); if (old) { old.remove(); if (old.dataset.for === btn.dataset.for) return; }
    var m = document.createElement("div"); m.className = "dzfe-vm"; m.dataset.for = btn.dataset.for;
    m.innerHTML = "<b>Insérer une variable</b>" + list.map(function (v) { return '<button type="button" data-v="' + esc(v.v) + '"><code>{{' + esc(v.v) + "}}</code><small>" + esc(v.l) + "</small></button>"; }).join("") + '<small class="help">Pour un champ d\'un résultat : <code>{{resultat.champ}}</code>. Dans une liste transformée : <code>{{item.champ}}</code>.</small>';
    btn.closest(".dzfe-f").appendChild(m);
    m.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var ins = "{{" + b.dataset.v + "}}", st = input.selectionStart || input.value.length, en = input.selectionEnd || st;
      input.value = input.value.slice(0, st) + ins + input.value.slice(en); input.focus(); input.selectionStart = input.selectionEnd = st + ins.length;
      input.dispatchEvent(new Event("input", { bubbles: true })); m.remove();
    });
  }
  /* Tab dans les zones de code */
  root.addEventListener("keydown", function (e) {
    if (e.key === "Tab" && e.target.matches("textarea.mono")) { e.preventDefault(); var t = e.target, a = t.selectionStart; t.value = t.value.slice(0, a) + "  " + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = a + 2; t.dispatchEvent(new Event("input", { bubbles: true })); }
  });
  $(".dzfe-name").addEventListener("input", function (e) { S.wf.name = e.target.value; S.dirty = true; status(); var x = panelEl.querySelector('[data-w="name"]'); if (x) x.value = e.target.value; });

  /* ---------------- barre du haut ---------------- */
  root.addEventListener("click", function (e) {
    var b = e.target.closest("[data-a]"); if (!b || panelEl.contains(b)) return;
    var a = b.dataset.a;
    if (a === "undo" && S.undo.length) { S.redo.push(snapshot()); restore(S.undo.pop()); }
    if (a === "redo" && S.redo.length) { S.undo.push(snapshot()); restore(S.redo.pop()); }
    if (a === "tidy") { push(); autoLayout(true); changed(false); fit(); }
    if (a === "zin") zoomAt(1.2); if (a === "zout") zoomAt(1 / 1.2); if (a === "fit") fit();
    if (a === "save") save();
    if (a === "run") runDialog();
    if (a === "code") codeDialog();
    if (a === "pal") root.classList.toggle("pal-open");
  });
  document.addEventListener("keydown", function (e) {
    var inField = e.target.matches && e.target.matches("input,textarea,select");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
    if (inField) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (S.undo.length) { S.redo.push(snapshot()); restore(S.undo.pop()); } }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); if (S.redo.length) { S.undo.push(snapshot()); restore(S.redo.pop()); } }
    if ((e.key === "Delete" || e.key === "Backspace") && S.sel && S.sel !== TRIG) { e.preventDefault(); removeStep(S.sel); }
    if (e.key === "Escape") { closeModal(); S.sel = null; drawNodes(); panel(); }
  });
  window.addEventListener("beforeunload", function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

  function post(url, body) {
    return fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "CSRF-Token": B.csrf, "X-Requested-With": "XMLHttpRequest" }, body: JSON.stringify(Object.assign({ _csrf: B.csrf }, body)) }).then(function (r) { return r.json(); });
  }
  function toast(msg, bad) { var t = document.createElement("div"); t.className = "dzfe-toast" + (bad ? " bad" : ""); t.textContent = msg; root.appendChild(t); setTimeout(function () { t.classList.add("out"); }, 3200); setTimeout(function () { t.remove(); }, 3700); }
  function save() {
    if (!S.wf.name) { S.sel = TRIG; panel(); toast("Donne d'abord un nom au workflow", true); return Promise.reject(); }
    var btn = root.querySelector('[data-a="save"]'); btn.disabled = true;
    return post("/dysizz-flow/editeur-api/save", { id: S.wf.id, name: S.wf.name, description: S.wf.description, when_trigger: S.wf.when_trigger, table: S.wf.table, layout: S.layout, steps: S.steps })
      .then(function (j) {
        btn.disabled = false;
        if (j.error) { toast(j.error, true); throw new Error(j.error); }
        var isNew = !S.wf.id;
        S.wf.id = j.wf.id; S.steps.forEach(function (s) { var m = j.wf.steps.filter(function (x) { return x.name === s.name; })[0]; if (m) s.id = m.id; });
        S.dirty = false; status(); toast("Enregistré");
        if (isNew) history.replaceState(null, "", "/dysizz-flow/editeur/" + j.wf.id);
        return j;
      }, function (e) { btn.disabled = false; toast("Enregistrement impossible : " + e.message, true); throw e; });
  }

  /* ---------------- essai ---------------- */
  function exampleCtx() {
    var t = B.tables.filter(function (x) { return x.name === S.wf.table; })[0];
    if (t) { var o = {}; t.fields.forEach(function (f) { if (f !== "id") o[f] = ""; }); return JSON.stringify(o, null, 2); }
    if (S.wf.when_trigger === "API call") return '{\n  "corps": {}\n}';
    return "{}";
  }
  function runDialog() {
    modal('<h3>Lancer un essai</h3><p class="dzfe-mute">Le workflow s\'exécute vraiment (écritures, envois compris). Données de départ (JSON) :</p><textarea class="mono dzfe-ctx" rows="8" spellcheck="false">' + esc(S.lastCtx || exampleCtx()) + '</textarea><div class="dzfe-mact"><button class="dzfe-btn" data-m="cancel">Annuler</button><button class="dzfe-btn primary" data-m="go"><i class="fas fa-play"></i> Lancer</button></div>', function (m) {
      m.addEventListener("click", function (e) {
        var b = e.target.closest("[data-m]"); if (!b) return;
        if (b.dataset.m === "cancel") return closeModal();
        var ctx = m.querySelector(".dzfe-ctx").value; S.lastCtx = ctx;
        try { JSON.parse(ctx || "{}"); } catch (x) { toast("JSON invalide : " + x.message, true); return; }
        closeModal();
        (S.dirty || !S.wf.id ? save() : Promise.resolve()).then(function () {
          showRun({ pending: true });
          return post("/dysizz-flow/editeur-api/run", { id: S.wf.id, contexte: ctx });
        }).then(function (j) { if (j) showRun(j); }).catch(function () {});
      });
    });
  }
  function showRun(j) {
    var el = $(".dzfe-run");
    if (j.pending) { el.className = "dzfe-run open"; el.innerHTML = '<div class="dzfe-rh"><b><i class="fas fa-spinner fa-spin"></i> Essai en cours…</b></div>'; return; }
    var errStep = !j.ok && j.step ? [].concat(j.step)[0] : null;
    S.run = { errStep: errStep, okSteps: {} };
    if (j.context) S.steps.forEach(function (s) { var c = s.configuration || {}; if (c.sortie && j.context[c.sortie] !== undefined) S.run.okSteps[s.name] = true; });
    drawNodes();
    el.className = "dzfe-run open";
    el.innerHTML = '<div class="dzfe-rh"><b class="' + (j.ok ? "ok" : "ko") + '">' + (j.ok ? '<i class="fas fa-check-circle"></i> Terminé' : j.status === "Waiting" ? '<i class="fas fa-pause-circle"></i> En attente' : '<i class="fas fa-times-circle"></i> Erreur') + "</b><span>" + (j.ms || 0) + " ms" + (j.run_id ? ' · <a href="/actions/run/' + j.run_id + '" target="_blank">détail Saltcorn</a>' : "") + '</span><button class="dzfe-x" data-rc><i class="fas fa-times"></i></button></div>' +
      (j.error ? '<div class="dzfe-rerr">' + (errStep ? "Étape <b>" + esc(errStep) + "</b> : " : "") + esc(j.error) + "</div>" : "") +
      '<div class="dzfe-rctx">' + tree(j.context || {}, 0) + "</div>";
    el.querySelector("[data-rc]").addEventListener("click", function () { el.className = "dzfe-run"; S.run = null; drawNodes(); });
  }
  function tree(v, d) {
    if (v === null || v === undefined) return '<span class="n">vide</span>';
    if (typeof v !== "object") return '<span class="' + typeof v + '">' + esc(typeof v === "string" && v.length > 300 ? v.slice(0, 300) + "…" : v) + "</span>";
    var keys = Object.keys(v), arr = Array.isArray(v);
    if (!keys.length) return arr ? "[ ]" : "{ }";
    return '<details' + (d < 1 ? " open" : "") + "><summary>" + (arr ? "liste · " + keys.length + " élément(s)" : keys.length + " champ(s)") + "</summary><ul>" +
      keys.slice(0, 100).map(function (k) { return "<li><b>" + esc(k) + "</b> " + tree(v[k], d + 1) + "</li>"; }).join("") + (keys.length > 100 ? "<li>…</li>" : "") + "</ul></details>";
  }

  /* ---------------- code du workflow entier ---------------- */
  function codeDialog() {
    var txt = JSON.stringify({ name: S.wf.name, description: S.wf.description, when_trigger: S.wf.when_trigger, table: S.wf.table, steps: S.steps.map(function (s) { return { name: s.name, action_name: s.action_name, initial_step: s.initial_step, only_if: s.only_if, next_step: s.next_step, configuration: s.configuration }; }) }, null, 2);
    modal('<h3>Le workflow en JSON</h3><p class="dzfe-mute">Copie-le pour le partager ou le versionner, ou colle un workflow pour le remplacer.</p><textarea class="mono dzfe-all" rows="22" spellcheck="false">' + esc(txt) + '</textarea><small class="dzfe-ferr"></small><div class="dzfe-mact"><button class="dzfe-btn" data-m="copy"><i class="far fa-copy"></i> Copier</button><button class="dzfe-btn" data-m="cancel">Fermer</button><button class="dzfe-btn primary" data-m="apply">Appliquer</button></div>', function (m) {
      m.addEventListener("click", function (e) {
        var b = e.target.closest("[data-m]"); if (!b) return;
        var ta = m.querySelector(".dzfe-all");
        if (b.dataset.m === "cancel") return closeModal();
        if (b.dataset.m === "copy") { ta.select(); try { navigator.clipboard.writeText(ta.value); } catch (x) { document.execCommand("copy"); } toast("Copié"); return; }
        try {
          var o = JSON.parse(ta.value); if (!Array.isArray(o.steps)) throw new Error("« steps » doit être une liste");
          push();
          var ids = {}; S.steps.forEach(function (s) { ids[s.name] = s.id; });
          S.steps = o.steps.map(function (s) { return { id: ids[s.name] || null, name: s.name, action_name: s.action_name, configuration: s.configuration || {}, next_step: s.next_step || "", only_if: s.only_if || "", initial_step: !!s.initial_step }; });
          ["name", "description", "when_trigger", "table"].forEach(function (k) { if (o[k] !== undefined) S.wf[k] = o[k]; });
          $(".dzfe-name").value = S.wf.name; S.layout = {}; closeModal(); changed(true); fit();
        } catch (x) { m.querySelector(".dzfe-ferr").textContent = "JSON invalide : " + x.message; }
      });
    });
  }

  /* ---------------- fenêtre ---------------- */
  function modal(html, init) { var m = $(".dzfe-modal"); m.innerHTML = '<div class="dzfe-mb">' + html + "</div>"; m.classList.add("open"); m.onclick = function (e) { if (e.target === m) closeModal(); }; init(m.firstChild); }
  function closeModal() { var m = $(".dzfe-modal"); m.classList.remove("open"); m.innerHTML = ""; }

  /* ---------------- démarrage ---------------- */
  drawPalette();
  autoLayout(false);
  drawAll();
  panel();
  status();
  setTimeout(fit, 30);
  if (!S.wf.id) { S.sel = TRIG; panel(); }
  var ok = new URLSearchParams(location.search).get("ok");
  if (ok) { toast(ok); history.replaceState(null, "", location.pathname); }
})();
