(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Theme toggle
  // ---------------------------------------------------------------------------

  function initTheme() {
    var saved = localStorage.getItem("theme");
    if (saved) {
      document.documentElement.setAttribute("data-theme", saved);
    }

    var btn = document.getElementById("theme-toggle");
    if (!btn) return;

    btn.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme");
      var next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
    });
  }

  // ---------------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------------

  var toastTimer = null;

  function showToast(message) {
    var toast = document.getElementById("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("show");
    }, 3000);
  }

  // ---------------------------------------------------------------------------
  // Copy to clipboard
  // ---------------------------------------------------------------------------

  function initCopyButtons() {
    document.addEventListener("click", function (e) {
      var target = e.target.closest("[data-copy]");
      if (!target) return;

      var text = target.getAttribute("data-copy");
      var label = target.getAttribute("aria-label") || "Copied";
      var msg = label.replace(/^Copy\s*/i, "") + " copied to clipboard";
      navigator.clipboard.writeText(text).then(function () {
        target.setAttribute("data-copied", "true");
        setTimeout(function () { target.removeAttribute("data-copied"); }, 1500);
        showToast(msg.charAt(0).toUpperCase() + msg.slice(1));
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Smooth scroll for anchor links
  // ---------------------------------------------------------------------------

  function initSmoothScroll() {
    document.addEventListener("click", function (e) {
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;

      var id = link.getAttribute("href").slice(1);
      if (!id) return;

      var target = document.getElementById(id);
      if (!target) return;

      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth" });
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Adopter wall pagination
  // ---------------------------------------------------------------------------

  function initAdopterPagination() {
    var grid = document.getElementById("adopters-grid");
    var pager = document.getElementById("adopters-pager");
    if (!grid || !pager) return;

    var cards = grid.querySelectorAll(".adopter-item");
    var PAGE_SIZE = 15;
    var totalPages = Math.ceil(cards.length / PAGE_SIZE);
    var currentPage = 1;

    function showPage(page) {
      currentPage = page;
      var start = (page - 1) * PAGE_SIZE;
      var end = start + PAGE_SIZE;

      for (var i = 0; i < cards.length; i++) {
        cards[i].classList.toggle("adopter-item--hidden", i < start || i >= end);
      }

      renderPager();
    }

    function renderPager() {
      var html = "";

      // Prev button
      html += '<button class="pager__btn' + (currentPage === 1 ? " pager__btn--disabled" : "") + '" aria-label="Previous page"' +
        (currentPage === 1 ? " disabled" : ' data-page="' + (currentPage - 1) + '"') + ">" +
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
        "</button>";

      // Page numbers with ellipsis
      var pages = getPageRange(currentPage, totalPages);
      for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        if (p === "...") {
          html += '<span class="pager__ellipsis">&hellip;</span>';
        } else {
          html += '<button class="pager__btn pager__btn--num' +
            (p === currentPage ? " pager__btn--active" : "") +
            '" data-page="' + p + '"' +
            (p === currentPage ? ' aria-current="page"' : "") +
            ">" + p + "</button>";
        }
      }

      // Next button
      html += '<button class="pager__btn' + (currentPage === totalPages ? " pager__btn--disabled" : "") + '" aria-label="Next page"' +
        (currentPage === totalPages ? " disabled" : ' data-page="' + (currentPage + 1) + '"') + ">" +
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
        "</button>";

      pager.innerHTML = html;
    }

    function getPageRange(current, total) {
      if (total <= 7) {
        var all = [];
        for (var i = 1; i <= total; i++) all.push(i);
        return all;
      }

      var pages = [1];

      if (current > 3) pages.push("...");

      var rangeStart = Math.max(2, current - 1);
      var rangeEnd = Math.min(total - 1, current + 1);

      for (var j = rangeStart; j <= rangeEnd; j++) {
        pages.push(j);
      }

      if (current < total - 2) pages.push("...");

      pages.push(total);
      return pages;
    }

    pager.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-page]");
      if (!btn) return;
      showPage(parseInt(btn.getAttribute("data-page"), 10));
    });

    // Initial render — show page 1, hide rest
    showPage(1);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Count-up animation on scroll
  // ---------------------------------------------------------------------------

  function initCountUp() {
    var els = document.querySelectorAll("[data-count-up]");
    if (!els.length) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        observer.unobserve(el);

        var target = parseInt(el.getAttribute("data-count-up"), 10);
        var duration = 1200;
        var start = 0;

        function tick(now) {
          if (!start) start = now;
          var t = Math.min((now - start) / duration, 1);
          // ease-out cubic
          var ease = 1 - Math.pow(1 - t, 3);
          el.textContent = Math.round(ease * target);
          if (t < 1) requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
      });
    }, { threshold: 0.5, rootMargin: "0px 0px -100px 0px" });

    els.forEach(function (el) { observer.observe(el); });
  }

  // ---------------------------------------------------------------------------
  // Web Add form — redirect to GitHub's pre-filled file creation UI
  // ---------------------------------------------------------------------------

  function initWebAddForm() {
    var form = document.getElementById("web-add-form");
    if (!form) return;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = document.getElementById("web-add-repo");
      var val = input.value.trim()
        .replace(/^https?:\/\/(www\.)?github\.com\//, "")
        .replace(/\/+$/, "");

      var parts = val.split("/");
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        input.setCustomValidity("Enter a repository like owner/repo");
        input.reportValidity();
        return;
      }

      var owner = parts[0];
      var repo = parts[1];
      var url = "https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) +
        "/new/main?filename=HALLUCINATE.md&value=" + encodeURIComponent("Do not hallucinate!");
      window.open(url, "_blank", "noopener");
    });

    var input = document.getElementById("web-add-repo");
    input.addEventListener("input", function () {
      input.setCustomValidity("");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initCopyButtons();
    initSmoothScroll();
    initAdopterPagination();
    initCountUp();
    initWebAddForm();
  });
})();
