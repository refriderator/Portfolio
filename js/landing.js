// Sets html[data-preview] while a choice is hovered (mouse/pen) or focused
// (keyboard). The page colours follow it in CSS (tokens.css); the sheets
// follow it on the pixel canvas, which js/scene.js runs.
// Touch is deliberately ignored: a tap goes straight to the view.
//
// Hover and focus are tracked separately and the preview is derived from
// both. Clearing it on any single event is wrong: following a #link blurs
// the link while the pointer is still over it.

import "./scene.js";

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
//   recruiter  the float-away transition, and the recruiter page's serif, so it appears without a font swap
//              (fonts are only downloaded when something uses them)
const warmers = {
  amazed: () => import("./airplane.js"),
  recruiter: () => Promise.all([
    import("./scatter.js"),
    ...['400 1em "EB Garamond"', '500 1em "EB Garamond"', 'italic 400 1em "EB Garamond"']
      .map((font) => document.fonts.load(font)),
  ]),
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
