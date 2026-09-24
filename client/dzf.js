/* dysizz-flow — script des pages d'administration (aucune dépendance). */
(function () {
  "use strict";
  var doc = document;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  /* recherche dans la bibliothèque */
  window.dzfSearch = function (q) {
    q = String(q || "").toLowerCase().trim();
    doc.querySelectorAll(".dzf-cat").forEach(function (sec) {
      var any = false;
      sec.querySelectorAll(".dzf-card").forEach(function (c) { var ok = !q || (c.getAttribute("data-search") || "").indexOf(q) >= 0; c.hidden = !ok; if (ok) any = true; });
      sec.hidden = !any && !!q;
    });
  };

  /* essai d'un bloc */
  window.dzfTry = function (btn) {
    var box = btn.closest(".dzf-try"), out = box.querySelector("[data-out]");
    out.textContent = "…";
    out.className = "dzf-out";
    fetch("/dysizz-flow/essayer", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "CSRF-Token": (doc.getElementById("dzf-csrf") || {}).value || window._sc_globalCsrf || "" },
      body: JSON.stringify({ bloc: box.getAttribute("data-bloc"), cfg: box.querySelector("[data-cfg]").value, ctx: box.querySelector("[data-ctx]").value }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      out.className = "dzf-out " + (j.error ? "ko" : "ok");
      out.textContent = j.error ? "Erreur (" + (j.ms || 0) + " ms) : " + j.error : "OK en " + j.ms + " ms\n\nSortie :\n" + JSON.stringify(j.sortie, null, 2);
    }).catch(function (e) { out.className = "dzf-out ko"; out.textContent = e.message; });
  };

  /* éditeur des réglages d'un bloc perso */
  var holder = doc.querySelector("[data-params]");
  var form = holder && holder.closest("form");
  var types = window.__dzfTypes || [];
  function rowHtml(p) {
    return '<div class="dzf-prm">' +
      '<input class="form-control" data-k="name" placeholder="nom" value="' + esc(p.name) + '">' +
      '<input class="form-control" data-k="label" placeholder="libellé" value="' + esc(p.label) + '">' +
      '<select class="form-select" data-k="type">' + types.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === (p.type || "texte") ? " selected" : "") + ">" + esc(t[1]) + "</option>"; }).join("") + "</select>" +
      '<input class="form-control" data-k="default" placeholder="par défaut" value="' + esc(typeof p.default === "object" ? JSON.stringify(p.default) : p.default) + '">' +
      '<input class="form-control" data-k="options" placeholder="choix (a,b,c)" value="' + esc([].concat(p.options || []).join(",")) + '">' +
      '<input class="form-control" data-k="help" placeholder="aide" value="' + esc(p.help) + '">' +
      '<label class="dzf-req-l"><input type="checkbox" data-k="required"' + (p.required ? " checked" : "") + "> requis</label>" +
      '<button type="button" class="btn btn-sm btn-link" title="Monter" onclick="dzfMove(this,-1)">↑</button>' +
      '<button type="button" class="btn btn-sm btn-link text-danger" title="Retirer" onclick="this.parentNode.remove()">✕</button></div>';
  }
  if (holder && form) {
    var initial = [];
    try { initial = JSON.parse(form.querySelector("[name=params]").value || "[]"); } catch (e) { initial = []; }
    holder.innerHTML = initial.map(rowHtml).join("");
  }
  window.dzfAddParam = function () { holder.insertAdjacentHTML("beforeend", rowHtml({ type: "texte" })); };
  window.dzfMove = function (b, d) { var r = b.parentNode, s = d < 0 ? r.previousElementSibling : r.nextElementSibling; if (s) r.parentNode.insertBefore(r, d < 0 ? s : s.nextSibling); };
  window.dzfBeforeSave = function (f) {
    var list = [];
    f.querySelectorAll(".dzf-prm").forEach(function (r) {
      var p = {};
      r.querySelectorAll("[data-k]").forEach(function (i) { p[i.getAttribute("data-k")] = i.type === "checkbox" ? i.checked : i.value; });
      if (p.name) list.push(p);
    });
    f.querySelector("[name=params]").value = JSON.stringify(list);
    return true;
  };

  /* tabulation dans le code */
  doc.querySelectorAll(".dzf-codearea").forEach(function (t) {
    t.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      e.preventDefault();
      var s = t.selectionStart, en = t.selectionEnd;
      t.value = t.value.slice(0, s) + "  " + t.value.slice(en);
      t.selectionStart = t.selectionEnd = s + 2;
    });
  });
})();
