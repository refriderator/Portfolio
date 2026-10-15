// Pixel-art drawing for the landing's canvas: the sheet sprite, a tiny
// bitmap font, ordered dithering, and particles.
//
// Two pixel sizes, both whole numbers of CSS px, both hard-edged squares
// (the canvas is scaled up with image-rendering: pixelated):
//   fine pixel  the canvas's own pixel; photos and lettering use it
//   big pixel   K × K fine pixels; sheets, borders, shadows and the plane
//               are drawn on this coarser grid

export const K = 4;
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


// ---------- The sheet as a grid of big-pixel cells ----------

const EMPTY = 0, INK = 1, PAPER = 2, LIGHT = 3, SHADE = 4, FLAP = 5;
const EAR = 6;                                       // dog-ear size, in big pixels

// Layout of the marks on the front, in big pixels.
export const PHOTO = { x: 3, y: 6, w: 16, h: 10 };
const LABEL = { y: 17, h: 6 };
const BARS = [{ x: 3, y: 24, w: 16 }, { x: 3, y: 26, w: 11 }];

function cells(dogEar) {
  const { w, h } = SHEET;
  const inside = (x, y) =>
    x >= 0 && y >= 0 && x < w && y < h &&
    !((x === 0 || x === w - 1) && (y === 0 || y === h - 1)) &&     // notched corners
    !(dogEar && x + y < EAR);                                         // the cut corner
  const grid = new Uint8Array(w * h);
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? grid[y * w + x] : EMPTY);

  // Outline: every inside cell that touches outside.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      grid[y * w + x] = edge ? INK : PAPER;
    }

  // Dog-ear: the corner folded down over the front, inked along its folds.
  if (dogEar)
    for (let y = 0; y <= EAR; y++)
      for (let x = 0; x <= EAR; x++) {
        if (grid[y * w + x] !== PAPER) continue;
        if (x === EAR || y === EAR) grid[y * w + x] = INK;
        else if (x + y >= EAR) grid[y * w + x] = FLAP;
      }

  // Bevel, lit from the upper left: paper just inside the outline is light
  // on the top and left, shaded on the bottom and right. A second shaded row
  // along the foot, as in the icon.
  const next = grid.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (grid[y * w + x] !== PAPER) continue;
      if (at(x, y + 1) === INK || at(x + 1, y) === INK || at(x, y + 2) === INK) next[y * w + x] = SHADE;
      else if (at(x, y - 1) === INK || at(x - 1, y) === INK) next[y * w + x] = LIGHT;
    }
  return next;
}

const CELLS = { true: cells(true), false: cells(false) };

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
// smoothing on so the downscale averages instead of skipping pixels.
function cover(g, img, x, y, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s, sh = h / s;
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "medium";
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  g.restore();
}

// The sheet at fine resolution (K fine pixels per cell).
//   side    "front" or "back"
//   reveal  0–16: how many of the 16 dither levels of the photo are showing
export function sheetTexture({ pal, dogEar, side = "front", photo = null, reveal = 0, label = [] }) {
  const [c, g] = makeCanvas(SHEET.w * K, SHEET.h * K);
  paintCells(g, CELLS[side === "front" && dogEar], pal, K);
  if (side === "back") return c;

  // Photo area: a big-pixel checkerboard until the picture develops.
  for (let y = 0; y < PHOTO.h; y++)
    for (let x = 0; x < PHOTO.w; x++)
      if ((x + y) % 2 === 0) { g.fillStyle = pal.shade; g.fillRect((PHOTO.x + x) * K, (PHOTO.y + y) * K, K, K); }

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
    g.drawImage(pc, PHOTO.x * K, PHOTO.y * K);
  }

  text(g, label, (SHEET.w * K) / 2, LABEL.y * K + 1, 2, pal.ink);
  g.fillStyle = pal.ink;
  for (const b of BARS) g.fillRect(b.x * K, b.y * K, b.w * K, K);
  return c;
}

// The sheet at big-pixel resolution (one canvas pixel per cell), for the
// plane: paper, photo averaged down to big pixels, text lines. No lettering:
// at this size it would only be noise.
export function sheetSprite({ pal, side = "front", photo = null }) {
  const [c, g] = makeCanvas(SHEET.w, SHEET.h);
  const grid = CELLS[false].slice();
  for (let i = 0; i < grid.length; i++) if (grid[i] === INK) grid[i] = PAPER;  // the plane gets its own outline
  paintCells(g, grid, pal, 1);
  if (side === "back") return c;
  if (photo?.complete && photo.naturalWidth) cover(g, photo, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);
  g.fillStyle = pal.ink;
  for (const b of BARS) g.fillRect(b.x, b.y, b.w, 1);
  return c;
}

// The sheet's silhouette in one colour, or dithered 50% (a checkerboard of
// 2 × 2 fine-pixel squares), for its shadow.
export function silhouette(dogEar, colour, dither = false) {
  const [c, g] = makeCanvas(SHEET.w * K, SHEET.h * K);
  const grid = CELLS[dogEar];
  g.fillStyle = colour;
  for (let y = 0; y < SHEET.h; y++)
    for (let x = 0; x < SHEET.w; x++)
      if (grid[y * SHEET.w + x] !== EMPTY) g.fillRect(x * K, y * K, K, K);
  if (dither) {
    g.globalCompositeOperation = "destination-out";
    for (let y = 0; y < c.height; y += 2)
      for (let x = (y / 2) % 2 ? 0 : 2; x < c.width; x += 4) g.fillRect(x, y, 2, 2);
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
      if (p.kind === "scrap") p.x += Math.sin((p.age / 1000) * 9 + p.y) * 0.4;   // flutter
    }
    this.list = this.list.filter((p) => p.age < p.life);
  }

  draw(g) {
    this.frame++;
    for (const p of this.list) {
      if (p.age > p.life * 0.65 && (this.frame + p.life) % 4 < 2) continue;   // blink out
      const x = Math.round(p.x), y = Math.round(p.y), s = p.size;
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
        g.fillRect(x, y, p.length, s);
      } else if (p.kind === "scrap") {
        g.fillRect(x, y, s * 2, s);
      } else {
        g.fillRect(x, y, s, s);
      }
    }
  }
}
