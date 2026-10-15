// The landing as a little 8-bit scene, drawn on one canvas.
//
// The canvas works in fine pixels (2 CSS px) and is scaled up with
// image-rendering: pixelated, so everything on it is a hard-edged square.
// Sheets are 22 × 31 big pixels of K × K fine pixels each (about 20 CSS px
// on a laptop); photos keep the fine pixel, so they stay sharp. The plane
// (js/airplane.js) and the particles are drawn here too.
//
// The real links (.choice) stay in the page, invisible, on top: they lay
// the sheets out, take the hover, focus and click, and carry the text for
// screen readers. This file only draws where they are.
//
// Motion runs at the display's full frame rate. Positions come from damped
// springs,  x'' = k (target − x) − c x',  stepped with semi-implicit Euler;
// the damping ratio ζ = c / (2√k) decides between a bounce (ζ < 1) and a
// smooth settle (ζ ≈ 1). The loop sleeps whenever nothing is moving.

import { K, setK, SHEET, makeCanvas, readPalette, sheetTexture, silhouette, ripple, Particles } from "./pixel.js";

const root = document.documentElement;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

class Spring {
  constructor(x = 0, k = 170, c = 26) { this.x = x; this.v = 0; this.target = x; this.k = k; this.c = c; }
  step(s) {
    this.v += (this.k * (this.target - this.x) - this.c * this.v) * s;
    this.x += this.v * s;
  }
  get resting() { return Math.abs(this.v) < 0.02 && Math.abs(this.target - this.x) < 0.02; }
}

const rand = (a, b) => a + Math.random() * (b - a);


class Scene {
  constructor(landing) {
    this.landing = landing;
    [this.canvas, this.g] = makeCanvas(1, 1);
    this.canvas.className = "pixel-scene";
    this.canvas.setAttribute("aria-hidden", "true");
    document.body.append(this.canvas);

    this.particles = new Particles();
    this.overlays = new Set();        // extra drawing each frame (the plane)
    this.f = 2;                       // CSS px per fine pixel
    this.q = 1;                       // a quarter of a big pixel, in fine pixels: the unit for small things
    this.W = SHEET.w * K;
    this.H = SHEET.h * K;
    this.pal = readPalette();
    this.palKey = "";
    this.launching = false;
    this.running = false;
    this.last = 0;
    this.now = 0;
    this.introStart = null;
    this.textures = new Map();

    this.sheets = [...landing.querySelectorAll(".choice")].map((el, i) => {
      const photo = new Image();
      photo.decoding = "async";
      photo.src = el.dataset.photo;
      photo.addEventListener("load", () => { this.textures.clear(); this.wake(); });
      return {
        el, name: el.dataset.choice, photo, seed: i * 2.3,
        hasEar: el.dataset.choice === "recruiter",
        label: (el.dataset.label ?? "").split("|"),
        home: { x: 0, y: 0 },
        lift: new Spring(0, 120, 22),     // big pixels up; ζ = 1, a smooth rise
        hop: new Spring(0, 260, 9),       // in q; ζ ≈ 0.28, a bouncy hop
        squash: new Spring(1, 420, 16),   // vertical scale after landing
        wave: new Spring(0, 40, 13),      // ripple amplitude, in q
        reveal: new Spring(0, 90, 19),    // photo, 0–16 dither levels
        ear: new Spring(0, 140, 17),      // dog-ear: 0 folded … 1 open
        fall: null, blown: null, hidden: false, hovered: false, nextSpark: 0,
      };
    });

    root.dataset.scene = "";
    addEventListener("resize", () => { this.layout(); this.wake(); });
    new MutationObserver(() => this.wake())
      .observe(root, { attributes: true, attributeFilter: ["data-preview", "data-theme", "data-launching"] });
    new MutationObserver(() => { if (!landing.hidden) { this.layout(); this.wake(); } })
      .observe(landing, { attributes: true, attributeFilter: ["hidden"] });

    this.layout();
    this.wake();
  }

  sheet(name) { return this.sheets.find((s) => s.name === name); }

  // Where the sheets go, from the links' boxes. A big pixel is the largest
  // even number of CSS px for which a 22-pixel-wide sheet fits the
  // narrowest box; the canvas pixel is 2 CSS px, so K = big / 2.
  layout() {
    if (this.landing.hidden || this.launching) return;
    const rects = this.sheets.map((s) => s.el.getBoundingClientRect());
    const narrowest = Math.min(...rects.map((r) => r.width));
    if (!narrowest) return;
    const big = Math.max(2, 2 * Math.floor(narrowest / (2 * SHEET.w)));
    this.f = big >= 4 ? 2 : 1;
    if (big / this.f !== K) { setK(big / this.f); this.textures.clear(); }
    this.q = K / 4;
    this.W = SHEET.w * K;
    this.H = SHEET.h * K;

    const f = this.f;
    this.canvas.width = Math.ceil(innerWidth / f);
    this.canvas.height = Math.ceil(innerHeight / f);
    this.canvas.style.width = `${this.canvas.width * f}px`;
    this.canvas.style.height = `${this.canvas.height * f}px`;
    this.g.imageSmoothingEnabled = false;
    this.sheets.forEach((s, i) => {
      const r = rects[i];
      s.home.x = Math.round((r.left + (r.width - this.W * f) / 2) / f);
      s.home.y = Math.round((r.top + (r.height - this.H * f) / 2) / f);
    });
  }

  earPose(s) { return s.hasEar ? Math.round(Math.min(1, Math.max(0, s.ear.x)) * 8) / 8 : null; }

  texture(s, side) {
    const reveal = side === "front" ? Math.round(Math.min(16, Math.max(0, s.reveal.x))) : 0;
    const ear = this.earPose(s);
    const key = `${this.palKey}|${K}|${s.name}|${side}|${reveal}|${ear}`;
    if (!this.textures.has(key)) {
      if (this.textures.size > 120) this.textures.clear();
      this.textures.set(key, sheetTexture({
        pal: this.pal, ear, side, photo: s.photo, reveal, label: s.label,
      }));
    }
    return this.textures.get(key);
  }

  shadowTexture(s, dither) {
    const ear = this.earPose(s);
    const key = `shadow|${K}|${ear}|${dither}`;
    if (!this.textures.has(key)) this.textures.set(key, silhouette(ear, "#000", dither));
    return this.textures.get(key);
  }

  wake() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- each frame ----------

  frame(t) {
    const dt = Math.min(50, t - this.last);
    this.last = t;
    this.now = t;

    const visible = !this.landing.hidden || this.overlays.size > 0;
    this.canvas.hidden = !visible;
    if (!visible) { this.running = false; return; }

    // Re-read the palette when the theme changes. (Spelled out: join() would
    // turn an absent attribute, null, and a present empty one, "", into the
    // same empty string, and miss data-launching="" switching on.)
    const key = ["data-preview", "data-theme", "data-launching"]
      .map((a) => (root.hasAttribute(a) ? `${a}=${root.getAttribute(a)}` : "")).join(";");
    if (key !== this.palKey) { this.palKey = key; this.pal = readPalette(); }

    if (this.introStart === null && !this.landing.hidden) this.startIntro(t);
    this.update(dt, t);
    this.draw(t);

    if (this.busy()) requestAnimationFrame((n) => this.frame(n));
    else this.running = false;
  }

  busy() {
    return this.overlays.size > 0 || this.particles.busy ||
      this.sheets.some((s) => s.fall || s.blown || s.hovered ||
        [s.lift, s.hop, s.squash, s.wave, s.reveal, s.ear].some((sp) => !sp.resting));
  }

  // ---------- intro: the sheets drift down, one after the other ----------

  startIntro(t) {
    this.introStart = t;
    if (root.dataset.landed !== undefined || reduced()) { root.dataset.landed = ""; return; }
    this.sheets.forEach((s, i) => { s.fall = { start: t + 250 + i * 950, dur: 2300 }; });
  }

  // A falling sheet of paper: it rocks from side to side like a pendulum,
  // tilted into its direction of travel, slowing and nearly hanging at the
  // end of each swing and dropping fastest through the middle, the swings
  // dying away as it settles. With φ = 2π · 1.25 u (u: 0 → 1 over the fall):
  //   swing     x = A (1 − u)^0.8 sin φ
  //   descent   g(u) = u + 0.6 sin(2φ) / (4π · 1.25), so dg/du = 1 + 0.6 cos 2φ:
  //             slowest (0.4) at the ends of a swing, fastest (1.6) mid-swing
  //   tilt      θ = 0.22 cos φ (1 − u), leaning into the direction of travel
  leaf(sh, u) {
    const swings = 1.25, phi = 2 * Math.PI * swings * u;
    const dir = sh.name === "amazed" ? -1 : 1;
    return {
      dx: dir * 0.45 * this.W * Math.pow(1 - u, 0.8) * Math.sin(phi),
      g: u + (0.6 * Math.sin(2 * phi)) / (4 * Math.PI * swings),
      tilt: dir * 0.22 * Math.cos(phi) * (1 - u),
    };
  }

  // ---------- state ----------

  update(dt, t) {
    const s = dt / 1000;
    const preview = this.launching ? null : root.dataset.preview ?? null;
    const calm = reduced();

    for (const sh of this.sheets) {
      const was = sh.hovered;
      sh.hovered = preview === sh.name && !sh.fall;
      const entered = sh.hovered && !was;

      sh.reveal.target = sh.hovered || (this.launching && sh.name === "amazed") ? 16 : 0;
      if (calm) sh.reveal.x = sh.reveal.target;

      if (sh.name === "recruiter") {
        // A bubbly hop with sparkles, and the dog-ear unfolds. No ripple.
        sh.ear.target = sh.hovered ? 1 : 0;
        if (calm) sh.ear.x = sh.ear.target;
        if (entered && !calm) {
          sh.hop.v = -150;
          this.burst(sh, 10, "spark");
        }
        sh.wave.target = 0;
        if (sh.hovered && !calm && t > sh.nextSpark) { this.twinkle(sh); sh.nextSpark = t + 110; }
      } else {
        // Lift, float and ripple; the launch takes it higher still.
        sh.lift.target = this.launching ? 6 : sh.hovered ? 2 : 0;
        sh.wave.target = this.launching ? 2 : sh.hovered && !calm ? 1.2 : 0;
        if (calm) sh.lift.x = sh.lift.target;
        if (entered && !calm) this.burst(sh, 14, "dust");
        if ((sh.hovered || this.launching) && !sh.hidden && !calm && t > sh.nextSpark) {
          this.downdraft(sh, this.launching ? 4 : 1);
          sh.nextSpark = t + (this.launching ? 16 : 90);
        }
      }

      for (const sp of [sh.lift, sh.hop, sh.squash, sh.wave, sh.reveal, sh.ear]) sp.step(s);

      if (sh.fall && t >= sh.fall.start + sh.fall.dur) {
        sh.fall = null;
        sh.squash.v = -1.2;                         // settle with a little give…
        this.burst(sh, 10, "dust");                 // …and a puff of dust
        this.burst(sh, 4, "scrap");
        if (this.sheets.every((x) => !x.fall)) root.dataset.landed = "";
      }

      if (sh.blown) {
        const b = sh.blown;
        b.vx -= 2600 * this.q * s;                  // the gust accelerates it
        b.x += b.vx * s;
        b.y += b.vy * s;
        b.spin += 9 * s;
        if (Math.random() < 0.7) this.streak(sh);
      }
    }
    this.particles.update(dt);
  }

  // ---------- particles (sizes and speeds in q, a quarter big pixel) ----------

  burst(sh, n, kind) {
    const p = this.pose(sh), q = this.q, W = this.W, H = this.H;
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      const x = left ? p.x + rand(-2 * q, W * 0.3) : p.x + rand(W * 0.7, W + 2 * q);
      if (kind === "spark") {
        this.particles.add({ kind, x: p.x + rand(-8 * q, W + 8 * q), y: p.y + rand(-8 * q, H + 8 * q),
          vx: rand(-20, 20) * q, vy: rand(-40, -10) * q, life: rand(450, 750), size: 2 * q, colour: this.pal.spark });
      } else if (kind === "scrap") {
        this.particles.add({ kind, x, y: p.y + H - 2 * q, vx: (left ? -1 : 1) * rand(15, 45) * q, vy: rand(-70, -30) * q,
          gravity: 90 * q, drag: 1.2, life: rand(700, 1100), size: 2 * q, colour: i % 3 ? this.pal.fill : this.pal.flap });
      } else {
        this.particles.add({ kind: "dot", x, y: p.y + H - rand(0, 3 * q), vx: (left ? -1 : 1) * rand(25, 70) * q, vy: rand(-45, -10) * q,
          gravity: 40 * q, drag: 2.5, life: rand(350, 650), size: (Math.random() < 0.4 ? 3 : 2) * q, colour: this.pal.dust });
      }
    }
  }

  twinkle(sh) {
    const p = this.pose(sh), q = this.q, W = this.W, H = this.H;
    const edge = Math.floor(rand(0, 4));
    const x = edge === 0 ? p.x - 3 * q : edge === 1 ? p.x + W + 2 * q : p.x + rand(0, W);
    const y = edge === 2 ? p.y - 3 * q : edge === 3 ? p.y + H + 2 * q : p.y + rand(0, H);
    this.particles.add({ kind: "spark", x, y, vx: 0, vy: -12 * q, life: rand(380, 620), size: 2 * q, colour: this.pal.spark });
  }

  downdraft(sh, n) {
    const p = this.pose(sh), q = this.q;
    for (let i = 0; i < n; i++)
      this.particles.add({ kind: "dot", x: p.x + rand(0, this.W), y: p.y + this.H + rand(2, 8) * q,
        vx: rand(-60, 60) * q, vy: rand(10, 40) * q, drag: 3, life: rand(250, 450), size: 2 * q, colour: this.pal.dust });
  }

  streak(sh) {
    const p = this.pose(sh), q = this.q;
    this.particles.add({ kind: "streak", x: p.x + this.W + rand(0, 40) * q, y: p.y + rand(0, this.H), vx: rand(-700, -400) * q,
      life: rand(150, 300), length: rand(6, 16) * q, size: 2 * q, colour: this.pal.dust });
  }

  // ---------- where a sheet is this frame ----------
  //   x, y    top-left, fine pixels
  //   sx, sy  horizontal / vertical scale (negative shows the back)
  //   lift    big pixels above the ground (moves the shadow)
  //   tilt    lean in radians (drawn as a shear, keeping pixel columns upright)
  //   wave    ripple amplitude, in q
  pose(sh) {
    const H = this.H;
    let x = sh.home.x, y = sh.home.y, sx = 1, sy = sh.squash.x, lift = sh.lift.x, wave = sh.wave.x, tilt = 0;
    y += sh.hop.x * this.q - sh.lift.x * K;

    if (sh.hovered && sh.name === "amazed") y += Math.sin(this.now / 260) * 1.5 * this.q;   // bob

    if (sh.fall) {
      const u = Math.min(1, Math.max(0, (this.now - sh.fall.start) / sh.fall.dur));
      const leaf = this.leaf(sh, u);
      const top = -(H + 6 * K) - sh.home.y;
      y = sh.home.y + top * (1 - leaf.g);
      x += leaf.dx;
      tilt = leaf.tilt;
      lift = 10 * (1 - u);
      wave = Math.max(wave, 1.2 * (1 - u));
      if (u <= 0) y = -H * 3;                                 // not yet dropped
    }

    if (sh.blown) {
      x += sh.blown.x; y += sh.blown.y;
      sx = Math.cos(sh.blown.spin);
      lift = 3;
      wave = 3;
    }
    return { x, y, sx, sy, lift, wave, tilt };
  }

  // ---------- drawing ----------

  draw(t) {
    const g = this.g;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.landing.hidden || this.launching) {
      const order = [...this.sheets].sort((a, b) => (a.lift.x + (a.hovered ? 1 : 0)) - (b.lift.x + (b.hovered ? 1 : 0)));
      for (const sh of order) if (!sh.hidden) this.drawShadow(g, sh);
      for (const sh of order) if (!sh.hidden) this.drawSheet(g, sh, t);
    }
    for (const draw of this.overlays) draw(g, t);
    this.particles.draw(g);
  }

  drawShadow(g, sh) {
    const W = this.W, H = this.H;
    if (sh.fall && this.now < sh.fall.start) return;
    const p = this.pose(sh);
    // Light at 45°: the shadow's offset grows with height. While a sheet
    // falls, its shadow marks the landing spot, small and dithered while the
    // sheet is high, growing and closing in as it comes down.
    const u = sh.fall ? Math.min(1, Math.max(0, (this.now - sh.fall.start) / sh.fall.dur)) : 1;
    const off = Math.round(K * (sh.fall ? 1 + 2 * (1 - u) : 1 + p.lift * 0.9));
    const dither = sh.fall ? u < 0.92 : p.lift > 0.6;
    const tex = this.shadowTexture(sh, dither);
    const grow = sh.fall ? 0.3 + 0.7 * u * u : 1;
    const w = Math.round(W * Math.abs(p.sx) * grow), h = Math.round(H * grow);
    const gx = (sh.fall ? p.x : sh.home.x + (sh.blown?.x ?? 0)) + (W - w) / 2 + off;
    const gy = sh.home.y + (H - h) / 2 + off;
    g.globalAlpha = sh.blown ? Math.max(0, 1 + sh.blown.x / (30 * K)) : 1;
    g.drawImage(tex, Math.round(gx), Math.round(gy), w, h);
    g.globalAlpha = 1;
  }

  // The sheet, flipped or squashed, then drawn column by column: each
  // big-pixel column is shifted by the ripple (and by the tilt, a shear),
  // and lit or shaded by the ripple's slope, which is what makes flat
  // pixels read as bending paper.
  drawSheet(g, sh, t) {
    const W = this.W, H = this.H;
    const p = this.pose(sh);
    if (p.y < -H * 2.5) return;
    const back = p.sx < 0 || p.sy < 0;
    const tex = this.texture(sh, back ? "back" : "front");

    const w = Math.max(1, Math.round(W * Math.abs(p.sx)));
    const h = Math.max(1, Math.round(H * Math.abs(p.sy)));
    const [layer, lg] = this.layer(W, H);
    lg.clearRect(0, 0, W, H);
    lg.save();
    lg.translate(W / 2, H / 2);
    lg.scale(p.sx < 0 ? -1 : 1, p.sy < 0 ? -1 : 1);
    lg.drawImage(tex, -w / 2, -h / 2, w, h);
    lg.restore();

    const cols = SHEET.w;
    const amp = p.wave * this.q;
    const offs = amp > 0.2 ? ripple(cols, t, amp, sh.seed) : null;
    if (offs && amp > 0.6) {
      lg.globalCompositeOperation = "source-atop";
      for (let c = 0; c < cols; c++) {
        const slope = (offs[Math.min(cols - 1, c + 1)] - offs[Math.max(0, c - 1)]) / (2 * amp);
        const tint = slope > 0.22 ? "rgba(255,255,255,0.22)" : slope < -0.22 ? "rgba(0,0,0,0.15)" : null;
        if (tint) { lg.fillStyle = tint; lg.fillRect(c * K, 0, K, H); }
      }
      lg.globalCompositeOperation = "source-over";
    }

    const x0 = Math.round(p.x), y0 = Math.round(p.y);
    const shear = Math.tan(p.tilt);
    for (let c = 0; c < cols; c++) {
      const off = (offs ? offs[c] : 0) + shear * (c * K + K / 2 - W / 2);
      g.drawImage(layer, c * K, 0, K, H, x0 + c * K, y0 + Math.round(off), K, H);
    }
  }

  layer(w, h) {
    if (!this._layer || this._layer[0].width !== w || this._layer[0].height !== h) this._layer = makeCanvas(w, h);
    return this._layer;
  }

  // ---------- the launch (driven by js/airplane.js) ----------

  launch() {
    this.launching = true;
    const sheet = this.sheet("amazed");
    const other = this.sheet("recruiter");
    this.burst(sheet, 30, "dust");
    this.burst(sheet, 10, "scrap");
    setTimeout(() => {
      other.blown = { x: 0, y: 0, vx: -120 * this.q, vy: -25 * this.q, spin: 0 };
      for (let i = 0; i < 10; i++) this.streak(other);
    }, 150);
    this.wake();
  }

  // The sheet's current place and look, for the folding copy to start from.
  handOff(name) {
    const sh = this.sheet(name);
    const p = this.pose(sh);
    sh.hidden = true;
    return { x: p.x, y: p.y, w: this.W, h: this.H, photo: sh.photo, pal: this.pal, q: this.q };
  }

  addOverlay(draw) { this.overlays.add(draw); this.wake(); }
  removeOverlay(draw) { this.overlays.delete(draw); }

  // Back to the resting landing, for whenever it is shown again.
  reset() {
    this.launching = false;
    for (const sh of this.sheets) {
      sh.hidden = false; sh.blown = null;
      for (const sp of [sh.lift, sh.wave, sh.reveal, sh.ear, sh.hop]) { sp.x = sp.target = 0; sp.v = 0; }
    }
  }
}

const landing = document.querySelector('[data-view="landing"]');
export const scene = landing ? new Scene(landing) : null;
