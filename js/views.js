// Shows one view at a time and runs the transition between them.
// The URL hash decides the view: a hash that names an element inside a view
// (#recruiter, #team-ol, #some-post) selects that view; anything else, the
// landing. So every view and every post has a shareable link, and the
// browser's back button works without any history code here.
//
// Sequence when the view changes:
//   1. fade the old view out                (--fade-out)
//   2. hide it, show the new one at opacity 0, set the new theme;
//      the colours start their slow change (--switch-duration)
//   3. fade the new view in, starting partway through the colour change
//                                           (--fade-in after --fade-in-delay)
//
// Some pairs of views have their own transition instead (see `special`).

const root = document.documentElement;
const views = [...document.querySelectorAll("[data-view]")];
const fallback = views.find((v) => v.dataset.view === "landing");

// Each view's theme is its name, except the landing, which uses the base tokens.
const themeOf = (view) => (view === fallback ? null : view.dataset.view);

// Transitions of their own, by "from>to". Each is a module loaded on demand;
// js/landing.js starts loading it as soon as someone shows interest, so by
// the click it is normally ready.
const special = {
  "landing>amazed": () => import("./airplane.js"),
};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

let current = views.find((v) => !v.hidden) ?? fallback;
let generation = 0; // bumps on every change, so a superseded change stops

function target() {
  const id = decodeURIComponent(location.hash.slice(1));
  return id ? document.getElementById(id) : null;
}

function viewFor(el) {
  return el?.closest("[data-view]") ?? fallback;
}

function finished(el) {
  return Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
}

function setTheme(view) {
  const theme = themeOf(view);
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
}

// Show `next` and hide the rest at once, with no colour transition.
function swapNow(next, el) {
  delete root.dataset.preview;
  for (const v of views) {
    v.hidden = v !== next;
    v.inert = v !== next;
    v.classList.remove("is-leaving");
  }
  // Apply the new state with every transition off, then turn them back on
  // two frames later, once the browser has painted the new colours.
  root.dataset.instant = "";
  setTheme(next);
  settle(next, el);
  requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.instant));
}

function settle(next, el) {
  // Scroll to the linked element, or to the top when the link is the view itself.
  if (el && el !== next) el.scrollIntoView();
  else window.scrollTo(0, 0);
  (next.querySelector("h1[tabindex]") ?? next).focus({ preventScroll: true });
}

async function show(animate) {
  const el = target();
  const next = viewFor(el);
  if (next === current) {
    if (el && el !== next) el.scrollIntoView({ behavior: animate ? "smooth" : "auto" });
    return;
  }

  const gen = ++generation;
  const prev = current;
  current = next;
  const isCurrent = () => gen === generation;

  const own = special[`${prev.dataset.view}>${next.dataset.view}`];
  if (animate && own && !reducedMotion.matches) {
    const { default: play } = await own();
    if (!isCurrent()) return;
    await play({ from: prev, to: next, swap: () => swapNow(next, el), isCurrent });
    return;
  }

  if (animate) {
    prev.classList.add("is-leaving");
    await finished(prev);
    if (gen !== generation) return;
  }

  // The hover preview stays on while the old view fades; it is dropped here,
  // in the same frame as the new theme, so the colours move only once.
  delete root.dataset.preview;
  for (const v of views) {
    v.hidden = v !== next;
    v.inert = v !== next;
    v.classList.remove("is-leaving");
  }

  if (!animate) {
    swapNow(next, el);
    return;
  }

  next.classList.add("is-entering");
  root.dataset.switching = "";
  setTheme(next);
  settle(next, el);

  next.offsetWidth; // commit opacity 0 so the fade-in has a start point
  next.classList.remove("is-entering");

  await finished(root);
  if (gen === generation) delete root.dataset.switching;
}

for (const v of views) v.inert = v !== current;
show(false);
window.addEventListener("hashchange", () => show(true));
