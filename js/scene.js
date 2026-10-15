// The landing as a little 8-bit scene, drawn on one canvas.
//
// The canvas works in fine pixels (about 5 CSS px each on a laptop) and is
// scaled up with image-rendering: pixelated, so everything on it is chunky
// by construction: the sheets (22 × 31 big pixels, 4 fine pixels each),
// their shadows, the particles, and the folding plane (js/airplane.js).
//
// The real links (.choice) stay in the page, invisible, on top: they lay
// the sheets out, take the hover, focus and click, and carry the text for
// screen readers. This file only draws where they are.
//
// Motion runs at the display's full frame rate. Positions come from damped
// springs,  x'' = k (target − x) − c x',  stepped with semi-implicit Euler;
// the damping ratio ζ = c / (2√k) decides between a bounce (ζ < 1) and a
// smooth settle (ζ = 1). The loop sleeps whenever nothing is moving.

import { K, SHEET, PHOTO, makeCanvas, readPalette, sheetTexture, silhouette, Particles } from "./pixel.js";

const root = document.documentElement;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const W = SHEET.w * K, H = SHEET.h * K;          // a sheet in fine pixels

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
    this.f = 4;                       // CSS px per fine pixel
    this.pal = readPalette();
    this.palKey = "";
    this.preview = null;
    this.launching = false;
    this.running = false;
    this.last = 0;
    this.now = 0;
    this.introStart = null;

    this.sheets = [...landing.querySelectorAll(".choice")].map((el) => {
      const photo = new Image();
      photo.decoding = "async";
      photo.src = el.dataset.photo;
      photo.addEventListener("load", () => { this.textures.clear(); this.wake(); });
      return {
        el, name: el.dataset.choice, photo,
        dogEar: el.dataset.choice === "recruiter",
        label: (el.dataset.label ?? "").split("|"),
        home: { x: 0, y: 0 },
        lift: new Spring(0, 120, 22),     // big pixels up; ζ = 1, a smooth rise
        hop: new Spring(0, 260, 9),       // fine pixels; ζ ≈ 0.28, a bouncy hop
        squash: new Spring(1, 420, 16),   // vertical scale after landing
        wave: new Spring(0, 60, 15),      // flag-wave amplitude, fine pixels
        reveal: new Spring(0, 90, 19),    // photo, 0–16 dither levels
        fall: null, blown: null, hidden: false, hovered: false, nextSpark: 0,
      };
    });
    this.textures = new Map();

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

  // Where the sheets go, from the links' boxes. The fine pixel is chosen so a
  // sheet (22 big pixels = 88 fine) fits the narrowest box.
  layout() {
    if (this.landing.hidden || this.launching) return;
    const rects = this.sheets.map((s) => s.el.getBoundingClientRect());
    const narrowest = Math.min(...rects.map((r) => r.width));
    if (!narrowest) return;
    this.f = Math.max(2, Math.floor(narrowest / W));
    const f = this.f;
    this.canvas.width = Math.ceil(innerWidth / f);
    this.canvas.height = Math.ceil(innerHeight / f);
    this.canvas.style.width = `${this.canvas.width * f}px`;
    this.canvas.style.height = `${this.canvas.height * f}px`;
    this.g.imageSmoothingEnabled = false;
    this.sheets.forEach((s, i) => {
      const r = rects[i];
      s.home.x = Math.round((r.left + (r.width - W * f) / 2) / f);
      s.home.y = Math.round((r.top + (r.height - H * f) / 2) / f);
    });
  }

  texture(s, side) {
    const reveal = side === "front" ? Math.round(Math.min(16, Math.max(0, s.reveal.x))) : 0;
    const key = `${this.palKey}|${s.name}|${side}|${reveal}`;
    if (!this.textures.has(key)) {
      if (this.textures.size > 80) this.textures.clear();
      this.textures.set(key, sheetTexture({
        pal: this.pal, dogEar: s.dogEar, side, photo: s.photo, reveal, label: s.label,
      }));
    }
    return this.textures.get(key);
  }

  shadowTexture(s, dither) {
    const key = `shadow|${s.dogEar}|${dither}`;
    if (!this.textures.has(key)) this.textures.set(key, silhouette(s.dogEar, "#000", dither));
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
        !s.lift.resting || !s.hop.resting || !s.squash.resting || !s.wave.resting || !s.reveal.resting);
  }

  // ---------- intro: the sheets tumble down, one after the other ----------

  startIntro(t) {
    this.introStart = t;
    if (root.dataset.landed !== undefined || reduced()) { root.dataset.landed = ""; return; }
    this.sheets.forEach((s, i) => { s.fall = { start: t + 300 + i * 800, dur: 1300 }; });
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
        // A bubbly hop: kicked upwards, a bouncy spring brings it home.
        if (entered && !calm) {
          sh.hop.v = -150;
          this.burst(sh, 10, "spark");
        }
        sh.wave.target = sh.hovered && !calm ? 1.5 : 0;
        if (sh.hovered && !calm && t > sh.nextSpark) { this.twinkle(sh); sh.nextSpark = t + 110; }
      } else {
        // Lift, float and flutter; the launch takes it higher still.
        sh.lift.target = this.launching ? 6 : sh.hovered ? 2 : 0;
        sh.wave.target = this.launching ? 4 : sh.hovered && !calm ? 2.5 : 0;
        if (calm) sh.lift.x = sh.lift.target;
        if (entered && !calm) this.burst(sh, 14, "dust");
        if ((sh.hovered || this.launching) && !sh.hidden && !calm && t > sh.nextSpark) {
          this.downdraft(sh, this.launching ? 4 : 1);
          sh.nextSpark = t + (this.launching ? 16 : 90);
        }
      }

      for (const sp of [sh.lift, sh.hop, sh.squash, sh.wave, sh.reveal]) sp.step(s);

      if (sh.fall && t >= sh.fall.start + sh.fall.dur) {
        sh.fall = null;
        sh.squash.v = -3.2;                         // land with a squash…
        this.burst(sh, 16, "dust");                 // …and a puff of dust
        this.burst(sh, 6, "scrap");
        if (this.sheets.every((x) => !x.fall)) root.dataset.landed = "";
      }

      if (sh.blown) {
        const b = sh.blown;
        b.vx -= 2600 * s;                           // the gust accelerates it
        b.x += b.vx * s;
        b.y += b.vy * s;
        b.spin += 9 * s;
        if (Math.random() < 0.7) this.streak(sh);
      }
    }
    this.particles.update(dt);
  }

  // ---------- particles ----------

  centre(sh) { const p = this.pose(sh); return { x: p.x + W / 2, y: p.y + H / 2 }; }

  burst(sh, n, kind) {
    const p = this.pose(sh);
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      const x = left ? p.x + rand(-2, W * 0.3) : p.x + rand(W * 0.7, W + 2);
      if (kind === "spark") {
        this.particles.add({ kind, x: p.x + rand(-8, W + 8), y: p.y + rand(-8, H + 8),
          vx: rand(-20, 20), vy: rand(-40, -10), life: rand(450, 750), size: 2, colour: this.pal.spark });
      } else if (kind === "scrap") {
        this.particles.add({ kind, x, y: p.y + H - 2, vx: (left ? -1 : 1) * rand(15, 45), vy: rand(-70, -30),
          gravity: 90, drag: 1.2, life: rand(700, 1100), size: 2, colour: i % 3 ? this.pal.fill : this.pal.flap });
      } else {
        this.particles.add({ kind: "dot", x, y: p.y + H - rand(0, 3), vx: (left ? -1 : 1) * rand(25, 70), vy: rand(-45, -10),
          gravity: 40, drag: 2.5, life: rand(350, 650), size: Math.random() < 0.4 ? 3 : 2, colour: this.pal.dust });
      }
    }
  }

  twinkle(sh) {
    const p = this.pose(sh);
    const edge = Math.floor(rand(0, 4));
    const x = edge === 0 ? p.x - 3 : edge === 1 ? p.x + W + 2 : p.x + rand(0, W);
    const y = edge === 2 ? p.y - 3 : edge === 3 ? p.y + H + 2 : p.y + rand(0, H);
    this.particles.add({ kind: "spark", x, y, vx: 0, vy: -12, life: rand(380, 620), size: 2, colour: this.pal.spark });
  }

  downdraft(sh, n) {
    const p = this.pose(sh);
    for (let i = 0; i < n; i++)
      this.particles.add({ kind: "dot", x: p.x + rand(0, W), y: p.y + H + rand(2, 8), vx: rand(-60, 60), vy: rand(10, 40),
        drag: 3, life: rand(250, 450), size: 2, colour: this.pal.dust });
  }

  streak(sh) {
    const p = this.pose(sh);
    this.particles.add({ kind: "streak", x: p.x + W + rand(0, 40), y: p.y + rand(0, H), vx: rand(-700, -400),
      life: rand(150, 300), length: Math.round(rand(6, 16)), size: 2, colour: this.pal.dust });
  }

  // ---------- where a sheet is this frame ----------
  //   x, y   top-left, fine pixels
  //   sx, sy horizontal / vertical scale (negative shows the back)
  //   lift   big pixels above the ground (moves the shadow)
  pose(sh) {
    let x = sh.home.x, y = sh.home.y, sx = 1, sy = sh.squash.x, lift = sh.lift.x, wave = sh.wave.x;
    y += sh.hop.x - sh.lift.x * K;

    if (sh.hovered && sh.name === "amazed") y += Math.sin(this.now / 220) * 1.5;   // bob

    if (sh.fall) {
      const u = Math.min(1, Math.max(0, (this.now - sh.fall.start) / sh.fall.dur));
      const top = -(H + 12) - sh.home.y;
      y = sh.home.y + top * (1 - u);                         // terminal velocity: straight line
      x += Math.sin(u * Math.PI * 3) * 10 * (1 - u);         // sway
      sy = Math.cos(u * Math.PI * 2);                        // one turn end over end
      lift = 14 * (1 - u);
      wave = Math.max(wave, 3 * (1 - u) + 0.5);
      if (u <= 0) y = -H * 2;                                // not yet dropped
    }

    if (sh.blown) {
      x += sh.blown.x; y += sh.blown.y;
      sx = Math.cos(sh.blown.spin);
      lift = 3;
      wave = 5;
    }
    return { x, y, sx, sy, lift, wave };
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
    const p = this.pose(sh);
    if (p.y < -H * 1.5 && !sh.fall) return;
    // Light at 45°: the shadow's offset grows with height. While a sheet
    // falls, its shadow marks the landing spot, small and dithered while the
    // sheet is high, growing and closing in as it comes down.
    const u = sh.fall ? Math.min(1, Math.max(0, (this.now - sh.fall.start) / sh.fall.dur)) : 1;
    const off = Math.round(K * (sh.fall ? 1 + 3 * (1 - u) : 1 + p.lift * 0.9));
    const dither = sh.fall ? u < 0.92 : p.lift > 0.6;
    const tex = this.shadowTexture(sh, dither);
    const grow = sh.fall ? 0.3 + 0.7 * u * u : 1;
    const w = Math.round(W * Math.abs(p.sx) * grow), h = Math.round(H * grow);
    const gx = sh.home.x + (sh.blown?.x ?? 0) + (W - w) / 2 + off;
    const gy = sh.home.y + (H - h) / 2 + off;
    if (sh.fall && this.now < sh.fall.start) return;
    g.globalAlpha = sh.blown ? Math.max(0, 1 + sh.blown.x / 120) : 1;
    g.drawImage(tex, Math.round(gx), Math.round(gy), w, h);
    g.globalAlpha = 1;
  }

  // The sheet, flipped or squashed, then drawn column by column with a
  // travelling sine wave: each big-pixel column is shifted up or down by
  //   a · sin(2π c / λ − ω t),
  // and tinted light or dark by the wave's slope, which is what makes flat
  // pixels read as a rippling sheet (the classic demo-scene flag).
  drawSheet(g, sh, t) {
    const p = this.pose(sh);
    if (p.y < -H * 1.8) return;
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

    const cols = SHEET.w, amp = p.wave;
    const omega = sh.name === "amazed" ? 0.011 : 0.008, lambda = 13;
    if (amp > 0.3) {
      lg.globalCompositeOperation = "source-atop";
      for (let c = 0; c < cols; c++) {
        const slope = Math.cos((2 * Math.PI * c) / lambda - omega * t);
        const tint = amp > 0.8 && slope > 0.55 ? "rgba(255,255,255,0.22)" : amp > 0.8 && slope < -0.55 ? "rgba(0,0,0,0.16)" : null;
        if (tint) { lg.fillStyle = tint; lg.fillRect(c * K, 0, K, H); }
      }
      lg.globalCompositeOperation = "source-over";
    }

    const x0 = Math.round(p.x), y0 = Math.round(p.y);
    for (let c = 0; c < cols; c++) {
      const off = amp > 0.3 ? Math.round(amp * Math.sin((2 * Math.PI * c) / lambda - omega * t)) : 0;
      g.drawImage(layer, c * K, 0, K, H, x0 + c * K, y0 + off, K, H);
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
      other.blown = { x: 0, y: 0, vx: -120, vy: -25, spin: 0 };
      for (let i = 0; i < 10; i++) this.streak(other);
    }, 150);
    this.wake();
  }

  // The sheet's current place and look, for the folding copy to start from.
  handOff(name) {
    const sh = this.sheet(name);
    const p = this.pose(sh);
    sh.hidden = true;
    return { x: p.x, y: p.y, w: W, h: H, photo: sh.photo, pal: this.pal };
  }

  addOverlay(draw) { this.overlays.add(draw); this.wake(); }
  removeOverlay(draw) { this.overlays.delete(draw); }

  // Back to the resting landing, for whenever it is shown again.
  reset() {
    this.launching = false;
    for (const sh of this.sheets) {
      sh.hidden = false; sh.blown = null;
      sh.lift.x = sh.lift.target = 0; sh.lift.v = 0;
      sh.wave.x = sh.wave.target = 0; sh.reveal.x = 0;
    }
  }
}

const landing = document.querySelector('[data-view="landing"]');
export const scene = landing ? new Scene(landing) : null;
