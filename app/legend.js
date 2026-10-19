// The movable key on the two graph pages. A classic script, loaded right after the key's markup, so a saved
// position is in place before the graph's first camera fit. Markup:
//   <aside class="lg" data-legend="storage-key" [data-legend-below="#bar"]>
//     <div class="lg-head"> button.lg-handle  button.lg-reset  button.lg-toggle </div>
//     <div class="lg-body"> …key… </div>  <span class="lg-size"></span>
//   </aside>
// Drag the handle (mouse, touch or pen) or focus it and use the arrow keys (Shift = bigger steps); drag the corner to
// resize. Position, size and collapsed state are saved per page. On phones it is a collapsed chip that opens as a sheet.
(function () {
  "use strict";
  const PHONE = matchMedia("(max-width: 760px)"), NARROW = matchMedia("(max-width: 1100px)"), M = 8;

  document.querySelectorAll(".lg[data-legend]").forEach((panel) => {
    const key = panel.dataset.legend, below = panel.dataset.legendBelow && document.querySelector(panel.dataset.legendBelow);
    const handle = panel.querySelector(".lg-handle"), toggle = panel.querySelector(".lg-toggle");
    let s = {}; // x, y: px in the containing block; w, h: px; c: collapsed

    const load = () => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
    const save = () => { if (!PHONE.matches) try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* private mode */ } };
    // Where the panel may sit: its containing block (the map stage, or the window below the top bar).
    const area = () => {
      const cb = panel.offsetParent;
      return { l: 0, t: below ? below.offsetHeight : 0, r: cb ? cb.clientWidth : innerWidth, b: cb ? cb.clientHeight : innerHeight };
    };
    function place(x, y) {
      const a = area();
      x = Math.max(a.l + M, Math.min(x, a.r - panel.offsetWidth - M));
      y = Math.max(a.t + M, Math.min(y, a.b - panel.offsetHeight - M));
      Object.assign(panel.style, { left: x + "px", top: y + "px", right: "auto", bottom: "auto" });
    }
    const pin = () => { place(panel.offsetLeft, panel.offsetTop); s.x = panel.offsetLeft; s.y = panel.offsetTop; };
    function collapse(c) {
      panel.classList.toggle("is-collapsed", c);
      toggle.setAttribute("aria-expanded", String(!c));
      toggle.textContent = c ? "Show" : "Hide";
      toggle.setAttribute("aria-label", (c ? "Show" : "Hide") + " the key");
    }
    function apply() {
      panel.removeAttribute("style");
      s = PHONE.matches ? {} : load();
      collapse(PHONE.matches || (s.c ?? NARROW.matches));
      if (s.w) Object.assign(panel.style, { width: s.w + "px", height: s.h + "px" });
      if (s.x != null) place(s.x, s.y);
      handle.disabled = PHONE.matches;
    }

    function drag(el, onMove) {
      el.addEventListener("pointerdown", (e) => {
        if (PHONE.matches || e.button !== 0) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX, y0 = e.clientY, l = panel.offsetLeft, t = panel.offsetTop, w = panel.offsetWidth, h = panel.offsetHeight;
        let moved = false;
        const move = (ev) => {
          if (!moved) { moved = true; pin(); } // from here on it is placed by left/top, whichever corner the CSS default used
          onMove(ev.clientX - x0, ev.clientY - y0, l, t, w, h);
        };
        const end = () => {
          el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", end); el.removeEventListener("pointercancel", end);
          if (moved) save();
        };
        el.addEventListener("pointermove", move); el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
      });
    }
    drag(handle, (dx, dy, l, t) => { place(l + dx, t + dy); s.x = panel.offsetLeft; s.y = panel.offsetTop; });
    drag(panel.querySelector(".lg-size"), (dx, dy, l, t, w, h) => {
      const a = area(); // CSS min/max-width and min/max-height bound the rest
      panel.style.width = Math.min(w + dx, a.r - l - M) + "px";
      panel.style.height = Math.min(h + dy, a.b - t - M) + "px";
      s.w = panel.offsetWidth; s.h = panel.offsetHeight;
    });
    handle.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d || PHONE.matches) return;
      e.preventDefault(); e.stopPropagation(); // the arrow keys also step the influence-network story
      pin();
      const step = e.shiftKey ? 48 : 8;
      place(s.x + d[0] * step, s.y + d[1] * step);
      s.x = panel.offsetLeft; s.y = panel.offsetTop; save();
    });
    toggle.addEventListener("click", () => { s.c = !panel.classList.contains("is-collapsed"); collapse(s.c); save(); });
    panel.querySelector(".lg-reset").addEventListener("click", () => {
      s = s.c == null ? {} : { c: s.c };
      panel.removeAttribute("style");
      save();
    });

    // Keep the saved spot when the area shrinks (window resize, the map's details panel opening, the key filling in).
    const reclamp = () => { if (s.x != null && !PHONE.matches) place(s.x, s.y); };
    const ro = new ResizeObserver(reclamp);
    ro.observe(panel); ro.observe(panel.offsetParent || document.documentElement);
    PHONE.addEventListener("change", apply);
    apply();
  });
})();
