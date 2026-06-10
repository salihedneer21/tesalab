/* ════════════════════════════════════════════
   TesaLab — interactions
   ════════════════════════════════════════════ */

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Mobile menu */
const nav = document.getElementById("nav");
const burger = document.getElementById("burger");
burger.addEventListener("click", () => {
  const open = nav.classList.toggle("menu-open");
  burger.setAttribute("aria-expanded", String(open));
});
document.querySelectorAll(".nav__links a").forEach((a) =>
  a.addEventListener("click", () => {
    nav.classList.remove("menu-open");
    burger.setAttribute("aria-expanded", "false");
  })
);

/* Reveal on scroll — elements are visible without JS; .js gates the hidden state */
const revealIO = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        revealIO.unobserve(e.target);
      }
    });
  },
  { threshold: 0.15 }
);
document.querySelectorAll("[data-reveal]").forEach((el) => revealIO.observe(el));

/* Telemetry counters — final values are in the HTML; animate up only with motion allowed */
if (!reduced) {
  const counterIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const target = +el.dataset.count;
        const start = performance.now();
        const dur = 1400;
        const tick = (now) => {
          const p = Math.min((now - start) / dur, 1);
          el.textContent = Math.round(target * (1 - Math.pow(1 - p, 4)));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        counterIO.unobserve(el);
      });
    },
    { threshold: 0.6 }
  );
  document.querySelectorAll("[data-count]").forEach((el) => counterIO.observe(el));
}

/* Applied-AI tabs */
const tabs = Array.from(document.querySelectorAll('.ai__tabs [role="tab"]'));
const panels = Array.from(document.querySelectorAll('.ai__panels [role="tabpanel"]'));

function selectTab(tab) {
  tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
  panels.forEach((p) => {
    const active = p.id === tab.getAttribute("aria-controls");
    p.hidden = !active;
    p.classList.toggle("entering", active);
  });
}
if (tabs.length) {
  selectTab(tabs[0]);
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (e) => {
      let next = null;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (next) {
        e.preventDefault();
        next.focus();
        selectTab(next);
      }
    });
  });
}
