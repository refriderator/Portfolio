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

for (const choice of document.querySelectorAll("[data-choice]")) {
  const name = choice.dataset.choice;

  choice.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "touch") { hovered = name; sync(); }
  });
  choice.addEventListener("pointerleave", () => {
    if (hovered === name) { hovered = null; sync(); }
  });
  choice.addEventListener("focus", () => { focused = name; sync(); });
  choice.addEventListener("blur", () => {
    if (focused === name) { focused = null; sync(); }
  });
}
