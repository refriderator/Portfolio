// Paper-plane transition: landing → amazed.
//
// The sheet climbs, its thrust blows the other sheet away, it folds itself
// into a dart (crease, corners in twice, fold in half, wings out) and flies
// off the top of the screen, while the Workshop's blocks rise up from below
// and spring into place.
//
// Loaded only when needed: js/landing.js imports it the first time someone
// hovers or focuses the amazed sheet, and js/views.js calls it on the click.
//
// ---------------------------------------------------------------------------
// Folding model
//   The sheet is a list of flat pieces. Each piece has
//     poly    its outline in sheet coordinates (CSS px, origin top-left)
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
// Rendering
//   Every piece is a copy of the sheet's DOM, clipped to its polygon
//   (clip-path) and placed by matrix3d() under one perspective. The pieces
//   are not put in a shared 3D scene (preserve-3d): browsers depth-sort
//   those by each element's whole box, and a piece's box is the whole sheet,
//   mostly clipped away, which sorts wrongly. Instead each piece is drawn
//   flat in an order computed here, back to front by the depth of its
//   centre (the painter's algorithm), which is exact for paper this simple.
//   Frames are quantised to 12 per second, like a sprite, and every frame is
//   a pure function of time, so skipping to the end is just drawing the last.
// ---------------------------------------------------------------------------

const root = document.documentElement;
const FPS = 12;
const LAYER_GAP = 0.6;                 // px between stacked layers of paper

// Timeline, in ms from the click.
const T = {
  blow: 150,                           // the other sheet is blown away
  fold: 450,                           // the flat copy replaces the sheet
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
const snap = (x, px) => Math.round(x / px) * px;


// ---------- The folding sheet ----------

function folder(sheetEl, rect, px) {
  const w = rect.width, h = rect.height, c = w / 2, k = 0.34 * c;
  const tan22 = Math.SQRT2 - 1;                    // tan 22.5°, half of a corner's 45°

  // The sheet's take-off lift, in sheet pixels (1/28 of its width), to
  // match .is-launching in landing.css.
  const cx = w / 2, cy = h / 2, pp = w / 28;
  const lift = { x: -pp, y: -3 * pp, s: 1.14 };

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

  // DOM: a fixed stage over the sheet's spot, with the perspective; one
  // clipped copy of the sheet per piece.
  const stage = document.createElement("div");
  stage.className = "fold-stage";
  Object.assign(stage.style, {
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${w}px`, height: `${h}px`,
  });
  document.body.append(stage);

  let pieces = [{ poly: [[0, 0], [w, 0], [w, h], [0, h]], base: identity(), layer: 0, joints: [] }];
  let els = [];

  function rebuild() {
    for (const el of els) el.remove();
    els = pieces.map((p) => {
      const el = sheetEl.cloneNode(true);
      el.classList.add("fold-face");
      el.style.clipPath = `polygon(${p.poly.map(([u, v]) => `${u}px ${v}px`).join(", ")})`;
      stage.append(el);
      return el;
    });
  }

  // A piece's centre, for depth sorting.
  const centre = (p) => [
    p.poly.reduce((s, q) => s + q[0], 0) / p.poly.length,
    p.poly.reduce((s, q) => s + q[1], 0) / p.poly.length,
  ];

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

  function enter(i) {
    for (const j of stages[i].folds) pieces = cut(pieces, j);
    if (stages[i].inPlane) restack(pieces);
    rebuild();
  }

  function leave(i) {
    const s = stages[i];
    s.pose(1);
    if (s.bake) bake(pieces);
    else if (s.inPlane) for (const p of pieces) p.joints = [];   // opened again: the crease stays as a cut
  }

  // The whole model's placement: lift, then the tilt as it becomes a plane,
  // then the flight away and up off the screen.
  function view(t) {
    const tilt = (40 * Math.PI / 180) * ease(progress(T.plane, t));
    const f = progress(T.fly, t);
    const up = f * f * (rect.top + h * 1.2 + 200);   // accelerating climb
    const away = -700 * f;                           // and into the distance
    const bank = 0.12 * Math.sin(f * Math.PI * 2);
    return chain(
      translate(cx + lift.x, cy + lift.y - up, away),
      rotateAbout([0, 0, 0], [1, 0, 0], tilt),
      rotateAbout([0, 0, 0], [0, 0, 1], bank),
      scale(lift.s),
      translate(-cx, -cy),
    );
  }

  function draw(t) {
    // Advance through the stages this frame has reached.
    while (current + 1 < stages.length && t >= stages[current + 1].span[0]) {
      if (current >= 0) leave(current);
      enter(++current);
    }
    const s = stages[current];
    s.pose(progress(s.span, t));

    const g = view(t);
    const placed = pieces.map((p, i) => {
      const m = mul(g, placement(p, s.inPlane));
      const [u, v] = centre(p);
      return { el: els[i], m, depth: m[2] * u + m[6] * v + m[14] };
    });
    placed.sort((a, b) => a.depth - b.depth);         // farthest first
    placed.forEach(({ el, m }, order) => {
      el.style.transform = `matrix3d(${m.map((n) => +n.toFixed(4)).join(",")})`;
      el.style.zIndex = order;
      // Which side faces us: the z part of the sheet's normal after placing.
      el.classList.toggle("is-back", m[10] < 0);
    });
  }

  return { draw, remove: () => stage.remove() };
}


// ---------- The Workshop rising from below ----------

// Each block is a damped spring released from just below the screen, the
// same oscillator as tools/spring.py:  x(t) = 1 − e^(−ζωt)(cos ω_d t + (ζω/ω_d) sin ω_d t).
// Bigger blocks are "heavier": ω = √(k/m), so they ring more slowly. They
// start one after another and overshoot by different amounts, so they jostle
// past each other on the way in. Frames are 12 per second, positions snap
// to the pixel grid.
function rise(view, px) {
  const vh = innerHeight;
  const parts = [...view.querySelectorAll(
    ".back, .amazed__title, .amazed__lede, .shelf__title, .feature, .tile")]
    .filter((el) => el.getBoundingClientRect().top < vh);

  return parts.map((el, i) => {
    const r = el.getBoundingClientRect();
    const from = vh - r.top + 4 * px;
    const zeta = 0.5 + 0.08 * (i % 3);
    const omega = Math.min(13, Math.max(7, 11 * Math.sqrt(20000 / (r.width * r.height))));
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const tip = (i % 2 ? 1 : -1) * 3;               // neighbours lean opposite ways
    const n = Math.ceil((4.6 / (zeta * omega)) * FPS); // until the envelope is 1%

    const frames = [];
    for (let f = 0; f <= n; f++) {
      const t = f / FPS, env = Math.exp(-zeta * omega * t);
      const x = 1 - env * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
      const y = snap(from * (1 - x), px);
      const lean = +(tip * env * Math.sin(wd * t)).toFixed(2);
      frames.push({ transform: `translate(0, ${y}px) rotate(${lean}deg)`, easing: "steps(1, end)" });
    }
    frames.push({ transform: "none" });

    return el.animate(frames, { duration: (n + 1) * 1000 / FPS, delay: i * 70, fill: "backwards" });
  });
}


// ---------- The whole sequence ----------

function clock(total, onFrame, signal) {
  return new Promise((resolve) => {
    const start = performance.now();
    let last = -1;
    function tick(now) {
      const t = signal.skip ? total : Math.min(total, now - start);
      const frame = Math.floor((t * FPS) / 1000);
      if (frame !== last || t >= total) {
        last = frame;
        if (onFrame(t >= total ? total : (frame * 1000) / FPS) === false) return resolve(false);
      }
      if (t >= total) resolve(true);
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

export default async function play({ from, to, swap, isCurrent }) {
  const sheet = from.querySelector(".choice--amazed");
  const other = from.querySelector(".choice--recruiter");
  const px = parseFloat(getComputedStyle(root).getPropertyValue("--px")) || 6;
  const rect = sheet.getBoundingClientRect();

  // Hold the navy palette whatever the pointer does, stop the intro if it
  // is still playing, and take off.
  root.dataset.launching = "";
  root.dataset.landed = "";
  sheet.classList.add("is-launching");

  // Any click or key skips to the end.
  const signal = { skip: false };
  const skip = () => { signal.skip = true; };
  addEventListener("pointerdown", skip, { once: true });
  addEventListener("keydown", skip, { once: true });

  let fold = null;
  let rising = [];
  let swapped = false;

  const ok = await clock(T.fly[1], (t) => {
    if (!isCurrent()) return false;
    if (t >= T.blow) other.classList.add("is-blown");
    if (t >= T.fold) {
      if (!fold) {
        fold = folder(sheet.querySelector(".choice__paper"), rect, px);
        sheet.classList.add("is-folding");
      }
      fold.draw(t);
    }
    if (t >= T.fly[0] && !swapped) {
      swapped = true;
      swap();                                   // the Workshop replaces the landing…
      rising = rise(to, px);                    // …its blocks start below the screen
      if (signal.skip) for (const a of rising) a.finish();
    }
  }, signal);

  // The plane is off the screen (or we were interrupted): unload it and put
  // the landing back as it was, hidden, for next time.
  fold?.remove();
  sheet.classList.remove("is-launching", "is-folding");
  other.classList.remove("is-blown");
  delete root.dataset.launching;

  // Let the blocks finish settling; a click or key still skips.
  if (ok) {
    const settle = () => { for (const a of rising) a.finish(); };
    if (signal.skip) settle();
    else {
      addEventListener("pointerdown", settle, { once: true });
      addEventListener("keydown", settle, { once: true });
    }
    await Promise.all(rising.map((a) => a.finished.catch(() => {})));
    removeEventListener("pointerdown", settle);
    removeEventListener("keydown", settle);
  } else {
    for (const a of rising) a.cancel();
  }
  removeEventListener("pointerdown", skip);
  removeEventListener("keydown", skip);
}
