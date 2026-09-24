/* dysizz-flow : sur les pages natives des workflows Saltcorn, un raccourci vers l'éditeur visuel */
(function () {
  var m = location.pathname.match(/^\/actions\/(configure|testrun|workflow)\/(\d+)/);
  var onList = /^\/actions\/?$/.test(location.pathname);
  if (!m && !onList) return;
  function add() {
    if (document.getElementById("dzf-hook")) return;
    var a = document.createElement("a");
    a.id = "dzf-hook";
    a.href = m ? "/dysizz-flow/editeur/" + m[2] : "/dysizz-flow/workflows";
    a.innerHTML = '<i class="fas fa-project-diagram"></i> ' + (m ? "Ouvrir dans l'éditeur visuel" : "Workflows en schéma (Dysizz)");
    a.setAttribute("style", "position:fixed;right:18px;bottom:18px;z-index:3000;background:#5b5bf0;color:#fff;padding:.65rem 1rem;border-radius:99px;font-weight:600;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.2);font-size:.9rem");
    document.body.appendChild(a);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
})();
