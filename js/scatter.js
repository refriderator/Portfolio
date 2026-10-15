// Landing → recruiter transition.
//
// Both sheets float off to their own sides (js/scene.js draws them, on the
// canvas above the page). Partway through, the recruiter page starts fading
// in underneath while the landing's masthead fades out over it, so the old
// text and the new page cross over rather than one waiting for the other.
//
// Loaded on demand: js/landing.js imports it when the recruiter sheet gets
// attention, and js/views.js calls it on the click.

import { scene } from "./scene.js";

const root = document.documentElement;
const SWAP_AT = 450;                  // ms from the click: the new page begins to fade in

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const finished = (el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));

export default async function play({ from, to, isCurrent }) {
  if (!scene) { from.hidden = true; to.hidden = false; return; }

  root.dataset.landed = "";
  scene.scatter();
  await wait(SWAP_AT);
  if (!isCurrent()) { scene.reset(); return; }

  // The landing stays on screen as an overlay, so its masthead can fade
  // while the recruiter page appears beneath it.
  from.classList.add("is-dismissing");
  from.inert = true;

  to.hidden = false;
  to.inert = false;
  to.classList.add("is-entering");
  root.dataset.switching = "";
  delete root.dataset.preview;
  root.dataset.theme = to.dataset.view;
  window.scrollTo(0, 0);
  (to.querySelector("h1[tabindex]") ?? to).focus({ preventScroll: true });

  to.offsetWidth;                     // commit opacity 0 so the fade has a start
  to.classList.remove("is-entering");
  from.classList.add("is-faded");

  await Promise.all([finished(to), finished(from), wait(1400 - SWAP_AT)]);

  from.hidden = true;
  from.classList.remove("is-dismissing", "is-faded");
  scene.reset();
  if (isCurrent()) delete root.dataset.switching;
}
