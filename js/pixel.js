// Pixel-art drawing for the landing's canvas: the sheet sprite, a tiny
// bitmap font, ordered dithering, the paper ripple, and particles.
//
// Two pixel sizes, both whole numbers of CSS px, both hard-edged squares
// (the canvas is scaled up with image-rendering: pixelated):
//   fine pixel  the canvas's own pixel (2 CSS px); photos use it
//   big pixel   K × K fine pixels; sheets, borders, lettering, shadows and
//               the plane are drawn on this coarser grid
// K is set by the scene from the space available (setK), so a big pixel is
// about 20 CSS px on a laptop and smaller on a phone.

export let K = 4;
export function setK(k) { K = k; }

export const SHEET = { w: 22, h: 31 };   // big pixels: 22/31 = 0.710, A4 is 0.707

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  return [c, g];
}

export function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    fill: v("--sheet-fill"), shade: v("--sheet-shade"), flap: v("--sheet-flap"),
    ink: v("--sheet-ink"), spark: v("--sheet-spark"), dust: v("--sheet-dust"),
  };
}

// 4 × 4 Bayer matrix: thresholds 0–15 spread so that every level of an
// ordered dither is as even as possible. A pixel is "on" at level L when
// its threshold is below L, so 16 levels fade a picture in a sixteenth at a time.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];


// ---------- The paper ripple ----------
// Vertical offsets, one per column, for a sheet rippling in moving air.
// It is meant to look whippy and gusty rather than like a metronome:
//   - the phase runs as (c/n)^0.6 along the sheet, so the local wavenumber
//     falls towards the free edge and the wave speeds up there (v = ω/k),
//     as a pulse does running down a whip, where the line gets lighter;
//     the amplitude grows towards that edge the same way;
//   - three waves at unrelated frequencies are added, and each swells and
//     dies away in gusts, so the pattern never quite repeats.
// t in ms; seed shifts the gusts so two sheets do not move in step.
export function ripple(cols, t, amp, seed = 0) {
  const gust = (a, b, s) => Math.max(0, Math.sin(t * a + s + 1.8 * Math.sin(t * b + 2 * s)));
  const g1 = gust(0.0013, 0.00041, seed), g2 = gust(0.0021, 0.00067, seed + 1.7), g3 = gust(0.0034, 0.00023, seed + 3.1);
  const out = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    const s = cols > 1 ? c / (cols - 1) : 0;
    const phase = 8 * Math.pow(s, 0.6);
    const whip = 0.25 + 0.75 * s * s;
    out[c] = amp * whip * (
      (0.35 + 0.65 * g1) * Math.sin(phase - 0.0085 * t + seed) +
      0.55 * g2 * Math.sin(1.9 * phase - 0.0155 * t + 2 * seed) +
      0.3 * g3 * Math.sin(3.4 * phase - 0.026 * t));
  }
  return out;
}


// ---------- The sheet as a grid of big-pixel cells ----------

const EMPTY = 0, INK = 1, PAPER = 2, LIGHT = 3, SHADE = 4, FLAP = 5;
const EAR = 6;                                       // dog-ear size, in big pixels

// Layout of the marks on the front, in big pixels.
export const PHOTO = { x: 2, y: 2, w: 18, h: 15 };
const BARS = [{ x: 3, y: 25, w: 16 }, { x: 3, y: 27, w: 11 }];

const interior = (c) => c === PAPER || c === LIGHT || c === SHADE;

// ear: null for a plain sheet; otherwise how far the dog-ear has unfolded,
// 0 (folded flat over the front) to 1 (open, a whole corner again).
function buildCells(ear) {
  const { w, h } = SHEET;
  const cut = ear !== null && ear < 0.999;
  const inside = (x, y) =>
    x >= 0 && y >= 0 && x < w && y < h &&
    !((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) &&     // notched corners
    !(cut && x + y < EAR);                                            // the cut corner
  const grid = new Uint8Array(w * h);
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? grid[y * w + x] : EMPTY);

  // Outline: every inside cell that touches outside.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      grid[y * w + x] = edge ? INK : PAPER;
    }

  // Bevel, lit from the upper left: paper just inside the outline is light
  // on the top and left, shaded on the bottom and right, plus a second
  // shaded row along the foot.
  const next = grid.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (grid[y * w + x] !== PAPER) continue;
      if (at(x, y + 1) === INK || at(x + 1, y) === INK || at(x, y + 2) === INK) next[y * w + x] = SHADE;
      else if (at(x, y - 1) === INK || at(x - 1, y) === INK) next[y * w + x] = LIGHT;
    }

  // The flap: a triangle hinged on the fold line from (0, EAR) to (EAR, 0).
  // Its tip swings through the corner as it unfolds: folded, the tip lies
  // over the page at x + y = 2·EAR; edge-on, on the fold line itself; open,
  // back at the corner, x + y = 0. In between, x + y = EAR + EAR·cos(π·ear).
  if (cut) {
    const tip = (EAR + EAR * Math.cos(Math.PI * ear)) / 2;
    const tri = [[0, EAR], [EAR, 0], [tip, tip]];
    const side = (p, a, b) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const inTri = (x, y) => {
      const p = [x + 0.5, y + 0.5];
      const d1 = side(p, tri[0], tri[1]), d2 = side(p, tri[1], tri[2]), d3 = side(p, tri[2], tri[0]);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    };
    // Folded over the page, the flap is inked all round; once it has swung
    // out past the fold line, only its outer edges (against empty space) are,
    // so it reads as paper still joined to the sheet along the hinge.
    const outside = tip < EAR / 2;
    const border = (x, y) => !inTri(x, y) && (!outside || at(x, y) === EMPTY);
    for (let y = 0; y <= EAR; y++)
      for (let x = 0; x <= EAR; x++) {
        if (!inTri(x, y)) continue;
        const edge = border(x - 1, y) || border(x + 1, y) || border(x, y - 1) || border(x, y + 1);
        next[y * w + x] = edge ? INK : FLAP;
      }
  }
  return next;
}

const cellCache = new Map();
function cells(ear) {
  const key = ear === null ? "none" : Math.round(ear * 8) / 8;   // eight poses of the ear
  if (!cellCache.has(key)) cellCache.set(key, buildCells(ear === null ? null : key));
  return cellCache.get(key);
}

function paintCells(g, grid, pal, scale) {
  const colour = { [INK]: pal.ink, [PAPER]: pal.fill, [LIGHT]: pal.flap, [SHADE]: pal.shade, [FLAP]: pal.flap };
  for (let y = 0; y < SHEET.h; y++)
    for (let x = 0; x < SHEET.w; x++) {
      const c = grid[y * SHEET.w + x];
      if (c === EMPTY) continue;
      g.fillStyle = colour[c];
      g.fillRect(x * scale, y * scale, scale, scale);
    }
}

// Draw a photo into a rectangle, covering it (like object-fit: cover), with
// smoothing on so a downscale averages instead of skipping pixels.
function cover(g, img, x, y, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s, sh = h / s;
  g.save();
  g.imageSmoothingEnabled = s < 1;
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  g.restore();
}

// The sheet at fine resolution (K fine pixels per cell).
//   side    "front" or "back"
//   reveal  0–16: how many of the 16 dither levels of the photo are showing
export function sheetTexture({ pal, ear = null, side = "front", photo = null, reveal = 0, label = [] }) {
  const [c, g] = makeCanvas(SHEET.w * K, SHEET.h * K);
  const grid = cells(side === "front" ? ear : null);
  paintCells(g, grid, pal, K);
  if (side === "back") return c;

  // The photo area, limited to plain paper (never over the outline or the
  // flap): a big-pixel checkerboard until the picture develops.
  const [mc, mg] = makeCanvas(PHOTO.w * K, PHOTO.h * K);
  mg.fillStyle = "#000";
  for (let y = 0; y < PHOTO.h; y++)
    for (let x = 0; x < PHOTO.w; x++) {
      const cell = grid[(PHOTO.y + y) * SHEET.w + PHOTO.x + x];
      if (!interior(cell)) continue;
      mg.fillRect(x * K, y * K, K, K);
      if ((x + y) % 2 === 0) { g.fillStyle = pal.shade; g.fillRect((PHOTO.x + x) * K, (PHOTO.y + y) * K, K, K); }
    }

  if (photo?.complete && photo.naturalWidth && reveal > 0) {
    const [pc, pg] = makeCanvas(PHOTO.w * K, PHOTO.h * K);
    cover(pg, photo, 0, 0, pc.width, pc.height);
    if (reveal < 16) {
      const data = pg.getImageData(0, 0, pc.width, pc.height);
      for (let y = 0; y < pc.height; y++)
        for (let x = 0; x < pc.width; x++)
          if (bayer(x, y) >= reveal) data.data[(y * pc.width + x) * 4 + 3] = 0;
      pg.putImageData(data, 0, 0);
    }
    pg.globalCompositeOperation = "destination-in";
    pg.drawImage(mc, 0, 0);
    g.drawImage(pc, PHOTO.x * K, PHOTO.y * K);
  }

  // Lettering: as large as fits the paper with a one-cell margin each side,
  // in a whole number of fine pixels per text pixel; centred in the band
  // between the picture (ends at row 17) and the text bars (start at row
  // 25), a quarter cell above its middle, where text looks centred.
  const size = labelSize(label);
  const top = 17 * K + Math.round((8 * K - 12 * size) / 2) - Math.round(K / 4);
  text(g, label, (SHEET.w * K) / 2, top, size, pal.ink);
  g.fillStyle = pal.ink;
  for (const b of BARS) g.fillRect(b.x * K, b.y * K, b.w * K, K);
  return c;
}

// The sheet at big-pixel resolution (one canvas pixel per cell), for the
// plane: paper, photo averaged down to big pixels, text lines. No lettering:
// at this size it would only be noise.
export function sheetSprite({ pal, side = "front", photo = null }) {
  const [c, g] = makeCanvas(SHEET.w, SHEET.h);
  const grid = cells(null).slice();
  for (let i = 0; i < grid.length; i++) if (grid[i] === INK) grid[i] = PAPER;  // the plane gets its own outline
  paintCells(g, grid, pal, 1);
  if (side === "back") return c;
  if (photo?.complete && photo.naturalWidth) cover(g, photo, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);
  g.fillStyle = pal.ink;
  for (const b of BARS) g.fillRect(b.x, b.y, b.w, 1);
  return c;
}

// The sheet's silhouette in one colour, or dithered 50% (a checkerboard of
// half-big-pixel squares), for its shadow.
export function silhouette(ear, colour, dither = false) {
  const [c, g] = makeCanvas(SHEET.w * K, SHEET.h * K);
  const grid = cells(ear);
  g.fillStyle = colour;
  for (let y = 0; y < SHEET.h; y++)
    for (let x = 0; x < SHEET.w; x++)
      if (grid[y * SHEET.w + x] !== EMPTY) g.fillRect(x * K, y * K, K, K);
  if (dither) {
    const d = Math.max(1, Math.round(K / 2));
    g.globalCompositeOperation = "destination-out";
    for (let y = 0, row = 0; y < c.height; y += d, row++)
      for (let x = row % 2 ? 0 : d; x < c.width; x += 2 * d) g.fillRect(x, y, d, d);
  }
  return c;
}


// ---------- Lettering: a 3 × 5 bitmap font, drawn in square "text pixels" ----------

const GLYPHS = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  Z: ["###", "..#", ".#.", "#..", "###"],
  " ": ["..", "..", "..", "..", ".."],
};

const lineWidth = (s) => [...s].reduce((n, ch) => n + (GLYPHS[ch] ?? GLYPHS[" "])[0].length + 1, -1);

// Largest text-pixel size (fine pixels) at which the widest line fits the
// paper, leaving one big-pixel cell of margin on each side. (Rounding K / 2
// instead overflowed at odd K: 36 text pixels × 6 = 216 > the 198 available.)
function labelSize(lines) {
  const widest = Math.max(...lines.map(lineWidth));
  return Math.max(1, Math.floor(((SHEET.w - 4) * K - 2 * K) / widest));
}

// Lines of text centred on cx, top at `top`, each text pixel `size` canvas
// pixels square, one pixel between letters and two between lines.
export function text(g, lines, cx, top, size, colour) {
  g.fillStyle = colour;
  lines.forEach((line, row) => {
    let x = Math.round(cx - (lineWidth(line) * size) / 2);
    const y = top + row * 7 * size;
    for (const ch of line) {
      const glyph = GLYPHS[ch] ?? GLYPHS[" "];
      glyph.forEach((bits, gy) => {
        for (let gx = 0; gx < bits.length; gx++)
          if (bits[gx] === "#") g.fillRect(x + gx * size, y + gy * size, size, size);
      });
      x += (glyph[0].length + 1) * size;
    }
  });
}


// ---------- Particles ----------
// Each is a few fine pixels, moving under its own velocity, gravity and
// drag. Near the end of its life it blinks (drawn on alternate frames), the
// way 8-bit games faded things they could not make translucent.

export class Particles {
  constructor() { this.list = []; this.frame = 0; }

  add(p) {
    this.list.push({ vx: 0, vy: 0, gravity: 0, drag: 0, life: 600, age: 0, size: 1, kind: "dot", ...p });
  }

  get busy() { return this.list.length > 0; }

  update(dt) {
    const s = dt / 1000;
    for (const p of this.list) {
      p.age += dt;
      p.vy += p.gravity * s;
      const d = Math.exp(-p.drag * s);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * s;
      p.y += p.vy * s;
      if (p.kind === "scrap") p.x += Math.sin((p.age / 1000) * 9 + p.y) * p.size * 0.2;   // flutter
    }
    this.list = this.list.filter((p) => p.age < p.life);
  }

  draw(g) {
    this.frame++;
    for (const p of this.list) {
      if (p.age > p.life * 0.65 && (this.frame + p.life) % 4 < 2) continue;   // blink out
      const x = Math.round(p.x), y = Math.round(p.y), s = Math.max(1, Math.round(p.size));
      g.fillStyle = p.colour;
      if (p.kind === "spark") {
        // A four-pointed twinkle that pulses between a dot and a cross.
        const big = (Math.floor(p.age / 90) % 2) === 0;
        g.fillRect(x, y, s, s);
        if (big) {
          g.fillRect(x - s, y, s, s); g.fillRect(x + s, y, s, s);
          g.fillRect(x, y - s, s, s); g.fillRect(x, y + s, s, s);
        }
      } else if (p.kind === "streak") {
        g.fillRect(x, y, Math.round(p.length), s);
      } else if (p.kind === "scrap") {
        g.fillRect(x, y, s * 2, s);
      } else {
        g.fillRect(x, y, s, s);
      }
    }
  }
}
