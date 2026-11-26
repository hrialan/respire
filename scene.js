// Respire — la scène marine, dessinée en plein écran sur un <canvas>.
//
// Un orbe (le « hublot ») dont la taille et la marée suivent le souffle,
// un ciel qui change avec l'heure (aube, jour, couchant, nuit), et une mer
// qui déborde du cercle. De temps en temps : une étoile filante, une mouette,
// et pendant les séances un voilier qui passe au loin.
//
// API : Scene.draw(breath 0..1, tempsEnSecondes), Scene.setSky(mode),
//       Scene.setSession(actif).
//
// Paramètres d'URL pour le développement :
//   ?h=19    force l'heure (en mode Auto)
//   ?boat    voilier et mouettes en boucle, tout de suite
//   ?gulls   mouettes en boucle
(() => {
  'use strict';

  const canvas = document.getElementById('sea');
  const ctx = canvas.getContext('2d');
  const anchor = document.getElementById('orbAnchor');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;

  const params = new URLSearchParams(location.search);
  const FORCED_HOUR = params.has('h') && !isNaN(params.get('h')) ? ((Number(params.get('h')) % 24) + 24) % 24 : null;
  const DEBUG_BOAT = params.has('boat');
  const DEBUG_GULLS = DEBUG_BOAT || params.has('gulls');

  /* ================= Helpers ================= */

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mix = (a, b, k) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * k) : a + (b - a) * k);
  const ch = (v) => Math.round(clamp(v, 0, 255));
  const rgb = (c) => `rgb(${ch(c[0])},${ch(c[1])},${ch(c[2])})`;
  const rgba = (c, a) => `rgba(${ch(c[0])},${ch(c[1])},${ch(c[2])},${clamp(a, 0, 1).toFixed(3)})`;
  const between = (lo, hi) => lo + Math.random() * (hi - lo);
  const eitherWay = () => (Math.random() < 0.5 ? 1 : -1);

  // Soft radial light.
  function glow(x, y, r0, r1, col, a) {
    if (a <= 0.002) return;
    const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    g.addColorStop(0, rgba(col, a));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r1, 0, TAU);
    ctx.fill();
  }

  function strokeCurve(f, x0, x1, step) {
    ctx.beginPath();
    for (let x = x0; x <= x1 + step; x += step) ctx.lineTo(x, f(x));
    ctx.stroke();
  }

  /* ================= Seeded decor (same layout every launch) ================= */

  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  const STARS = Array.from({ length: 170 }, () => ({
    x: rand(), y: rand(), r: 0.4 + rand() * rand() * 1.4, ph: rand() * TAU, spd: 0.5 + rand() * 1.8,
  }));
  const GLITTER = Array.from({ length: 46 }, () => ({
    d: Math.pow(rand(), 1.4), dx: rand() * 2 - 1, w: 0.4 + rand(), ph: rand() * TAU, spd: 1.5 + rand() * 3,
  }));
  const MOTES = Array.from({ length: 34 }, () => ({
    x: rand() * 2 - 1, ph: rand(), spd: 0.015 + rand() * 0.035, r: 0.6 + rand() * 1.3, wob: rand() * TAU,
  }));
  const CLOUDS = Array.from({ length: 5 }, (_, i) => ({
    y: 0.25 + rand() * 0.5, ph: rand(), spd: 0.006 + rand() * 0.008, w: 0.45 + rand() * 0.4, puffs: 3 + (i % 3),
  }));

  // Back to front. off: height offset (×R), amp: amplitude (×R), k: waves across, spd: rad/s
  const WAVES = [
    { off: -0.13, amp: 0.05, k: 0.9, spd: 0.22, depth: 0 },
    { off: -0.08, amp: 0.055, k: 1.4, spd: -0.32, depth: 0.25 },
    { off: -0.035, amp: 0.05, k: 2.0, spd: 0.45, depth: 0.5 },
    { off: 0.005, amp: 0.045, k: 2.7, spd: -0.6, depth: 0.75 },
    { off: 0.045, amp: 0.04, k: 3.4, spd: 0.8, depth: 1 },
  ];

  /* ================= Sky over the day ================= */
  // bg: page background · skyT/skyB: sky top/horizon · wT/wB: water top/deep
  // light: sun or moon colour · alt: its height (0..1) · sun/moon/stars/clouds/
  // rays/plankton: how present each element is (0..1) · motes: particle colour

  const NIGHT = {
    bg: [0, 0, 0], skyT: [3, 6, 18], skyB: [14, 26, 54], wT: [30, 72, 125], wB: [2, 8, 22],
    glow: [80, 120, 210], light: [220, 230, 255], sun: 0, moon: 1, alt: 0.62, stars: 1, clouds: 0.12,
    rays: 0, motes: [90, 210, 255], plankton: 1,
  };
  const DAWN = {
    bg: [7, 5, 14], skyT: [28, 36, 82], skyB: [226, 140, 122], wT: [74, 96, 158], wB: [6, 14, 36],
    glow: [255, 160, 130], light: [255, 196, 150], sun: 1, moon: 0, alt: 0.16, stars: 0.12, clouds: 0.55,
    rays: 0.3, motes: [255, 205, 175], plankton: 0,
  };
  const DAY = {
    bg: [3, 12, 24], skyT: [38, 112, 184], skyB: [160, 212, 238], wT: [48, 158, 206], wB: [5, 38, 78],
    glow: [120, 200, 255], light: [255, 250, 232], sun: 1, moon: 0, alt: 0.78, stars: 0, clouds: 0.7,
    rays: 1, motes: [225, 245, 255], plankton: 0,
  };
  const AFTERNOON = { ...DAY, skyB: [178, 208, 226], alt: 0.55, light: [255, 238, 210] };
  const SUNSET = {
    bg: [12, 4, 16], skyT: [42, 40, 98], skyB: [255, 136, 88], wT: [112, 88, 140], wB: [10, 12, 36],
    glow: [255, 128, 80], light: [255, 168, 98], sun: 1, moon: 0, alt: 0.14, stars: 0.08, clouds: 0.8,
    rays: 0.3, motes: [255, 182, 140], plankton: 0,
  };
  const DUSK = {
    bg: [4, 2, 12], skyT: [10, 12, 40], skyB: [86, 52, 116], wT: [42, 60, 122], wB: [3, 8, 26],
    glow: [140, 100, 210], light: [232, 226, 255], sun: 0, moon: 0.65, alt: 0.34, stars: 0.6, clouds: 0.3,
    rays: 0, motes: [140, 175, 255], plankton: 0.5,
  };

  const TIMELINE = [
    [0, NIGHT], [5, NIGHT], [6.6, DAWN], [9.5, DAY], [16, AFTERNOON],
    [19, SUNSET], [20.6, DUSK], [22.3, NIGHT], [24, NIGHT],
  ];
  const PRESET_HOURS = { day: 12.5, sunset: 19, night: 1 };

  function paletteAt(hour) {
    for (let i = 0; i < TIMELINE.length - 1; i++) {
      const [h0, p0] = TIMELINE[i];
      const [h1, p1] = TIMELINE[i + 1];
      if (hour < h0 || hour > h1) continue;
      const k = (hour - h0) / (h1 - h0);
      const e = k * k * (3 - 2 * k);   // smoothstep
      const out = {};
      for (const key in p0) out[key] = mix(p0[key], p1[key], e);
      return out;
    }
    return NIGHT;
  }

  let skyMode = 'auto';
  let palette = NIGHT;
  let paletteStale = true;
  let paletteTime = 0;

  function refreshPalette(t) {
    if (!paletteStale && t - paletteTime < 30) return;
    let hour = PRESET_HOURS[skyMode];
    if (hour === undefined) {
      const d = new Date();
      hour = FORCED_HOUR ?? d.getHours() + d.getMinutes() / 60;
    }
    palette = paletteAt(hour);
    paletteStale = false;
    paletteTime = t;
    if (themeMeta) themeMeta.setAttribute('content', rgb(palette.bg));
  }

  /* ================= Layout ================= */

  let W = 0, H = 0;              // canvas size, CSS px
  let ocx = 0, ocy = 0;          // orb centre
  let orbMax = 0;                // orb radius at full inhale

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = anchor.getBoundingClientRect();
    ocx = a.left + a.width / 2 - r.left;
    ocy = a.top + a.height / 2 - r.top;
    orbMax = a.width / 2;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  ro.observe(anchor);

  /* ================= Occasional visitors ================= */
  // Each visitor: { next: time of the next appearance, cur: the one on screen }.
  // Times are in real seconds (t), motion uses scene time (T, slowed if needed).

  let inSession = false;

  // Shooting star — anywhere in the night sky.
  const shooting = { next: between(6, 16), cur: null };

  function updateShooting(t, p, level) {
    const s = shooting;
    if (!s.cur && t > s.next && p.stars > 0.5) {
      const a = between(0.12, 0.37) * Math.PI;
      s.cur = {
        t0: t, dur: between(0.9, 1.4), len: between(90, 180),
        x: W * between(0.15, 0.85), y: Math.min(level, H) * between(0.05, 0.4),
        a: eitherWay() > 0 ? a : Math.PI - a,
      };
    }
    if (s.cur && t - s.cur.t0 > s.cur.dur) {
      s.cur = null;
      s.next = t + between(14, 40);
    }
  }

  function drawShootingStar(t, p) {
    const s = shooting.cur;
    if (!s) return;
    const k = (t - s.t0) / s.dur;
    const dx = Math.cos(s.a), dy = Math.sin(s.a);
    const hx = s.x + dx * k * s.len * 2.2;
    const hy = s.y + dy * k * s.len * 2.2;
    const tail = s.len * (1 - k * 0.5);
    const g = ctx.createLinearGradient(hx - dx * tail, hy - dy * tail, hx, hy);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, rgba([235, 242, 255], 0.85 * Math.sin(k * Math.PI) * p.stars));
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx - dx * tail, hy - dy * tail);
    ctx.lineTo(hx, hy);
    ctx.stroke();
  }

  // Sailboat — during sessions only, riding the front wave.
  const sailboat = { next: DEBUG_BOAT ? 1.5 : Infinity, cur: null };

  function updateBoat(t) {
    const b = sailboat;
    const active = inSession || DEBUG_BOAT;
    if (!b.cur && active && t > b.next) {
      b.cur = { t0: t, dur: DEBUG_BOAT ? 22 : between(45, 75), dir: eitherWay(), size: between(0.85, 1.15) };
    }
    if (b.cur && t - b.cur.t0 > b.cur.dur) {
      b.cur = null;
      b.next = active ? t + (DEBUG_BOAT ? 1.5 : between(12, 52)) : Infinity;
    }
  }

  // Abstract silhouette: a hull, a mast, a mainsail and a jib.
  function drawBoat(t, T, p, wave, cx, R) {
    const b = sailboat.cur;
    if (!b) return;
    const k = (t - b.t0) / b.dur;
    const x = cx + b.dir * (-1.15 + 2.3 * k) * R;
    const L = R * 0.11 * b.size;
    const slope = (wave(x + 3) - wave(x - 3)) / 6;
    const y = wave(x) + L * 0.1 + Math.sin(T * 1.3) * L * 0.03;
    const fade = Math.min(1, k * 8, (1 - k) * 8);

    // Daylight: white sails. Sunset: dark silhouette. Night: moonlit sails.
    const pale = Math.max(clamp((p.rays - 0.3) / 0.7, 0, 1), p.stars * 0.55);
    const sail = rgb(mix(mix(p.skyT, [0, 0, 0], 0.55), [244, 246, 250], pale));
    const hull = rgb(mix(mix(p.skyT, [0, 0, 0], 0.7), [40, 60, 90], pale * 0.6));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan(slope) * 0.4 + Math.sin(T * 0.9) * 0.03);
    ctx.scale(b.dir * L, L);

    ctx.globalAlpha = fade * 0.92;
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(-0.6, -0.02);
    ctx.lineTo(0.62, -0.02);
    ctx.lineTo(0.45, 0.16);
    ctx.lineTo(-0.42, 0.16);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = sail;
    ctx.beginPath();                       // mainsail, slightly curved leech
    ctx.moveTo(0.02, -1.08);
    ctx.quadraticCurveTo(0.42, -0.5, 0.5, -0.1);
    ctx.lineTo(0.02, -0.1);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = fade * 0.8;
    ctx.beginPath();                       // jib
    ctx.moveTo(-0.06, -0.92);
    ctx.lineTo(-0.06, -0.12);
    ctx.lineTo(-0.5, -0.12);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = fade;
    ctx.strokeStyle = hull;
    ctx.lineWidth = 0.04;
    ctx.beginPath();                       // mast
    ctx.moveTo(-0.02, -1.12);
    ctx.lineTo(-0.02, -0.02);
    ctx.stroke();
    ctx.restore();

    if (p.stars > 0.3) glow(x, y - 1.12 * L, 0, L * 0.35, [255, 210, 150], 0.7 * p.stars * fade);  // masthead light
  }

  // Seagull — one at a time crossing the orb, not at night.
  const seagull = { next: DEBUG_GULLS ? 2 : between(8, 28), cur: null };

  function updateGull(t, p) {
    const g = seagull;
    if (!g.cur && t > g.next) {
      if (p.stars > 0.6) { g.next = t + 30; return; }   // gulls sleep at night
      g.cur = {
        t0: t, dur: between(11, 17), dir: eitherWay(),
        alt: between(0.42, 0.62), size: between(0.8, 1.15), ph: Math.random() * TAU, flapSpd: between(5, 7.5),
        // Flight path: a slow climb or dive, a looser undulation, uneven speed
        arc: between(-0.2, 0.2), arcF: between(0.6, 1.4),
        wob: between(0.03, 0.07), wobF: between(1.5, 3),
        surge: between(0.03, 0.06),
      };
    }
    if (g.cur && t - g.cur.t0 > g.cur.dur) {
      g.cur = null;
      g.next = t + (DEBUG_GULLS ? 2 : between(15, 50));
    }
  }

  function drawGull(t, T, p, cx, level) {
    const G = seagull.cur;
    if (!G) return;
    const path = (k) => {
      const kk = k + G.surge * Math.sin(k * TAU * 1.3 + G.ph);
      return [
        cx + G.dir * (-1.15 + 2.3 * kk) * orbMax,
        ocy - orbMax * (G.alt + G.arc * Math.sin(k * Math.PI * G.arcF + G.ph * 0.3) + G.wob * Math.sin(k * TAU * G.wobF + G.ph)),
      ];
    };
    const k = (t - G.t0) / G.dur;
    const size = orbMax * 0.05 * G.size;
    const glide = 0.35 + 0.65 * Math.max(0, Math.sin(T * 0.45 + G.ph));   // stretches of gliding
    const flap = Math.sin(T * G.flapSpd + G.ph) * glide;

    let [x, y] = path(k);
    const [x2, y2] = path(k + 0.01);
    y += -flap * size * 0.18 + Math.sin(T * 0.8 + G.ph) * size * 0.15;     // wing beats lift the body
    y = Math.min(y, level - orbMax * 0.16);                                // stay above the tide
    const bank = clamp(Math.atan2(y2 - y, Math.abs(x2 - x) + 1e-6) * 0.6, -0.35, 0.35) * G.dir;

    const tip = size * (0.05 + 0.4 * flap);
    const arch = size * (0.42 + 0.2 * flap);
    const col = mix(mix(p.skyT, [0, 0, 0], 0.45), [70, 80, 95], clamp((p.rays - 0.3) / 0.7, 0, 1));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bank);
    ctx.strokeStyle = rgba(col, 0.85 * (1 - p.stars));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.1, size * 0.15);
    ctx.beginPath();
    ctx.moveTo(-size, tip);
    ctx.quadraticCurveTo(-size * 0.45, -arch, 0, 0);
    ctx.quadraticCurveTo(size * 0.45, -arch, size, tip);
    ctx.stroke();
    ctx.restore();
  }

  /* ================= Layers ================= */

  function waveFn(w, i, cx, R, level, T) {
    const swell = 1 + 0.35 * Math.sin(T * 0.23 + i * 0.9);
    const base = level + w.off * R;
    const A = w.amp * R * swell;
    return (x) => {
      const u = ((x - cx) / R) * Math.PI * w.k;
      return base + A * (
        0.6 * Math.sin(u + T * w.spd + i * 1.7) +
        0.3 * Math.sin(u * 2.3 - T * w.spd * 1.4 + i) +
        0.1 * Math.sin(u * 5.1 + T * w.spd * 2.2 + i * 3)
      );
    };
  }

  function drawStars(p, T, level) {
    if (p.stars <= 0.01) return;
    for (const s of STARS) {
      const y = s.y * H;
      const fade = clamp((level - 14 - y) / 60, 0, 1);   // no stars below the horizon
      if (fade <= 0) continue;
      const twinkle = 0.55 + 0.45 * Math.sin(T * s.spd + s.ph);
      ctx.fillStyle = rgba([235, 240, 255], p.stars * twinkle * fade * (0.4 + s.r / 2.4));
      ctx.beginPath();
      ctx.arc(s.x * W, y, s.r, 0, TAU);
      ctx.fill();
    }
  }

  function drawClouds(p, T, cx, cy, R) {
    if (p.clouds <= 0.02) return;
    const col = mix(mix(p.skyB, p.skyT, 0.3), mix([255, 255, 255], p.light, 0.6), 0.75);
    const span = R * 3.4;
    for (const cl of CLOUDS) {
      const x = cx - span / 2 + ((cl.ph + T * cl.spd) % 1) * span;
      const y = cy - R * (0.15 + cl.y * 0.75);
      const w = R * cl.w;
      for (let j = 0; j < cl.puffs; j++) {
        ctx.save();
        ctx.translate(
          x + (j - (cl.puffs - 1) / 2) * w * 0.42,
          y - Math.sin((j / Math.max(1, cl.puffs - 1)) * Math.PI) * w * 0.12,
        );
        ctx.scale(1, 0.42);
        glow(0, 0, 0, w * 0.42, col, 0.33 * p.clouds);
        ctx.restore();
      }
    }
  }

  // Outside the orb: background, ambient glow, stars, and the sea's horizon
  // continuing beyond the porthole as faint swells.
  function drawSurroundings(t, T, p, cx, cy, R, level, light) {
    ctx.fillStyle = rgb(p.bg);
    ctx.fillRect(0, 0, W, H);
    glow(cx, cy, R * 0.5, R * 2.4, p.glow, 0.09 + 0.12 * light.breath);
    ctx.save();
    ctx.translate(cx, level);
    ctx.scale(1, 0.22);
    glow(0, 0, 0, Math.max(W, R * 3) * 0.75, p.skyB, 0.07 + 0.1 * p.sun);
    ctx.restore();

    drawStars(p, T, level);
    drawShootingStar(t, p);
    glow(light.x, light.y, 0, R * 1.5, p.light, 0.13 * light.amount);

    const col = mix(p.wT, p.light, 0.45);
    const g = ctx.createLinearGradient(cx - R * 2.8, 0, cx + R * 2.8, 0);
    g.addColorStop(0, rgba(col, 0));
    g.addColorStop(0.32, rgba(col, 0.22));
    g.addColorStop(0.68, rgba(col, 0.22));
    g.addColorStop(1, rgba(col, 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = 1;
    for (let j = 0; j < 4; j++) {
      const y0 = level + R * (0.01 + j * j * 0.045);
      const dir = j % 2 ? -1 : 1;
      ctx.globalAlpha = 1 - j * 0.22;
      strokeCurve((x) => y0 + Math.sin(((x - cx) / R) * (2.2 + j) + T * (0.5 + j * 0.15) * dir) * R * (0.012 + j * 0.006), 0, W, 8);
    }
    ctx.globalAlpha = 1;
  }

  function drawSun(p, light, R) {
    glow(light.x, light.y, 0, R * 0.7, p.light, 0.35 * light.amount);
    if (p.sun > 0.01) {
      const g = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, R * 0.13);
      g.addColorStop(0, rgba([255, 255, 245], p.sun));
      g.addColorStop(0.55, rgba(p.light, p.sun * 0.95));
      g.addColorStop(1, rgba(p.light, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(light.x, light.y, R * 0.13, 0, TAU);
      ctx.fill();
    }
    if (p.moon > 0.01) {
      ctx.fillStyle = rgba([236, 240, 255], 0.95 * p.moon);
      ctx.beginPath();
      ctx.arc(light.x, light.y, R * 0.075, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(mix(p.skyT, p.skyB, 0.3), 0.9 * p.moon);   // crescent shadow
      ctx.beginPath();
      ctx.arc(light.x + R * 0.035, light.y - R * 0.02, R * 0.068, 0, TAU);
      ctx.fill();
    }
  }

  // Five layers back to front; distant ones take on the sky's haze.
  // Returns the front wave's surface function.
  function drawWaves(T, p, cx, cy, R, level) {
    const step = Math.max(2, R / 70);
    let front = null;
    WAVES.forEach((w, i) => {
      const f = waveFn(w, i, cx, R, level, T);
      ctx.beginPath();
      ctx.moveTo(cx - R, cy + R);
      for (let x = cx - R; x <= cx + R + step; x += step) ctx.lineTo(x, f(x));
      ctx.lineTo(cx + R, cy + R);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, level - R * 0.15, 0, level + R * 1.1);
      g.addColorStop(0, rgba(mix(mix(p.skyB, p.wT, 0.5), p.wT, w.depth), 0.5 + 0.35 * w.depth));
      g.addColorStop(1, rgba(p.wB, 0.92));
      ctx.fillStyle = g;
      ctx.fill();

      ctx.strokeStyle = rgba(p.light, 0.06 + 0.1 * w.depth);   // light catching each crest
      ctx.lineWidth = 1;
      strokeCurve(f, cx - R, cx + R, step);
      front = f;
    });
    return front;
  }

  // Additive light in the water: sun-rays, glitter path, drifting particles.
  function drawUnderwaterLight(T, p, cx, cy, R, front, light) {
    ctx.globalCompositeOperation = 'lighter';

    if (p.rays > 0.02) {
      for (let k = 0; k < 4; k++) {
        const x0 = cx + R * (-0.55 + 0.38 * k) + Math.sin(T * 0.25 + k * 1.3) * R * 0.08;
        const y0 = front(x0);
        const lean = R * 0.32;
        const g = ctx.createLinearGradient(0, y0, 0, y0 + R * 1.2);
        g.addColorStop(0, rgba(p.light, p.rays * (0.05 + 0.03 * Math.sin(T * 0.6 + k * 2))));
        g.addColorStop(1, rgba(p.light, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x0 - R * 0.05, y0);
        ctx.lineTo(x0 + R * 0.05, y0);
        ctx.lineTo(x0 + lean + R * 0.16, y0 + R * 1.3);
        ctx.lineTo(x0 + lean - R * 0.16, y0 + R * 1.3);
        ctx.closePath();
        ctx.fill();
      }
    }

    if (light.amount > 0.02) {
      for (const gl of GLITTER) {
        const flicker = Math.pow(Math.max(0, Math.sin(T * gl.spd + gl.ph)), 3);
        const a = light.amount * flicker * (1 - gl.d * 0.7) * 0.9;
        if (a < 0.02) continue;
        const x = light.x + gl.dx * R * (0.05 + 0.32 * gl.d);
        const y = front(x) + 2 + gl.d * R * 0.85;
        const len = R * (0.015 + 0.05 * gl.d) * gl.w;
        ctx.strokeStyle = rgba(p.light, a);
        ctx.lineWidth = 1 + gl.d;
        ctx.beginPath();
        ctx.moveTo(x - len, y);
        ctx.lineTo(x + len, y);
        ctx.stroke();
      }
    }

    // Sunlit motes by day, glowing plankton at night
    for (const m of MOTES) {
      const k = (m.ph + T * m.spd) % 1;
      const x = cx + m.x * R * 0.95 + Math.sin(T * 0.7 + m.wob) * R * 0.03;
      const y = cy + R - k * (cy + R - (front(x) + 6));
      const a = Math.sin(k * Math.PI) * (0.22 + 0.33 * p.plankton);
      const r = m.r * (1 + p.plankton * 0.4);
      if (p.plankton > 0.05) glow(x, y, 0, r * 4, p.motes, a * 0.25 * p.plankton);
      ctx.fillStyle = rgba(p.motes, a);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFoam(T, p, cx, R, front, breath) {
    const step = Math.max(2, R / 70);
    ctx.strokeStyle = rgba(mix([230, 248, 255], p.light, 0.3), 0.4 + 0.25 * breath);
    ctx.lineWidth = 1.6;
    strokeCurve(front, cx - R, cx + R, step);
    ctx.strokeStyle = rgba([230, 248, 255], 0.1);
    ctx.lineWidth = 1;
    strokeCurve((x) => front(x) + 4 + Math.sin(x * 0.08 + T) * 1.5, cx - R, cx + R, step);
  }

  /* ================= Frame ================= */

  // breath: 0 (empty lungs) .. 1 (full). t: seconds.
  function draw(breath, t) {
    if (!W) return;
    breath = clamp(breath, 0, 1);
    refreshPalette(t);
    const p = palette;
    const T = reduceMotion ? t * 0.3 : t;

    const cx = ocx, cy = ocy;
    const R = orbMax * (0.6 + 0.4 * breath);              // the orb grows with the breath…
    const level = cy + R - (0.2 + 0.62 * breath) * 2 * R;  // …and the tide rises inside it
    const light = {
      x: cx + R * 0.28, y: cy - R * (0.12 + 0.72 * p.alt), amount: p.sun + 0.6 * p.moon, breath,
    };

    updateShooting(t, p, level);
    updateBoat(t);
    updateGull(t, p);

    drawSurroundings(t, T, p, cx, cy, R, level, light);

    // Inside the orb
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();

    const sky = ctx.createLinearGradient(0, cy - R, 0, Math.max(level, cy - R + 1));
    sky.addColorStop(0, rgb(p.skyT));
    sky.addColorStop(1, rgb(p.skyB));
    ctx.fillStyle = sky;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

    drawStars(p, T, level);
    drawClouds(p, T, cx, cy, R);
    drawSun(p, light, R);
    drawGull(t, T, p, cx, level);
    const front = drawWaves(T, p, cx, cy, R, level);
    drawUnderwaterLight(T, p, cx, cy, R, front, light);
    drawFoam(T, p, cx, R, front, breath);
    drawBoat(t, T, p, front, cx, R);

    const sheen = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R);
    sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();

    ctx.strokeStyle = rgba(p.light, 0.1 + 0.12 * breath);   // rim
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, TAU);
    ctx.stroke();
  }

  window.Scene = {
    draw,

    // 'auto' follows the clock; 'day' | 'sunset' | 'night' force a sky.
    setSky(mode) {
      skyMode = mode;
      paletteStale = true;
    },

    // The sailboat only passes during a session, at a random moment.
    setSession(active) {
      if (active === inSession) return;
      inSession = active;
      if (active && !sailboat.cur) sailboat.next = performance.now() / 1000 + between(12, 52);
      if (!active && !DEBUG_BOAT) sailboat.next = Infinity;
    },
  };
})();
