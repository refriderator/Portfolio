// Sets html[data-preview] while a choice is hovered (mouse/pen) or focused (keyboard).
// All visual consequences live in CSS; this file only manages state.
// Touch is deliberately ignored: a tap goes straight to the view.
//
// Hover and focus are tracked separately and the preview is derived from
// both. Clearing it on any single event is wrong: following a #link blurs
// the link while the pointer is still over it.

const root = document.documentElement;
let hovered = null;
let focused = null;

function sync() {
  const name = focused ?? hovered;
  if (name) root.dataset.preview = name;
  else delete root.dataset.preview;
}

// Warm what the next step will need, once, when someone shows interest in
// a sheet (hover, focus or touch), and not before: most visitors pick one.
//   amazed     the paper-plane transition module
//   recruiter  the recruiter page's serif, so it appears without a font swap
//              (fonts are only downloaded when something uses them)
const warmers = {
  amazed: () => import("./airplane.js"),
  recruiter: () => Promise.all(
    ['400 1em "EB Garamond"', '500 1em "EB Garamond"', 'italic 400 1em "EB Garamond"']
      .map((font) => document.fonts.load(font))),
};
const warmed = new Set();

function warm(name) {
  if (warmed.has(name) || !warmers[name]) return;
  warmed.add(name);
  warmers[name]().catch(() => warmed.delete(name));   // try again next time
}

for (const choice of document.querySelectorAll("[data-choice]")) {
  const name = choice.dataset.choice;

  choice.addEventListener("pointerenter", (e) => {
    warm(name);
    if (e.pointerType !== "touch") { hovered = name; sync(); }
  });
  choice.addEventListener("pointerleave", () => {
    if (hovered === name) { hovered = null; sync(); }
  });
  choice.addEventListener("focus", () => { warm(name); focused = name; sync(); });
  choice.addEventListener("blur", () => {
    if (focused === name) { focused = null; sync(); }
  });
}

// Intro: the papers fall once per page load. When the last one lands, mark
// it so the intro does not replay on returning from another view. If the
// landing is hidden mid-fall (someone clicks through fast), the animation is
// cancelled rather than ended; that counts too. Under reduced motion the
// intro never runs, so mark it straight away.
const lastDrop = document.querySelector(".choice--amazed .choice__drop");
const landed = () => (root.dataset.landed = "");

if (!lastDrop || matchMedia("(prefers-reduced-motion: reduce)").matches) {
  landed();
} else {
  for (const type of ["animationend", "animationcancel"]) {
    lastDrop.addEventListener(type, (e) => {
      if (e.target === lastDrop && e.animationName === "drop") landed();
    });
  }
}
