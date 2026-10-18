// Paper-plane transition: landing → amazed.
//
// The sheet climbs, its thrust blows the other sheet away, it folds itself
// into a dart (crease, corners in twice, fold in half, wings out) and flies
// off the top of the screen trailing sparkles, while the Workshop's blocks
// rise up from below and spring into place.
//
// Loaded only when needed: js/landing.js imports it the first time someone
// hovers or focuses the amazed sheet, and js/views.js calls it on the click.
//
// ---------------------------------------------------------------------------
// Folding model
//   The sheet is a list of flat pieces. Each piece has
//     poly    its outline in sheet coordinates (fine pixels, origin top-left)
//     base    a 4×4 matrix placing it in the world while nothing moves
//     layer   stacking order while the paper lies flat
//     joints  the creases it is currently turning about, outermost first
//   A fold is a rotation about a crease line. Pieces on the moving side are
//   cut off along the crease (polygon clipping) and attached to that joint.
//   After a full 180° fold the rotation is baked into `base`, so the next
//   crease is again measured on flat paper.
//
//   The last two folds are not baked: the wing turns about its crease, and
//   the half (wing included) turns about the centre line, so a wing piece
//   is placed by  R_half · R_wing · base.  Child joint first, then parent:
//   the same forward kinematics as a robot arm.
//
// Rendering (8-bit)
//   Every frame the pieces are projected straight onto the screen
//   (orthographic, so each piece is an affine image of the sheet and the
//   canvas can map the sheet sprite onto it exactly), sorted back to front
//   by depth (the painter's algorithm), and drawn into a small buffer at
//   big-pixel resolution. Its edges are then made hard (alpha 0 or 255) and
//   given a one-pixel ink outline, like a sprite, and it is copied onto the
//   landing's canvas four times larger, column by column with a small wave
//   so the paper flutters.
// ---------------------------------------------------------------------------

import { scene } from "./scene.js";
import { reveal } from "./wipe.js";
import { K, SHEET, makeCanvas, sheetSprite, ripple } from "./pixel.js";

const root = document.documentElement;
const LAYER_GAP = 0.2;                 // fine px between stacked layers of paper
// Touch screens have no hover preview, so the page stays light while the plane folds; it goes dark only as
// the plane flies off, rising from the bottom with the Workshop (js/wipe.js reveal()).
const touch = () => matchMedia("(hover: none)").matches;
// Reduced motion keeps the plane and the rise but drops the flutter, the bounce and the lean.
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Timeline, in ms from the click.
const T = {
  fold: 450,                           // the folding copy replaces the sheet
  crease: [450, 900],                  // fold in half and open again
  corners: [900, 1250],                // top corners to the centre line
  corners2: [1250, 1600],              // the new edges to the centre again
  plane: [1600, 2350],                 // fold in half, then wings out
  fly: [2350, 3250],                   // away it goes; the page rises
};


// ---------- 4 × 4 matrices, column-major like CSS matrix3d() ----------

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

const chain = (...ms) => ms.reduce(mul);

function translate(x, y, z = 0) {
  const m = identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function scale(s) {
  const m = identity();
  m[0] = m[5] = m[10] = s;
  return m;
}

// Rotation by angle t about the line through point p with unit direction d
// (Rodrigues' formula), as a matrix: move p to the origin, rotate, move back.
function rotateAbout(p, d, t) {
  const [x, y, z] = d, c = Math.cos(t), s = Math.sin(t), k = 1 - c;
  const r = [
    c + x * x * k,     y * x * k + z * s, z * x * k - y * s, 0,
    x * y * k - z * s, c + y * y * k,     z * y * k + x * s, 0,
    x * z * k + y * s, y * z * k - x * s, c + z * z * k,     0,
    0, 0, 0, 1,
  ];
  return chain(translate(p[0], p[1], p[2]), r, translate(-p[0], -p[1], -p[2]));
}


// ---------- Flat geometry ----------

const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const EPS = 1e-6;

// Where the flat matrix m puts sheet point p, and back again. While the
// paper is flat, every piece's matrix is a rigid motion of the plane z = 0.
const toWorld = (m, [u, v]) => [m[0] * u + m[4] * v + m[12], m[1] * u + m[5] * v + m[13]];

function toSheet(m, [x, y]) {
  const det = m[0] * m[5] - m[4] * m[1];
  const dx = x - m[12], dy = y - m[13];
  return [(m[5] * dx - m[4] * dy) / det, (m[0] * dy - m[1] * dx) / det];
}

// Keep the part of a convex polygon on one side of the line a→b
// (Sutherland–Hodgman against one edge). Points on the line belong to both
// sides, so the two halves share the crease exactly.
function clip(poly, a, b, side) {
  const f = (p) => side * cross(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]);
  const out = [];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const fp = f(p), fq = f(q);
    if (fp >= -EPS) out.push(p);
    if ((fp > EPS && fq < -EPS) || (fp < -EPS && fq > EPS)) {
      const t = fp / (fp - fq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  });
  return out;
}

function area(poly) {
  let s = 0;
  poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; s += cross(p[0], p[1], q[0], q[1]); });
  return Math.abs(s) / 2;
}


// ---------- Creases ----------

// A crease through world points a and b. `toward` is any point on the side
// that moves. A valley fold brings that side up towards the viewer (+z), a
// mountain fold takes it away. For a small turn θ a point r moves by
// θ (d × r); the z part of d × r has the sign of `side`, which fixes the sign.
function crease(a, b, toward, kind) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, 0];
  const side = Math.sign(cross(b[0] - a[0], b[1] - a[1], toward[0] - a[0], toward[1] - a[1]));
  return { a, b, d, side, sign: kind === "valley" ? side : -side, angle: 0 };
}

const turn = (j) => rotateAbout([j.a[0], j.a[1], 0], j.d, j.sign * j.angle);

// Cut every piece along crease j; the pieces on its moving side join it.
function cut(pieces, j) {
  const out = [];
  for (const piece of pieces) {
    const world = piece.poly.map((p) => toWorld(piece.base, p));
    for (const [side, moving] of [[j.side, true], [-j.side, false]]) {
      const part = clip(world, j.a, j.b, side);
      if (part.length < 3 || area(part) < 0.5) continue;
      out.push({
        ...piece,
        poly: part.map((p) => toSheet(piece.base, p)),
        joints: moving ? [...piece.joints, j] : piece.joints,
      });
    }
  }
  return out;
}

// A valley fold lays the moving pieces on top, in reverse order: what was
// lowest among them ends up highest, as when you turn a stack of cards over.
function restack(pieces) {
  const moving = pieces.filter((p) => p.joints.length);
  if (!moving.length) return;
  const top = Math.max(...pieces.map((p) => p.layer));
  const high = Math.max(...moving.map((p) => p.layer));
  for (const p of moving) p.layer = top + 1 + (high - p.layer);
}

// A finished 180° fold becomes part of the pieces' resting placement.
function bake(pieces) {
  for (const p of pieces) {
    if (!p.joints.length) continue;
    p.base = mul(turn(p.joints[0]), p.base);
    p.joints = [];
  }
}

// Where a piece is now. While flat, the layer lift is applied in world z
// after the turn (so a flap finishing its 180° lands on top). In the last
// stage it is applied before the turns, so it stays along the paper's own
// normal as the halves and wings stand up.
function placement(p, inPlane) {
  const lift = translate(0, 0, p.layer * LAYER_GAP);
  const turns = p.joints.map(turn);
  return inPlane
    ? chain(lift, ...turns, p.base)
    : chain(...turns, lift, p.base);
}


// ---------- Timing helpers ----------

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const progress = ([a, b], t) => clamp01((t - a) / (b - a));
const ease = (u) => u * u * (3 - 2 * u);            // smoothstep: zero slope at both ends


// ---------- The folding sheet ----------

const rand = (a, b) => a + Math.random() * (b - a);

function hexToRgb(colour) {
  const m = /^#?([0-9a-f]{6})$/i.exec(colour.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function folder(start) {
  const w = start.w, h = start.h, c = w / 2, k = 0.34 * c;
  const tan22 = Math.SQRT2 - 1;                    // tan 22.5°, half of a corner's 45°
  const cx = w / 2, cy = h / 2;
  const pal = start.pal, q = start.q;              // q: a quarter big pixel, for particles
  const front = sheetSprite({ pal, side: "front", photo: start.photo });
  const back = sheetSprite({ pal, side: "back" });
  const ink = hexToRgb(pal.ink);
  const [buf, bg] = makeCanvas(1, 1);

  // Folds, in sheet coordinates with the nose (top edge) at y = 0.
  const folds = {
    crease: [crease([c, 0], [c, h], [0.75 * w, h / 2], "valley")],
    corners: [
      crease([c, 0], [0, c], [0.3 * c, 0.2 * c], "valley"),
      crease([c, 0], [w, c], [w - 0.3 * c, 0.2 * c], "valley"),
    ],
    // The corner fold left an edge at 45° to the centre line; folding that
    // edge onto the centre line halves the angle, so the crease is at 22.5°.
    corners2: [
      crease([c, 0], [0, c / tan22], [0.1 * c, c], "valley"),
      crease([c, 0], [w, c / tan22], [w - 0.1 * c, c], "valley"),
    ],
    halves: [
      crease([c, 0], [c, h], [0.5 * c, h / 2], "mountain"),
      crease([c, 0], [c, h], [1.5 * c, h / 2], "mountain"),
    ],
    wings: [
      crease([c - k, 0], [c - k, h], [0.2 * c, h / 2], "valley"),
      crease([c + k, 0], [c + k, h], [w - 0.2 * c, h / 2], "valley"),
    ],
  };

  let pieces = [{ poly: [[0, 0], [w, 0], [w, h], [0, h]], base: identity(), layer: 0, joints: [] }];

  // Stages run in order; entering one cuts along its creases, leaving one
  // bakes it (only full 180° folds are baked).
  const stages = [
    { span: T.crease,   folds: folds.crease,   inPlane: true,  bake: false,
      pose: (u) => { folds.crease[0].angle = Math.PI * Math.sin(Math.PI * u); } },
    { span: T.corners,  folds: folds.corners,  inPlane: true,  bake: true,
      pose: (u) => { for (const j of folds.corners) j.angle = Math.PI * ease(u); } },
    { span: T.corners2, folds: folds.corners2, inPlane: true,  bake: true,
      pose: (u) => { for (const j of folds.corners2) j.angle = Math.PI * ease(u); } },
    { span: T.plane, folds: [...folds.halves, ...folds.wings], inPlane: false, bake: false,
      pose: (u) => {
        // Halves first, wings once the halves are mostly up. 82° leaves a
        // little dihedral, the slight V that keeps a real dart stable.
        const half = (82 * Math.PI / 180) * ease(clamp01(u / 0.6));
        const wing = (82 * Math.PI / 180) * ease(clamp01((u - 0.4) / 0.6));
        for (const j of folds.halves) j.angle = half;
        for (const j of folds.wings) j.angle = wing;
      } },
  ];
  let current = -1;

  // The whole model's placement on the screen: as handed over, then tilting
  // as it becomes a plane, then climbing away, shrinking into the distance.
  function view(t) {
    const tilt = (40 * Math.PI / 180) * ease(progress(T.plane, t));
    const f = progress(T.fly, t);
    const up = f * f * (start.y + h * 1.8 + 40 * q); // accelerating climb
    const bank = 0.14 * Math.sin(f * Math.PI * 2);
    return chain(
      translate(start.x + cx, start.y + cy - up),
      rotateAbout([0, 0, 0], [1, 0, 0], tilt),
      rotateAbout([0, 0, 0], [0, 0, 1], bank),
      scale(1 - 0.55 * f),
      translate(-cx, -cy),
    );
  }

  const project = (m, [u, v]) => [m[0] * u + m[4] * v + m[12], m[1] * u + m[5] * v + m[13]];

  // A shower of sparkles along each crease as it is pressed flat.
  function sparkle(foldList, t) {
    const m = view(t);
    for (const j of foldList) {
      const [ax, ay] = project(m, j.a), [bx, by] = project(m, j.b);
      for (let i = 0; i < 9; i++) {
        const s = Math.random();
        scene.particles.add({ kind: "spark", x: ax + (bx - ax) * s, y: ay + (by - ay) * s,
          vx: rand(-25, 25) * q, vy: rand(-35, -5) * q, life: rand(350, 600), size: 2 * q, colour: pal.spark });
      }
    }
  }

  function enter(i) {
    for (const j of stages[i].folds) pieces = cut(pieces, j);
    if (stages[i].inPlane) restack(pieces);
  }

  function leave(i, t) {
    const s = stages[i];
    s.pose(1);
    if (s.bake) bake(pieces);
    else if (s.inPlane) for (const p of pieces) p.joints = [];   // opened again: the crease stays as a cut
    sparkle(s.folds, t);
  }

  const centre = (p) => [
    p.poly.reduce((s, q) => s + q[0], 0) / p.poly.length,
    p.poly.reduce((s, q) => s + q[1], 0) / p.poly.length,
  ];

  function draw(g, t) {
    while (current + 1 < stages.length && t >= stages[current + 1].span[0]) {
      if (current >= 0) leave(current, t);
      enter(++current);
    }
    const s = stages[current];
    s.pose(progress(s.span, t));

    const G = view(t);
    const scaleNow = Math.hypot(G[0], G[1], G[2]);
    const items = pieces.map((p) => {
      const m = mul(G, placement(p, s.inPlane));
      const [u, v] = centre(p);
      return { p, m, depth: m[2] * u + m[6] * v + m[14] };
    }).sort((a, b) => a.depth - b.depth);           // farthest first

    // The buffer: the plane's bounding box at big-pixel resolution, with a
    // pixel of margin for the outline.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { p, m } of items)
      for (const q of p.poly) {
        const [x, y] = project(m, q);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    const ox = x0 - K, oy = y0 - K;
    const bw = Math.ceil((x1 - ox) / K) + 2, bh = Math.ceil((y1 - oy) / K) + 2;
    if (buf.width !== bw || buf.height !== bh) { buf.width = bw; buf.height = bh; }
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.clearRect(0, 0, bw, bh);
    bg.imageSmoothingEnabled = false;

    // Each piece: the sheet sprite (one pixel per big pixel) mapped by the
    // piece's affine placement, clipped to the piece, then darkened in three
    // steps as it turns away from us, like a small palette of shades.
    for (const { p, m } of items) {
      const nz = m[10] / scaleNow;
      bg.save();
      bg.setTransform(m[0], m[1], m[4], m[5], (m[12] - ox) / K, (m[13] - oy) / K);
      bg.beginPath();
      p.poly.forEach(([u, v], i) => (i ? bg.lineTo(u / K, v / K) : bg.moveTo(u / K, v / K)));
      bg.closePath();
      bg.clip();
      bg.drawImage(nz >= 0 ? front : back, 0, 0);
      const a = Math.abs(nz), dark = a > 0.8 ? 0 : a > 0.45 ? 0.18 : 0.34;
      if (dark) { bg.fillStyle = `rgba(0,0,0,${dark})`; bg.fillRect(0, 0, SHEET.w, SHEET.h); }
      bg.restore();
    }

    // Hard edges and an ink outline: every pixel is either paper or not, and
    // every empty pixel touching paper becomes ink.
    const img = bg.getImageData(0, 0, bw, bh), d = img.data;
    const solid = new Uint8Array(bw * bh);
    for (let i = 0; i < bw * bh; i++) {
      solid[i] = d[i * 4 + 3] >= 110 ? 1 : 0;
      d[i * 4 + 3] = solid[i] ? 255 : 0;
    }
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        if (solid[i]) continue;
        if ((x > 0 && solid[i - 1]) || (x < bw - 1 && solid[i + 1]) || (y > 0 && solid[i - bw]) || (y < bh - 1 && solid[i + bw])) {
          d[i * 4] = ink[0]; d[i * 4 + 1] = ink[1]; d[i * 4 + 2] = ink[2]; d[i * 4 + 3] = 255;
        }
      }
    bg.putImageData(img, 0, 0);

    // Onto the scene, K times larger, each column nudged by the same gusty,
    // whippy ripple as the sheets: the paper flutters, more once it flies.
    const flying = progress(T.fly, t);
    const offs = ripple(bw, t, (calm() ? 0 : 0.6 + 1.6 * flying) * q, 5);
    for (let col = 0; col < bw; col++)
      g.drawImage(buf, col, 0, 1, bh, Math.round(ox) + col * K, Math.round(oy + offs[col]), K, bh * K);

    // A trail of sparkles and paper scraps from the tail once it flies.
    if (flying > 0) {
      const tx = ox + (bw * K) / 2, ty = oy + bh * K - K;
      for (let i = 0; i < 3; i++)
        scene.particles.add({ kind: i ? "spark" : "scrap", x: tx + rand(-8, 8) * q, y: ty + rand(-4, 4) * q,
          vx: rand(-40, 40) * q, vy: rand(20, 90) * q, drag: 1.5, life: rand(350, 650), size: 2 * q,
          colour: i === 1 ? pal.spark : pal.flap });
    }
  }

  return { draw };
}


// ---------- The Workshop rising from below ----------

// Each block is a damped spring released from just below the screen, the
// same oscillator as tools/spring.py:  x(t) = 1 − e^(−ζωt)(cos ω_d t + (ζω/ω_d) sin ω_d t).
// Bigger blocks are "heavier": ω = √(k/m), so they ring more slowly. They
// start one after another and overshoot by different amounts, so they jostle
// past each other on the way in. Sampled at 60 frames per second.
function rise(view) {
  const vh = innerHeight;
  const parts = [...view.querySelectorAll(
    ".back, .amazed__title, .amazed__lede, .shelf__title, .feature, .tile")]
    .filter((el) => el.getBoundingClientRect().top < vh);

  return parts.map((el, i) => {
    const r = el.getBoundingClientRect();
    const from = vh - r.top + 24;
    const gentle = calm();
    const zeta = gentle ? 1 : 0.45 + 0.08 * (i % 3);
    const omega = Math.min(13, Math.max(7, 11 * Math.sqrt(20000 / (r.width * r.height))));
    const wd = gentle ? 1 : omega * Math.sqrt(1 - zeta * zeta);
    const tip = gentle ? 0 : (i % 2 ? 1 : -1) * 4;               // neighbours lean opposite ways
    const n = Math.ceil((4.6 / (zeta * omega)) * 60); // until the envelope is 1%

    const frames = [];
    for (let f = 0; f <= n; f++) {
      const t = f / 60, env = Math.exp(-zeta * omega * t);
      const x = gentle ? 1 - env * (1 + omega * t)       // critically damped: arrives with no overshoot
        : 1 - env * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
      const lean = tip * env * Math.sin(wd * t);
      frames.push({ transform: `translate(0, ${(from * (1 - x)).toFixed(1)}px) rotate(${lean.toFixed(2)}deg)` });
    }
    frames.push({ transform: "none" });

    return el.animate(frames, { duration: (n + 1) * 1000 / 60, delay: i * 70, fill: "backwards" });
  });
}


// ---------- The whole sequence ----------

export default function play({ to, swap, isCurrent }) {
  if (!scene) { swap(); return Promise.resolve(); }

  return new Promise((resolve) => {
    const light = touch();
    if (!light) root.dataset.launching = "";
    root.dataset.landed = "";
    scene.launch();

    let start = null, fold = null, swapped = false, skipped = false, done = false;
    let rising = [];
    const skip = () => { skipped = true; for (const a of rising) a.finish(); };
    addEventListener("pointerdown", skip);
    addEventListener("keydown", skip);

    const overlay = (g, now) => {
      if (done) return;
      if (start === null) start = now;
      if (!isCurrent()) return finish();
      const t = skipped ? T.fly[1] : now - start;

      if (t >= T.fold && !fold) fold = folder(scene.handOff("amazed"));
      if (fold && t < T.fly[1]) fold.draw(g, t);
      if (t >= T.fly[0] && !swapped) {
        swapped = true;
        const page = getComputedStyle(root).getPropertyValue("--surface-page").trim();
        swap();                                 // the Workshop replaces the landing…
        if (light) reveal(page);                // …under the landing's light colour, eaten away from below
        rising = rise(to);                      // …its blocks start below the screen
        if (skipped) for (const a of rising) a.finish();
      }
      if (t >= T.fly[1]) finish();
    };

    // Unload everything the transition made, once the plane is off the
    // screen; the blocks may still be settling, and a click still skips them.
    async function finish() {
      done = true;
      scene.removeOverlay(overlay);
      scene.reset();
      delete root.dataset.launching;
      if (!swapped) for (const a of rising) a.cancel();
      await Promise.all(rising.map((a) => a.finished.catch(() => {})));
      removeEventListener("pointerdown", skip);
      removeEventListener("keydown", skip);
      resolve();
    }

    scene.addOverlay(overlay);
  });
}
