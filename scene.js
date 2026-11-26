// Respire — scène marine plein écran : un orbe dont la marée suit le souffle,
// un ciel qui change avec l'heure, et une mer qui déborde du cercle.
(() => {
  'use strict';

  const canvas = document.getElementById('sea');
  const ctx = canvas.getContext('2d');
  const anchor = document.getElementById('orbAnchor');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;

  let W = 0, H = 0, ocx = 0, ocy = 0, orbMax = 0;

  /* ---------- Seeded randomness (stable layout) ---------- */

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

  /* ---------- Sky palettes over the day ---------- */

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
  const PRESETS = { day: 12.5, sunset: 19, night: 1 };

  const mix = (a, b, k) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * k) : a + (b - a) * k);
  function paletteAt(hour) {
    for (let i = 0; i < TIMELINE.length - 1; i++) {
      const [h0, p0] = TIMELINE[i];
      const [h1, p1] = TIMELINE[i + 1];
      if (hour >= h0 && hour <= h1) {
        const k = h1 === h0 ? 0 : (hour - h0) / (h1 - h0);
        const e = k * k * (3 - 2 * k);
        const out = {};
        for (const key in p0) out[key] = mix(p0[key], p1[key], e);
        return out;
      }
    }
    return NIGHT;
  }

  let skyMode = 'auto';
  let palette = NIGHT;
  let paletteAtMs = -Infinity;
  function currentHour() {
    if (PRESETS[skyMode] !== undefined) return PRESETS[skyMode];
    const q = new URLSearchParams(location.search).get('h');
    if (q !== null && !isNaN(q)) return ((Number(q) % 24) + 24) % 24;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }
  function refreshPalette() {
    palette = paletteAt(currentHour());
    if (themeMeta) themeMeta.setAttribute('content', rgb(palette.bg));
  }

  /* ---------- Helpers ---------- */

  const c = (v) => Math.round(Math.max(0, Math.min(255, v)));
  const rgb = (a) => `rgb(${c(a[0])},${c(a[1])},${c(a[2])})`;
  const rgba = (a, al) => `rgba(${c(a[0])},${c(a[1])},${c(a[2])},${Math.max(0, Math.min(1, al)).toFixed(3)})`;

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

  /* ---------- Waves ---------- */

  const WAVES = [
    { off: -0.13, amp: 0.05, k: 0.9, spd: 0.22, depth: 0 },
    { off: -0.08, amp: 0.055, k: 1.4, spd: -0.32, depth: 0.25 },
    { off: -0.035, amp: 0.05, k: 2.0, spd: 0.45, depth: 0.5 },
    { off: 0.005, amp: 0.045, k: 2.7, spd: -0.6, depth: 0.75 },
    { off: 0.045, amp: 0.04, k: 3.4, spd: 0.8, depth: 1 },
  ];

  function surfaceFn(w, i, cx, R, level, T) {
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

  /* ---------- Shooting stars ---------- */

  /* ---------- Sailboat passing far away ---------- */

  const DEBUG_BOAT = new URLSearchParams(location.search).has('boat');
  let sailing = false;           // true during a breathing session
  let boat = null;
  let nextBoat = Infinity;

  function scheduleBoat(T) {
    nextBoat = T + (DEBUG_BOAT ? 1.5 : 12 + Math.random() * 40);
  }

  function updateBoat(T) {
    if (nextBoat === -1) scheduleBoat(T);
    if (!boat && (sailing || DEBUG_BOAT) && T > nextBoat) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      boat = { t0: T, dur: DEBUG_BOAT ? 22 : 45 + Math.random() * 30, dir, size: 0.85 + Math.random() * 0.3 };
    }
    if (boat && T - boat.t0 > boat.dur) {
      boat = null;
      if (sailing || DEBUG_BOAT) scheduleBoat(T);
    }
  }

  // Abstract silhouette: a hull, a mast, a mainsail and a jib.
  function drawBoat(p, T, f, cx, R) {
    if (!boat) return;
    const k = (T - boat.t0) / boat.dur;
    const x = cx + boat.dir * (-1.15 + 2.3 * k) * R;
    const L = R * 0.11 * boat.size;
    const slope = (f(x + 3) - f(x - 3)) / 6;
    const y = f(x) + L * 0.06 + Math.sin(T * 1.3) * L * 0.03;
    const fadeIn = Math.min(1, k * 8, (1 - k) * 8);

    // Daylight: white sails. Sunset: dark silhouette. Night: moonlit sails.
    const pale = Math.max(Math.max(0, (p.rays - 0.3) / 0.7), p.stars * 0.55);
    const sail = mix(mix(p.skyT, [0, 0, 0], 0.55), [244, 246, 250], pale);
    const hull = mix(mix(p.skyT, [0, 0, 0], 0.7), [40, 60, 90], pale * 0.6);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan(slope) * 0.7 + Math.sin(T * 0.9) * 0.03);
    ctx.scale(boat.dir * L, L);
    ctx.globalAlpha = fadeIn * 0.92;

    ctx.fillStyle = rgb(hull);
    ctx.beginPath();
    ctx.moveTo(-0.6, -0.02);
    ctx.lineTo(0.62, -0.02);
    ctx.lineTo(0.45, 0.16);
    ctx.lineTo(-0.42, 0.16);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = rgb(sail);
    ctx.beginPath();                 // mainsail, slightly curved leech
    ctx.moveTo(0.02, -1.08);
    ctx.quadraticCurveTo(0.42, -0.5, 0.5, -0.1);
    ctx.lineTo(0.02, -0.1);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = fadeIn * 0.8;
    ctx.beginPath();                 // jib
    ctx.moveTo(-0.06, -0.92);
    ctx.lineTo(-0.06, -0.12);
    ctx.lineTo(-0.5, -0.12);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = fadeIn;
    ctx.strokeStyle = rgb(hull);
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.moveTo(-0.02, -1.12);
    ctx.lineTo(-0.02, -0.02);
    ctx.stroke();

    if (p.stars > 0.3) {             // masthead light at night
      ctx.restore();
      ctx.save();
      const mx = x - boat.dir * 0.02 * L;
      const my = y - 1.12 * L;
      glow(mx, my, 0, L * 0.35, [255, 210, 150], 0.7 * p.stars * fadeIn);
    }
    ctx.restore();
  }

  /* ---------- Shooting stars (state) ---------- */

  let shoot = null;
  let nextShoot = 6 + Math.random() * 10;
  if (DEBUG_BOAT) scheduleBoat(0);

  function drawShootingStar(T, p, level) {
    if (p.stars < 0.5) return;
    if (!shoot && T > nextShoot) {
      const a = (0.12 + Math.random() * 0.25) * Math.PI;
      shoot = {
        t0: T, x: W * (0.15 + Math.random() * 0.7), y: Math.min(level, H) * (0.05 + Math.random() * 0.35),
        a: Math.random() < 0.5 ? a : Math.PI - a, len: 90 + Math.random() * 90, dur: 0.9 + Math.random() * 0.5,
      };
    }
    if (!shoot) return;
    const k = (T - shoot.t0) / shoot.dur;
    if (k >= 1 || k < 0) {
      shoot = null;
      nextShoot = T + 14 + Math.random() * 26;
      return;
    }
    const dist = k * shoot.len * 2.2;
    const hx = shoot.x + Math.cos(shoot.a) * dist;
    const hy = shoot.y + Math.sin(shoot.a) * dist;
    const tx = hx - Math.cos(shoot.a) * shoot.len * (1 - k * 0.5);
    const ty = hy - Math.sin(shoot.a) * shoot.len * (1 - k * 0.5);
    const g = ctx.createLinearGradient(tx, ty, hx, hy);
    const a = Math.sin(k * Math.PI) * p.stars;
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, `rgba(235,242,255,${(0.85 * a).toFixed(3)})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();
  }

  function drawStars(p, T, level, alphaMul) {
    if (p.stars <= 0.01) return;
    for (const s of STARS) {
      const y = s.y * H;
      const fade = Math.min(1, Math.max(0, (level - 14 - y) / 60));
      if (fade <= 0) continue;
      const tw = 0.55 + 0.45 * Math.sin(T * s.spd + s.ph);
      ctx.fillStyle = `rgba(235,240,255,${(p.stars * tw * fade * alphaMul * (0.4 + s.r / 2.4)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x * W, y, s.r, 0, TAU);
      ctx.fill();
    }
  }

  function drawClouds(p, T, cx, cy, R) {
    if (p.clouds <= 0.02) return;
    const col = mix([255, 255, 255], p.light, 0.6);
    const shade = mix(p.skyB, p.skyT, 0.3);
    for (const cl of CLOUDS) {
      const span = R * 3.4;
      const x = cx - span / 2 + (((cl.ph + T * cl.spd) % 1) * span);
      const y = cy - R * (0.15 + cl.y * 0.75);
      const w = R * cl.w;
      for (let j = 0; j < cl.puffs; j++) {
        const px = x + (j - (cl.puffs - 1) / 2) * w * 0.42;
        const py = y - Math.sin((j / Math.max(1, cl.puffs - 1)) * Math.PI) * w * 0.12;
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(1, 0.42);
        glow(0, 0, 0, w * 0.42, mix(shade, col, 0.75), 0.33 * p.clouds);
        ctx.restore();
      }
    }
  }

  /* ---------- Frame ---------- */

  function draw(s, t) {
    if (!W) return;
    const nowMs = performance.now();
    if (nowMs - paletteAtMs > 5000) { refreshPalette(); paletteAtMs = nowMs; }
    const p = palette;
    const T = reduceMotion ? t * 0.3 : t;

    const cx = ocx, cy = ocy;
    const R = orbMax * (0.6 + 0.4 * s);
    const level = cy + R - (0.2 + 0.62 * s) * 2 * R;
    const lx = cx + R * 0.28;
    const ly = cy - R * (0.12 + 0.72 * p.alt);
    const lightAmt = p.sun + 0.6 * p.moon;
    updateBoat(T);

    // Background and ambient light spilling beyond the orb
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgb(p.bg);
    ctx.fillRect(0, 0, W, H);
    glow(cx, cy, R * 0.5, R * 2.4, p.glow, 0.09 + 0.12 * s);
    ctx.save();
    ctx.translate(cx, level);
    ctx.scale(1, 0.22);
    glow(0, 0, 0, Math.max(W, R * 3) * 0.75, p.skyB, 0.07 + 0.1 * p.sun);
    ctx.restore();

    drawStars(p, T, level, 1);
    drawShootingStar(T, p, level);
    glow(lx, ly, 0, R * 1.5, p.light, 0.13 * lightAmt);

    // The sea continuing beyond the porthole: ghost swells fading to the edges
    {
      const g = ctx.createLinearGradient(cx - R * 2.8, 0, cx + R * 2.8, 0);
      const col = mix(p.wT, p.light, 0.45);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.32, rgba(col, 0.22));
      g.addColorStop(0.68, rgba(col, 0.22));
      g.addColorStop(1, rgba(col, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1;
      for (let j = 0; j < 4; j++) {
        const y0 = level + R * (0.01 + j * j * 0.045);
        ctx.globalAlpha = 1 - j * 0.22;
        ctx.beginPath();
        for (let x = 0; x <= W + 8; x += 8) {
          const u = (x - cx) / R;
          ctx.lineTo(x, y0 + Math.sin(u * (2.2 + j) + T * (0.5 + j * 0.15) * (j % 2 ? -1 : 1)) * R * (0.012 + j * 0.006));
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // ---- Inside the orb ----
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();

    let g = ctx.createLinearGradient(0, cy - R, 0, Math.max(level, cy - R + 1));
    g.addColorStop(0, rgb(p.skyT));
    g.addColorStop(1, rgb(p.skyB));
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

    drawStars(p, T, level, 1);
    drawClouds(p, T, cx, cy, R);

    // Sun / moon
    glow(lx, ly, 0, R * 0.7, p.light, 0.35 * lightAmt);
    if (p.sun > 0.01) {
      const g2 = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 0.13);
      g2.addColorStop(0, rgba([255, 255, 245], p.sun));
      g2.addColorStop(0.55, rgba(p.light, p.sun * 0.95));
      g2.addColorStop(1, rgba(p.light, 0));
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(lx, ly, R * 0.13, 0, TAU);
      ctx.fill();
    }
    if (p.moon > 0.01) {
      ctx.fillStyle = rgba([236, 240, 255], 0.95 * p.moon);
      ctx.beginPath();
      ctx.arc(lx, ly, R * 0.075, 0, TAU);
      ctx.fill();
      // Crescent shadow
      ctx.fillStyle = rgba(mix(p.skyT, p.skyB, 0.3), 0.9 * p.moon);
      ctx.beginPath();
      ctx.arc(lx + R * 0.035, ly - R * 0.02, R * 0.068, 0, TAU);
      ctx.fill();
    }

    // Waves, back to front, with atmospheric haze on distant layers
    const step = Math.max(2, R / 70);
    let front = null;
    WAVES.forEach((w, i) => {
      const f = surfaceFn(w, i, cx, R, level, T);
      const top = mix(mix(p.skyB, p.wT, 0.5), p.wT, w.depth);
      ctx.beginPath();
      ctx.moveTo(cx - R, cy + R);
      for (let x = cx - R; x <= cx + R + step; x += step) ctx.lineTo(x, f(x));
      ctx.lineTo(cx + R, cy + R);
      ctx.closePath();
      g = ctx.createLinearGradient(0, level - R * 0.15, 0, level + R * 1.1);
      g.addColorStop(0, rgba(top, 0.5 + 0.35 * w.depth));
      g.addColorStop(1, rgba(p.wB, 0.92));
      ctx.fillStyle = g;
      ctx.fill();

      // Light catching each crest
      ctx.beginPath();
      for (let x = cx - R; x <= cx + R + step; x += step) ctx.lineTo(x, f(x));
      ctx.strokeStyle = rgba(p.light, 0.06 + 0.1 * w.depth);
      ctx.lineWidth = 1;
      ctx.stroke();
      if (i === 0) drawBoat(p, T, f, cx, R);
      if (i === WAVES.length - 1) front = f;
    });

    ctx.globalCompositeOperation = 'lighter';

    // Sun-rays under the surface
    if (p.rays > 0.02) {
      for (let k = 0; k < 4; k++) {
        const x0 = cx + R * (-0.55 + 0.38 * k) + Math.sin(T * 0.25 + k * 1.3) * R * 0.08;
        const y0 = front(x0);
        const lean = R * 0.32;
        const a = p.rays * (0.05 + 0.03 * Math.sin(T * 0.6 + k * 2));
        g = ctx.createLinearGradient(0, y0, 0, y0 + R * 1.2);
        g.addColorStop(0, rgba(p.light, a));
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

    // Glittering path of the sun / moon on the water
    if (lightAmt > 0.02) {
      for (const gl of GLITTER) {
        const depth = gl.d;
        const spread = R * (0.05 + 0.32 * depth);
        const x = lx + gl.dx * spread;
        const y = front(x) + 2 + depth * R * 0.85;
        const fl = Math.pow(Math.max(0, Math.sin(T * gl.spd + gl.ph)), 3);
        const a = lightAmt * fl * (1 - depth * 0.7) * 0.9;
        if (a < 0.02) continue;
        const len = R * (0.015 + 0.05 * depth) * gl.w;
        ctx.strokeStyle = rgba(p.light, a);
        ctx.lineWidth = 1 + depth;
        ctx.beginPath();
        ctx.moveTo(x - len, y);
        ctx.lineTo(x + len, y);
        ctx.stroke();
      }
    }

    // Drifting particles: sunlit motes by day, glowing plankton at night
    for (const m of MOTES) {
      const k = (m.ph + T * m.spd) % 1;
      const x = cx + m.x * R * 0.95 + Math.sin(T * 0.7 + m.wob) * R * 0.03;
      const yBottom = cy + R;
      const yTop = front(x) + 6;
      const y = yBottom - k * (yBottom - yTop);
      const a = Math.sin(k * Math.PI) * (0.22 + 0.33 * p.plankton);
      const r = m.r * (1 + p.plankton * 0.4);
      if (p.plankton > 0.05) glow(x, y, 0, r * 4, p.motes, a * 0.25 * p.plankton);
      ctx.fillStyle = rgba(p.motes, a);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';

    // Foam on the front crest
    ctx.beginPath();
    for (let x = cx - R; x <= cx + R + step; x += step) ctx.lineTo(x, front(x));
    ctx.strokeStyle = rgba(mix([230, 248, 255], p.light, 0.3), 0.4 + 0.25 * s);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    for (let x = cx - R; x <= cx + R + step; x += step) ctx.lineTo(x, front(x) + 4 + Math.sin(x * 0.08 + T) * 1.5);
    ctx.strokeStyle = rgba([230, 248, 255], 0.1);
    ctx.lineWidth = 1;
    ctx.stroke();

    // Glassy sheen
    g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R);
    g.addColorStop(0, 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();

    // Rim
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, TAU);
    ctx.strokeStyle = rgba(p.light, 0.1 + 0.12 * s);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  window.Scene = {
    draw,
    // Boats only sail by during a session, at random intervals.
    setSailing(on) {
      if (on === sailing) return;
      sailing = on;
      if (on && !boat) nextBoat = -1;   // scheduled on the next frame, in scene time
    },
    setSky(mode) {
      skyMode = mode;
      paletteAtMs = -Infinity;
    },
  };
})();
