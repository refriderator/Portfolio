// The landing's darkening for the amazed preview: navy rises from the
// bottom of the page as an ordered-dither front, in the landing's big
// pixels. When the preview ends the light comes back the same way, rising
// from the bottom, so the dark lifts off the top of the page.
//
// It is drawn on its own canvas behind the page's text (z-index -1), so
// the masthead stays on top. The theme's own colours wait for it
// (css/landing.css): going dark, the page colour changes only once the
// wipe covers everything, and the text once the front has passed it;
// going back, everything changes at once underneath, and the wipe sinking
// away reveals it.
//
// Front, in big pixels up from the bottom of the screen, for column c:
//   h(c) = p · (rows + 2·BAND + 3) − BAND + wave(c, t)
// A cell r rows up is dark when 16 · (h − r) / BAND beats its Bayer
// threshold, so the band just under the front is a dither ramp from
// sparse to solid, and the wave makes the front roll like a tide.

import { scene } from "./scene.js";
import { K, bayer } from "./pixel.js";

const root = document.documentElement;
const landing = document.querySelector('[data-view="landing"]');
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const BAND = 7;                 // rows in the dither ramp
const RISE = 520;               // ms for a full cover or uncover

const canvas = document.createElement("canvas");
canvas.className = "dither-wipe";
canvas.setAttribute("aria-hidden", "true");
const g = canvas.getContext("2d");

let p = 0, target = 0, rising = true, last = 0, running = false, cell = 16, colour = "#000";

const wanted = () =>
  !landing.hidden && (root.dataset.preview === "amazed" || root.dataset.launching !== undefined);

function size() {
  cell = scene ? K * scene.f : 16;              // the sheets' big pixel, in CSS px
  canvas.width = Math.ceil(innerWidth / cell);
  canvas.height = Math.ceil(innerHeight / cell);
  canvas.style.width = `${canvas.width * cell}px`;
  canvas.style.height = `${canvas.height * cell}px`;
  colour = getComputedStyle(root).getPropertyValue("--navy-950").trim() || "#050a1a";
}

function draw(t) {
  const cols = canvas.width, rows = canvas.height;
  g.clearRect(0, 0, cols, rows);
  if (p <= 0) return;
  g.fillStyle = colour;
  const span = rows + 2 * BAND + 3;                   // at the ends the whole ramp is off screen
  for (let c = 0; c < cols; c++) {
    const wave = 1.6 * Math.sin(c * 0.31 + t / 260) + 0.9 * Math.sin(c * 0.11 - t / 410);
    if (rising) {
      // Dark below the front, which climbs as p grows.
      const h = p * span - BAND + wave;
      const solid = Math.max(0, Math.min(rows, Math.floor(h - BAND)));
      if (solid) g.fillRect(c, rows - solid, 1, solid);                // below the ramp: one rect
      for (let r = solid; r < Math.min(rows, Math.ceil(h)); r++) {
        if ((16 * (h - r)) / BAND > bayer(c, r) + 0.5) g.fillRect(c, rows - 1 - r, 1, 1);
      }
    } else {
      // Light below the front, which climbs as p falls; the dark is what is left above it.
      const h = (1 - p) * span - BAND + wave;
      const clear = Math.max(0, Math.ceil(h + BAND));
      if (clear < rows) g.fillRect(c, 0, 1, rows - clear);             // above the ramp: one rect
      for (let r = Math.max(0, Math.floor(h)); r < Math.min(rows, clear); r++) {
        if ((16 * (r - h)) / BAND > bayer(c, r) + 0.5) g.fillRect(c, rows - 1 - r, 1, 1);
      }
    }
  }
}

function frame(t) {
  const dt = Math.min(50, t - last);
  last = t;
  const step = dt / RISE;
  p = target > p ? Math.min(target, p + step) : Math.max(target, p - step);
  if (reduced()) p = target;
  draw(t);
  if (p === target && (p === 0 || p === 1)) {
    running = false;
    if (p === 0) canvas.hidden = true;
    if (root.dataset.wipe === "out") delete root.dataset.wipe;
    return;
  }
  requestAnimationFrame(frame);
}

function sync() {
  const next = wanted() ? 1 : 0;
  if (next === target) return;
  // Going back: every colour flips at once, hidden under the wipe, which then sinks to reveal it.
  if (next === 0 && p > 0) root.dataset.wipe = "out";
  else delete root.dataset.wipe;
  target = next;
  rising = next === 1;
  if (next === 1 && p === 0) size();
  canvas.hidden = false;
  if (!running) {
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
}

if (landing) {
  canvas.hidden = true;
  document.body.prepend(canvas);
  addEventListener("resize", () => { if (!canvas.hidden) { size(); draw(performance.now()); } });
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-preview", "data-launching"] });
  new MutationObserver(() => {
    if (landing.hidden) { p = target = 0; canvas.hidden = true; delete root.dataset.wipe; }   // the Workshop is dark already
  }).observe(landing, { attributes: true, attributeFilter: ["hidden"] });
}
