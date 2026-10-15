// Sets html[data-preview] while a choice is hovered (mouse/pen) or focused (keyboard).
// All visual consequences live in CSS; this file only manages state.
// Touch is deliberately ignored for now: tap-and-release behaviour comes later.

const root = document.documentElement;

for (const choice of document.querySelectorAll("[data-choice]")) {
  const name = choice.dataset.choice;

  choice.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "touch") root.dataset.preview = name;
  });
  choice.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch") delete root.dataset.preview;
  });

  choice.addEventListener("focus", () => (root.dataset.preview = name));
  choice.addEventListener("blur", () => delete root.dataset.preview);
}
