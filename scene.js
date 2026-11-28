// Respire — la scène marine, dessinée en plein écran sur un <canvas>.
//
// Un orbe (le « hublot ») dont la taille et la marée suivent le souffle,
// un ciel qui change avec l'heure (aube, jour, couchant, nuit), et une mer
// qui déborde du cercle. Des bateaux et des mouettes passent, tirés au
// hasard (type, sens, nombre, distance). Sous l'eau, une faune de rêve :
// bancs de poissons, méduses, baleine, raie manta, et des dauphins qui sautent.
// La nuit, tout luit, et une étoile filante passe de temps en temps.
//
// La magie : une aura irisée et des lucioles qui suivent le souffle, une
// aurore boréale la nuit, des rayons et parfois un arc-en-ciel le jour, une
// arrivée en lumière, des moments rares (baleine qui saute, vague de plancton
// lumineux, pluie d'étoiles filantes) et une fête à la fin de la séance. Si
// les images arrivent trop lentement, la scène allège ses effets d'elle-même.
//
// API : Scene.draw(breath 0..1, tempsEnSecondes), Scene.setSky(mode),
// Scene.celebrate() (fin de séance).
//
// Paramètres d'URL pour le développement : ?h=19 force l'heure (en mode Auto),
// ?moment amène un moment rare toutes les 25 s, ?fete joue la fête de fin.
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

  /* ================= Helpers ================= */

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Works on numbers, colours, and lists of colours.
  const mix = (a, b, k) => (Array.isArray(a) ? a.map((v, i) => mix(v, b[i], k)) : a + (b - a) * k);
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
  // Lights rising slowly around the porthole: sea spray, embers, fireflies.
  const FIREFLIES = Array.from({ length: 42 }, (_, i) => ({
    x: rand(), y: rand(), spd: 0.006 + rand() * 0.016, sway: rand() * TAU, swayAmp: 8 + rand() * 30,
    r: 0.6 + rand() * rand() * 2.4, ph: rand() * TAU, tw: 0.6 + rand() * 1.6, c: i % 3,
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
  // aura: three colours for the halo, the iridescent rim, the aurora and the
  // floating lights · aurora/fire: how present those are · accent: UI colour
  // btn: the button's fill, glow and outline strength (soft and glassy by day)

  const NIGHT = {
    bg: [4, 6, 22], skyT: [5, 9, 32], skyB: [20, 38, 84], wT: [22, 86, 146], wB: [2, 10, 30],
    glow: [70, 140, 235], light: [225, 235, 255], sun: 0, moon: 1, alt: 0.62, stars: 1, clouds: 0.12,
    rays: 0, motes: [80, 230, 255], plankton: 1,
    aura: [[60, 215, 255], [150, 110, 255], [70, 255, 190]], aurora: 1, fire: 1, accent: [140, 228, 255], btn: [0.16, 0.4, 0],
  };
  const DAWN = {
    bg: [20, 12, 34], skyT: [54, 62, 134], skyB: [255, 172, 140], wT: [92, 134, 196], wB: [10, 22, 54],
    glow: [255, 170, 150], light: [255, 206, 160], sun: 1, moon: 0, alt: 0.16, stars: 0.12, clouds: 0.55,
    rays: 0.3, motes: [255, 212, 180], plankton: 0,
    aura: [[255, 176, 150], [196, 160, 255], [255, 220, 168]], aurora: 0.1, fire: 0.55, accent: [255, 222, 214], btn: [0.09, 0.2, 0.2],
  };
  const DAY = {
    bg: [4, 24, 46], skyT: [22, 118, 214], skyB: [150, 222, 246], wT: [18, 192, 212], wB: [4, 60, 112],
    glow: [90, 210, 255], light: [255, 250, 230], sun: 1, moon: 0, alt: 0.78, stars: 0, clouds: 0.7,
    rays: 1, motes: [235, 255, 255], plankton: 0,
    aura: [[90, 228, 255], [120, 255, 214], [255, 238, 186]], aurora: 0, fire: 0.4, accent: [214, 246, 252], btn: [0.07, 0.14, 0.24],
  };
  const AFTERNOON = {
    ...DAY, skyB: [192, 222, 236], wT: [28, 176, 206], alt: 0.55, light: [255, 236, 200],
    aura: [[110, 220, 255], [255, 218, 166], [140, 255, 220]],
  };
  const SUNSET = {
    bg: [26, 8, 32], skyT: [58, 40, 122], skyB: [255, 122, 92], wT: [150, 92, 152], wB: [16, 14, 50],
    glow: [255, 122, 110], light: [255, 172, 92], sun: 1, moon: 0, alt: 0.14, stars: 0.08, clouds: 0.8,
    rays: 0.3, motes: [255, 204, 152], plankton: 0,
    aura: [[255, 118, 150], [255, 190, 92], [176, 112, 255]], aurora: 0, fire: 0.75, accent: [255, 214, 228], btn: [0.08, 0.18, 0.24],
  };
  const DUSK = {
    bg: [12, 6, 30], skyT: [16, 16, 60], skyB: [122, 62, 152], wT: [52, 72, 154], wB: [4, 10, 36],
    glow: [160, 100, 232], light: [235, 226, 255], sun: 0, moon: 0.65, alt: 0.34, stars: 0.6, clouds: 0.3,
    rays: 0, motes: [150, 180, 255], plankton: 0.5,
    aura: [[200, 120, 255], [90, 172, 255], [255, 130, 200]], aurora: 0.45, fire: 0.85, accent: [210, 196, 255], btn: [0.13, 0.32, 0.08],
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
    // Page background matches the scene, so any strip the canvas does not
    // reach (under Safari's bars, the home indicator) never shows as black.
    const root = document.documentElement.style;
    root.setProperty('--bg', rgb(palette.bg));
    // The button and the progress ring take the colour of the moment.
    root.setProperty('--accent', rgb(palette.accent));
    const [fill, shine, line] = palette.btn;
    root.setProperty('--accent-bg', rgba(palette.accent, fill));
    root.setProperty('--accent-bg-hover', rgba(palette.accent, fill + 0.07));
    root.setProperty('--accent-glow', rgba(palette.accent, shine));
    root.setProperty('--accent-line', rgba(palette.accent, line));
    sprites = palette.aura.map(makeSprite);
    halos = palette.aura.map(makeHalo);
  }

  // Soft round light, pre-rendered once per palette: far cheaper to draw many
  // times per frame than a fresh radial gradient.
  let sprites = [];
  let halos = [];
  function makeSprite(col) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(mix(col, [255, 255, 255], 0.65), 1));
    gr.addColorStop(0.22, rgba(col, 0.6));
    gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return c;
  }
  // The same for the halo: a wide, even glow, no bright core.
  function makeHalo(col) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 12, 64, 64, 64);
    gr.addColorStop(0, rgba(col, 1));
    gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return c;
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
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // Read every frame: the anchor can move without changing size (the caption
  // below it grows or shrinks), and then the orb must follow the ring.
  function placeOrb() {
    const r = canvas.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    ocx = a.left + a.width / 2 - r.left;
    ocy = a.top + a.height / 2 - r.top;
    orbMax = a.width / 2;
  }

  /* ================= Visitors ================= */
  // Each visitor keeps `next`, the time of its next appearance.
  // Times are in real seconds (t), motion uses scene time (T, slowed if needed).
  // Boats and gulls come in random groups: a new group sets off after a pause
  // (usually short) once the last one has left, and the very first is already
  // on its way.

  // Start time for a new crossing; `first` puts it already partway across.
  const departure = (t, dur, first) => (first ? t - dur * between(0.25, 0.45) : t);

  // Shooting star — anywhere in the night sky. `meteors` holds the extra ones
  // of a shower (a rare moment, or the end of a session).
  const shooting = { next: between(6, 16), cur: null };
  const meteors = [];

  function newStreak(t, level, a0 = between(0.12, 0.37) * Math.PI, dir = eitherWay()) {
    return {
      t0: t, dur: between(0.9, 1.4), len: between(90, 180),
      x: W * between(0.1, 0.9), y: Math.min(level, H) * between(0.05, 0.45),
      a: dir > 0 ? a0 : Math.PI - a0,
    };
  }

  // Several shooting stars over a few seconds, all falling the same way.
  function meteorShower(t, level, n) {
    const dir = eitherWay();
    const a0 = between(0.15, 0.3) * Math.PI;
    for (let i = 0; i < n; i++) meteors.push(newStreak(t + between(0, 5), level, a0 + between(-0.04, 0.04), dir));
  }

  function updateShooting(t, p, level) {
    const s = shooting;
    if (!s.cur && t > s.next && p.stars > 0.5) s.cur = newStreak(t, level);
    if (s.cur && t - s.cur.t0 > s.cur.dur) {
      s.cur = null;
      s.next = t + between(14, 40);
    }
    for (let i = meteors.length - 1; i >= 0; i--) if (t - meteors[i].t0 > meteors[i].dur) meteors.splice(i, 1);
  }

  function drawShootingStar(t, p) {
    if (shooting.cur) drawStreak(shooting.cur, t, p);
    for (const m of meteors) drawStreak(m, t, p);
  }

  function drawStreak(s, t, p) {
    const k = (t - s.t0) / s.dur;
    if (k < 0) return;
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

  // Pause before the next group: usually short, sometimes a quiet sea or sky.
  const pause = () => (Math.random() < 0.65 ? between(1, 5) : between(6, 18));

  // Pick an index from a list of weights.
  const pick = (weights) => {
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i;
    return weights.length - 1;
  };

  // Boats — one to three at a time, each on its own wave. Farther lanes are
  // smaller, slower, hazier, and the waves in front hide their hulls now and then.
  const LANES = [
    { wave: 2, scale: 0.5, slow: 1.7, haze: 0.45 },
    { wave: 3, scale: 0.72, slow: 1.3, haze: 0.2 },
    { wave: 4, scale: 1, slow: 1, haze: 0 },   // front wave, drawn over the foam
  ];
  const FRONT_WAVE = 4;

  // Abstract silhouettes, bow towards +x, waterline at y = 0, about 1 unit tall.
  // `top` is the masthead (for the night light).
  const hullShape = (stern, bow, depth, sheer = 0) => {
    ctx.beginPath();
    ctx.moveTo(stern, -0.02);
    ctx.lineTo(bow, -0.02 - sheer);
    ctx.lineTo(bow - 0.18, depth);
    ctx.lineTo(stern + 0.17, depth);
    ctx.closePath();
    ctx.fill();
  };
  const mast = (x, top, bottom = -0.02) => {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  };
  const KINDS = {
    sloop: {
      size: 1, mast: -0.02, top: -1.12, weight: 5,
      draw(c) {
        ctx.fillStyle = c.hull;
        hullShape(-0.6, 0.62, 0.16);
        ctx.fillStyle = c.sail;
        ctx.beginPath();                       // mainsail, slightly curved leech
        ctx.moveTo(-0.02, -1.08);
        ctx.quadraticCurveTo(-0.42, -0.5, -0.5, -0.1);
        ctx.lineTo(-0.02, -0.1);
        ctx.fill();
        ctx.globalAlpha = c.fade * 0.8;
        ctx.beginPath();                       // jib
        ctx.moveTo(0.06, -0.92);
        ctx.lineTo(0.06, -0.12);
        ctx.lineTo(0.5, -0.12);
        ctx.fill();
        ctx.globalAlpha = c.fade;
        mast(0.02, -1.12);
      },
    },
    dinghy: {
      size: 0.75, mast: 0.05, top: -0.78, weight: 3, bob: 1.8,
      draw(c) {
        ctx.fillStyle = c.hull;
        hullShape(-0.42, 0.46, 0.13);
        ctx.fillStyle = c.sail;
        ctx.beginPath();                       // a single lateen-ish sail
        ctx.moveTo(0.05, -0.76);
        ctx.quadraticCurveTo(-0.22, -0.4, -0.36, -0.1);
        ctx.lineTo(0.12, -0.1);
        ctx.fill();
        ctx.globalAlpha = c.fade;
        mast(0.05, -0.78);
      },
    },
    trawler: {
      size: 0.95, mast: 0.32, top: -0.88, weight: 2, slow: 1.25,
      draw(c) {
        ctx.fillStyle = c.hull;
        hullShape(-0.68, 0.76, 0.18, 0.12);    // high bow
        ctx.fillStyle = c.sail;
        ctx.fillRect(-0.48, -0.4, 0.42, 0.38); // wheelhouse
        ctx.fillStyle = c.hull;
        ctx.fillRect(-0.52, -0.46, 0.5, 0.07); // its roof
        ctx.fillStyle = c.window;              // lit window at night
        ctx.fillRect(-0.24, -0.32, 0.12, 0.1);
        mast(0.32, -0.88, -0.06);
        ctx.lineWidth = 0.025;
        ctx.beginPath();                       // derrick and stays
        ctx.moveTo(0.32, -0.7);
        ctx.lineTo(-0.62, -0.12);
        ctx.moveTo(0.32, -0.84);
        ctx.lineTo(0.72, -0.16);
        ctx.stroke();
      },
    },
    schooner: {
      size: 1.15, mast: 0.2, top: -1.06, weight: 2, slow: 1.1,
      draw(c) {
        ctx.fillStyle = c.hull;
        hullShape(-0.78, 0.84, 0.17, 0.04);
        ctx.fillStyle = c.sail;
        ctx.beginPath();                       // mainsail, aft mast
        ctx.moveTo(-0.24, -1.12);
        ctx.quadraticCurveTo(-0.55, -0.6, -0.7, -0.12);
        ctx.lineTo(-0.24, -0.12);
        ctx.fill();
        ctx.beginPath();                       // foresail
        ctx.moveTo(0.18, -0.98);
        ctx.quadraticCurveTo(-0.05, -0.55, -0.16, -0.12);
        ctx.lineTo(0.18, -0.12);
        ctx.fill();
        ctx.globalAlpha = c.fade * 0.8;
        ctx.beginPath();                       // jib to the bowsprit
        ctx.moveTo(0.24, -0.92);
        ctx.lineTo(0.95, -0.08);
        ctx.lineTo(0.24, -0.12);
        ctx.fill();
        ctx.globalAlpha = c.fade;
        mast(-0.2, -1.18);
        mast(0.2, -1.06);
        ctx.beginPath();                       // bowsprit
        ctx.moveTo(0.8, -0.06);
        ctx.lineTo(0.98, -0.1);
        ctx.stroke();
      },
    },
  };
  const KIND_NAMES = Object.keys(KINDS);
  const KIND_WEIGHTS = KIND_NAMES.map((n) => KINDS[n].weight);

  const fleet = { next: -Infinity, boats: [], first: true, wait: false };

  function updateFleet(t) {
    const f = fleet;
    f.boats = f.boats.filter((b) => t - b.t0 < b.dur);
    if (f.wait && !f.boats.length) {   // the last one has gone: pause, then a new group
      f.wait = false;
      f.next = t + pause();
    }
    if (f.boats.length || f.wait || t < f.next) return;
    // 1 boat most of the time, sometimes 2, rarely 3; never two on one wave.
    const n = 1 + pick([62, 28, 10]);
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    if (n === 1 && Math.random() < 0.6) lanes.unshift(2);   // a lone boat is usually close
    let start = t;
    for (let i = 0; i < n; i++) {
      const lane = LANES[lanes[i]];
      const kind = KINDS[KIND_NAMES[pick(KIND_WEIGHTS)]];
      const dur = between(40, 80) * lane.slow * (kind.slow || 1);
      f.boats.push({
        t0: i === 0 ? departure(t, dur, f.first) : start, dur, dir: eitherWay(),
        kind, lane, size: between(0.85, 1.15) * kind.size * lane.scale, ph: Math.random() * TAU,
      });
      start += between(3, 20);   // the others follow a little later
    }
    f.first = false;
    f.wait = true;
  }

  function drawBoat(b, t, T, p, wave, cx, R) {
    const k = (t - b.t0) / b.dur;
    if (k < 0 || k > 1) return;
    const kind = b.kind;
    const x = cx + b.dir * (-1.1 + 2.2 * k) * R;
    const L = R * 0.11 * b.size;
    const slope = (wave(x + 3) - wave(x - 3)) / 6;
    const bob = kind.bob || 1;
    const y = wave(x) + L * 0.1 + Math.sin(T * 1.3 * bob + b.ph) * L * 0.03 * bob;
    const fade = Math.min(1, k * 20, (1 - k) * 20);

    // Daylight: white sails. Sunset: dark silhouette. Night: moonlit sails.
    // Farther boats fade into the colour of the horizon.
    const pale = Math.max(clamp((p.rays - 0.3) / 0.7, 0, 1), p.stars * 0.55);
    const haze = (c) => rgb(mix(c, p.skyB, b.lane.haze));
    const c = {
      fade,
      sail: haze(mix(mix(p.skyT, [0, 0, 0], 0.55), [244, 246, 250], pale)),
      hull: haze(mix(mix(p.skyT, [0, 0, 0], 0.7), [40, 60, 90], pale * 0.6)),
      window: rgb(mix(mix(p.skyT, [0, 0, 0], 0.7), [255, 205, 130], p.stars)),
    };

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan(slope) * 0.4 * bob + Math.sin(T * 0.9 * bob + b.ph) * 0.03 * bob);
    ctx.scale(b.dir * L, L);
    ctx.globalAlpha = fade * 0.92;
    ctx.strokeStyle = c.hull;
    ctx.lineWidth = 0.04;
    kind.draw(c);
    ctx.restore();

    if (p.stars > 0.3) {   // masthead light
      glow(x + b.dir * kind.mast * L, y + kind.top * L, 0, L * 0.35, [255, 210, 150], 0.7 * p.stars * fade * (1 - b.lane.haze * 0.5));
    }
  }

  function drawBoatsOn(wave, f, t, T, p, cx, R) {
    for (const b of fleet.boats) if (b.lane.wave === wave) drawBoat(b, t, T, p, f, cx, R);
  }

  // Seagulls — alone, in pairs, or a small loose flock.
  const flock = { next: -Infinity, gulls: [], first: true, wait: false };

  function updateFlock(t) {
    const f = flock;
    f.gulls = f.gulls.filter((g) => t - g.t0 < g.dur);
    if (f.wait && !f.gulls.length) {   // the last one has gone: pause, then a new group
      f.wait = false;
      f.next = t + pause();
    }
    if (f.gulls.length || f.wait || t < f.next) return;
    const n = 1 + pick([50, 26, 14, 7, 3]);
    const dir = eitherWay();
    const alt = between(0.38, 0.62);
    const dur = between(9, 19);
    const lead = departure(t, dur, f.first);
    for (let i = 0; i < n; i++) {
      // Most follow the leader; now and then one goes its own way.
      const stray = i > 0 && Math.random() < 0.15;
      const d = stray ? between(9, 19) : dur * between(0.88, 1.12);
      f.gulls.push({
        t0: i === 0 ? lead : (stray ? t + between(0, 6) : lead + between(0.3, 2.5) * i),
        dur: d, dir: stray ? -dir : dir,
        alt: clamp(alt + (i ? between(-0.12, 0.12) : 0), 0.3, 0.7),
        size: between(0.7, 1.15) * (n > 2 ? 0.85 : 1),
        ph: Math.random() * TAU, flapSpd: between(5, 7.5),
        // Flight path: a slow climb or dive, a looser undulation, uneven speed
        arc: between(-0.2, 0.2), arcF: between(0.6, 1.4),
        wob: between(0.03, 0.07), wobF: between(1.5, 3),
        surge: between(0.03, 0.06),
      });
    }
    f.first = false;
    f.wait = true;
  }

  function drawGull(G, t, T, p, cx, cy, R, level) {
    const k = (t - G.t0) / G.dur;
    if (k < 0 || k > 1) return;
    const path = (k) => {
      const kk = k + G.surge * Math.sin(k * TAU * 1.3 + G.ph);
      return [
        cx + G.dir * (-1.12 + 2.24 * kk) * R,
        cy - R * (G.alt + G.arc * Math.sin(k * Math.PI * G.arcF + G.ph * 0.3) + G.wob * Math.sin(k * TAU * G.wobF + G.ph)),
      ];
    };
    const size = R * 0.055 * G.size;
    const glide = 0.35 + 0.65 * Math.max(0, Math.sin(T * 0.45 + G.ph));   // stretches of gliding
    const flap = Math.sin(T * G.flapSpd + G.ph) * glide;

    let [x, y] = path(k);
    const [x2, y2] = path(k + 0.01);
    y += -flap * size * 0.18 + Math.sin(T * 0.8 + G.ph) * size * 0.15;     // wing beats lift the body
    y = Math.min(y, level - R * 0.16);                                     // stay above the tide
    const bank = clamp(Math.atan2(y2 - y, Math.abs(x2 - x) + 1e-6) * 0.6, -0.35, 0.35) * G.dir;

    const tip = size * (0.05 + 0.4 * flap);
    const arch = size * (0.42 + 0.2 * flap);
    // Dark silhouette by day and at sunset, moonlit grey at night
    const dusk = mix(mix(p.skyT, [0, 0, 0], 0.45), [70, 80, 95], clamp((p.rays - 0.3) / 0.7, 0, 1));
    const col = mix(dusk, [200, 210, 228], p.stars * 0.8);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bank);
    ctx.strokeStyle = rgba(col, 0.85);
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

  /* ================= Sea life ================= */
  // Dreamlike, abstract creatures: soft shadows by day, bioluminescent at night.
  // Each kind comes and goes at random, like the boats and the gulls.

  // A troupe spawns a group, waits for all of it to leave, pauses, starts again.
  function troupe(first, gap, spawn) {
    const tr = { next: first, items: [], wait: false };
    tr.update = (t) => {
      tr.items = tr.items.filter((v) => t - v.t0 < v.dur);
      if (tr.wait && !tr.items.length) {
        tr.wait = false;
        tr.next = t + gap();
      }
      if (!tr.wait && t >= tr.next) {
        tr.items = spawn(t);
        tr.wait = true;
      }
    };
    return tr;
  }

  // Progress (0..1) of a crossing, or -1 when it isn't on screen.
  const progress = (v, t) => {
    const k = (t - v.t0) / v.dur;
    return k < 0 || k > 1 ? -1 : k;
  };
  const edgeFade = (k, e = 12) => Math.min(1, k * e, (1 - k) * e);

  // A point in the water: depth 0 is the surface, 1 the bottom of the orb.
  const inWater = (front, x, d, cy, R) => {
    const s = front(x);
    return s + 4 + d * Math.max(0, cy + R - s - 4);
  };

  // Body colour under water: a darker shade of the sea by day, light at night.
  const deepShade = (p, k = 0.2) => mix(mix(p.wB, p.wT, k), p.motes, p.plankton * 0.85);

  const schools = troupe(between(1, 4), () => between(3, 14), (t) => {
    const out = [];
    const n = Math.random() < 0.25 ? 2 : 1;
    for (let j = 0; j < n; j++) {
      const s = {
        t0: t + j * between(2, 8), dur: between(14, 26), dir: eitherWay(),
        d: between(0.15, 0.7), amp: between(0.04, 0.14), f: between(0.6, 1.6),
        size: between(0.75, 1.2), ph: Math.random() * TAU, fish: [],
      };
      const count = Math.round(between(4, 14));
      for (let i = 0; i < count; i++) {
        s.fish.push({ ox: between(-0.22, 0.22), oy: between(-0.07, 0.07), ph: Math.random() * TAU, s: between(0.7, 1.1) });
      }
      out.push(s);
    }
    return out;
  });

  const JELLY_HUES = [[255, 175, 220], [170, 225, 255], [205, 185, 255], [190, 255, 225]];
  const jellies = troupe(between(5, 14), () => between(6, 25), (t) => {
    const n = 1 + pick([55, 25, 12, 8]);
    const hue = JELLY_HUES[Math.floor(Math.random() * JELLY_HUES.length)];
    const x = between(-0.55, 0.55);
    return Array.from({ length: n }, (_, i) => ({
      t0: t + i * between(1, 5), dur: between(26, 42),
      x: clamp(x + between(-0.3, 0.3), -0.75, 0.75), drift: between(-0.15, 0.15),
      size: between(0.6, 1.15) * (i ? 0.8 : 1), ph: Math.random() * TAU, hue,
    }));
  });

  const whales = troupe(between(15, 30), () => between(35, 90), (t) => [{
    t0: t, dur: between(50, 80), dir: eitherWay(), d: between(0.5, 0.72),
    size: between(0.85, 1.15), ph: Math.random() * TAU,
  }]);

  const mantas = troupe(between(25, 50), () => between(30, 80), (t) => [{
    t0: t, dur: between(26, 42), dir: eitherWay(), d: between(0.3, 0.65),
    size: between(0.8, 1.2), ph: Math.random() * TAU,
  }]);

  // Dolphins: a pod of one to three, each leaping two to four times as it goes.
  const dolphins = troupe(between(10, 25), () => between(20, 60), (t) => {
    const out = [];
    const n = 1 + pick([45, 35, 20]);
    const dir = eitherWay();
    const x0 = between(-0.85, -0.35);
    for (let i = 0; i < n; i++) {
      let tt = t + i * between(0.4, 1.4);
      let x = x0 + between(-0.12, 0.12);
      const leaps = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < leaps && x < 0.75; j++) {
        const jd = between(1.4, 2.0);
        out.push({
          t0: tt, jd, dur: jd + 0.6, dir, x, w: between(0.26, 0.36), h: between(0.13, 0.22),
          size: between(0.85, 1.1),
        });
        x += between(0.32, 0.48);
        tt += jd + between(0.6, 1.8);
      }
    }
    return out;
  });

  const SEA_LIFE = [schools, jellies, whales, mantas, dolphins];
  function updateSeaLife(t) {
    for (const tr of SEA_LIFE) tr.update(t);
  }

  // Shapes in unit coordinates, facing +x.
  function fishShape(wag) {
    ctx.beginPath();
    ctx.moveTo(0.55, 0);
    ctx.quadraticCurveTo(0.15, -0.3, -0.3, 0);
    ctx.quadraticCurveTo(0.15, 0.3, 0.55, 0);
    ctx.moveTo(-0.22, 0);
    ctx.lineTo(-0.6, -0.24 + wag);
    ctx.lineTo(-0.5, wag * 0.5);
    ctx.lineTo(-0.6, 0.24 + wag);
    ctx.closePath();
    ctx.fill();
  }

  function drawSchool(s, t, T, p, front, cx, cy, R) {
    const k = progress(s, t);
    if (k < 0) return;
    const fade = edgeFade(k);
    const L = R * 0.034 * s.size;
    const col = deepShade(p, 0.15);
    const depth = (kk, f) => clamp(s.d + s.amp * Math.sin(kk * Math.PI * s.f + s.ph) + f.oy + Math.sin(T * 1.1 + f.ph) * 0.012, 0.04, 0.95);
    for (const f of s.fish) {
      const kk = k + f.ox * 0.25;           // spread along the path
      const x = cx + s.dir * (-1.3 + 2.6 * kk) * R;
      const y = inWater(front, x, depth(kk, f), cy, R);
      const x2 = cx + s.dir * (-1.3 + 2.6 * (kk + 0.01)) * R;
      const y2 = inWater(front, x2, depth(kk + 0.01, f), cy, R);
      const a = clamp(Math.atan2(y2 - y, Math.abs(x2 - x)), -0.5, 0.5);
      const l = L * f.s;
      if (p.plankton > 0.05 && quality === 2) glow(x, y, 0, l * 2.2, p.motes, 0.22 * p.plankton * fade);
      // Now and then a fish turns and catches the light.
      const flash = Math.pow(Math.max(0, Math.sin(T * 0.9 + f.ph * 3)), 12) * (1 - p.plankton);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s.dir, 1);
      ctx.rotate(a);
      ctx.scale(l, l);
      ctx.fillStyle = rgba(mix(col, p.light, flash * 0.7), (0.4 + 0.3 * p.plankton + 0.3 * flash) * fade);
      fishShape(Math.sin(T * 7 + f.ph) * 0.1);
      ctx.restore();
    }
  }

  function drawJelly(j, t, T, p, front, cx, cy, R) {
    const k = progress(j, t);
    if (k < 0) return;
    const fade = Math.min(1, k * 8, (1 - k) * 5);
    const pulse = (Math.sin(T * 1.6 + j.ph) + 1) / 2;          // 1: bell contracted
    const x = cx + (j.x + j.drift * k + Math.sin(T * 0.3 + j.ph) * 0.03) * R;
    const d = 1.15 - 1.05 * k - 0.02 * pulse;                  // rises in small pushes
    const y = inWater(front, x, d, cy, R);
    const L = R * 0.06 * j.size;
    const col = mix(j.hue, p.light, 0.3 * (1 - p.plankton));
    const a = (0.22 + 0.38 * p.plankton) * fade;

    ctx.globalCompositeOperation = 'lighter';
    glow(x, y - L * 0.2, 0, L * (1.4 + p.plankton), j.hue, (0.06 + 0.22 * p.plankton) * fade);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(L, L);
    const sx = 1 + 0.14 * pulse, sy = 1 - 0.14 * pulse;
    ctx.fillStyle = rgba(col, a);
    ctx.beginPath();                                           // bell
    ctx.moveTo(-0.5 * sx, 0);
    ctx.bezierCurveTo(-0.5 * sx, -0.75 * sy, 0.5 * sx, -0.75 * sy, 0.5 * sx, 0);
    ctx.quadraticCurveTo(0.25 * sx, 0.12, 0, 0.04);
    ctx.quadraticCurveTo(-0.25 * sx, 0.12, -0.5 * sx, 0);
    ctx.fill();
    ctx.strokeStyle = rgba(col, a * 0.8);
    ctx.lineWidth = 0.04;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {                              // trailing tentacles
      const x0 = (-0.3 + i * 0.2) * sx;
      const sw = T * 1.2 + i * 1.3 + j.ph;
      ctx.beginPath();
      ctx.moveTo(x0, 0.06);
      ctx.quadraticCurveTo(x0 + Math.sin(sw) * 0.15, 0.5, x0 + Math.sin(sw + 1) * 0.22, 0.95 + 0.1 * pulse);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Whale silhouette, about 1 unit long, facing +x. beat: -1..1, the tail stroke.
  function whaleShape(beat) {
    const tb = 0.05 * beat;
    ctx.beginPath();                                           // body
    ctx.moveTo(0.5, 0.02);
    ctx.bezierCurveTo(0.48, -0.12, 0.2, -0.15, -0.05, -0.1);
    ctx.bezierCurveTo(-0.22, -0.06, -0.33, -0.02 + tb * 0.3, -0.4, tb * 0.5);
    ctx.lineTo(-0.4, 0.03 + tb * 0.5);
    ctx.bezierCurveTo(-0.3, 0.06, -0.1, 0.11, 0.15, 0.1);
    ctx.bezierCurveTo(0.35, 0.09, 0.5, 0.08, 0.5, 0.02);
    ctx.fill();
    ctx.beginPath();                                           // pectoral fin
    ctx.moveTo(0.22, 0.08);
    ctx.quadraticCurveTo(0.14, 0.2 + tb, 0.02, 0.24 + tb);
    ctx.quadraticCurveTo(0.1, 0.14, 0.15, 0.09);
    ctx.fill();
    ctx.save();                                                // flukes
    ctx.translate(-0.4, tb * 0.5 + 0.015);
    ctx.rotate(beat * 0.35);
    ctx.beginPath();
    ctx.moveTo(0.02, 0);
    ctx.quadraticCurveTo(-0.08, -0.1, -0.17, -0.11);
    ctx.quadraticCurveTo(-0.09, -0.03, -0.05, 0);
    ctx.quadraticCurveTo(-0.09, 0.03, -0.17, 0.11);
    ctx.quadraticCurveTo(-0.08, 0.1, 0.02, 0);
    ctx.fill();
    ctx.restore();
  }

  function drawWhale(w, t, T, p, front, cx, cy, R) {
    const k = progress(w, t);
    if (k < 0) return;
    const fade = edgeFade(k, 10);
    const x = cx + w.dir * (-1.6 + 3.2 * k) * R;
    const y = inWater(front, x, w.d + 0.04 * Math.sin(k * TAU * 0.7 + w.ph), cy, R);
    const L = R * 0.5 * w.size;
    const beat = Math.sin(T * 0.9 + w.ph);
    const night = p.plankton;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w.dir * L, L);
    ctx.rotate(0.05 * Math.cos(k * TAU * 0.7 + w.ph));
    ctx.fillStyle = rgba(mix(mix(p.wB, p.wT, 0.08), [0, 0, 0], night * 0.3), (0.38 + 0.15 * night) * fade);
    whaleShape(beat);

    // Constellation of lights along the flank, brightest at night.
    ctx.globalCompositeOperation = 'lighter';
    const spots = 0.12 + 0.7 * night;
    for (let i = 0; i < 9; i++) {
      const u = i / 8;
      const sx = 0.38 - u * 0.68;
      const sy = -0.04 + 0.05 * Math.sin(u * 5 + 1) + (i % 2) * 0.03;
      const tw = 0.6 + 0.4 * Math.sin(T * 1.3 + i * 2.1 + w.ph);
      glow(sx, sy, 0, 0.035, p.motes, spots * tw * fade);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  function drawManta(m, t, T, p, front, cx, cy, R) {
    const k = progress(m, t);
    if (k < 0) return;
    const fade = edgeFade(k, 10);
    const x = cx + m.dir * (-1.4 + 2.8 * k) * R;
    const y = inWater(front, x, m.d + 0.08 * Math.sin(k * TAU * 0.8 + m.ph), cy, R);
    const L = R * 0.3 * m.size;
    const w = Math.sin(T * 1.1 + m.ph);
    const up = 0.34 + 0.2 * w, dn = 0.2 - 0.12 * w;            // near wing high, far wing foreshortened

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(m.dir * L, L);
    ctx.rotate(-0.08 * w);
    ctx.fillStyle = rgba(deepShade(p, 0.1), (0.36 + 0.25 * p.plankton) * fade);
    ctx.beginPath();
    ctx.moveTo(0.28, 0);
    ctx.quadraticCurveTo(0.12, -up * 0.6, -0.08, -up);
    ctx.quadraticCurveTo(-0.04, -up * 0.4, -0.2, 0);
    ctx.quadraticCurveTo(-0.04, dn * 0.5, -0.06, dn);
    ctx.quadraticCurveTo(0.1, dn * 0.5, 0.28, 0);
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 0.015;
    ctx.beginPath();                                           // whip tail
    ctx.moveTo(-0.19, 0);
    ctx.quadraticCurveTo(-0.4, 0.03 * Math.sin(T * 1.1 + m.ph + 1), -0.62, 0.02);
    ctx.stroke();
    if (p.plankton > 0.05) {                                   // glowing wing edge
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(p.motes, 0.35 * p.plankton * fade);
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.moveTo(0.28, 0);
      ctx.quadraticCurveTo(0.12, -up * 0.6, -0.08, -up);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  // Everything below the surface, clipped to the water.
  function drawSeaLife(t, T, p, front, cx, cy, R) {
    const step = Math.max(2, R / 70);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - R, cy + R);
    for (let x = cx - R; x <= cx + R + step; x += step) ctx.lineTo(x, front(x) + 2);
    ctx.lineTo(cx + R, cy + R);
    ctx.closePath();
    ctx.clip();
    for (const w of whales.items) drawWhale(w, t, T, p, front, cx, cy, R);
    for (const m of mantas.items) drawManta(m, t, T, p, front, cx, cy, R);
    for (const s of schools.items) drawSchool(s, t, T, p, front, cx, cy, R);
    for (const j of jellies.items) drawJelly(j, t, T, p, front, cx, cy, R);
    for (const v of rare.items) if (v.kind === 'glow') drawPlanktonWave(v, t, T, p, front, cx, cy, R);
    ctx.restore();
  }

  // Dolphin leaps, above the surface (the part under water is hidden).
  // Dolphin silhouette, facing +x, about 1 unit long. What tells it from a
  // shark: a short beak under a rounded forehead, an arched back, a fin that
  // curves back like a hook, small crescent flukes, and a pale belly.
  function dolphinShape(body, belly) {
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0.55, 0.035);                                  // tip of the beak
    ctx.quadraticCurveTo(0.49, 0.012, 0.42, 0.004);           // beak
    ctx.bezierCurveTo(0.41, -0.055, 0.35, -0.088, 0.27, -0.092);   // rounded forehead
    ctx.bezierCurveTo(0.08, -0.1, -0.16, -0.06, -0.34, 0.012);     // arched back
    ctx.quadraticCurveTo(-0.4, 0.035, -0.44, 0.05);           // slim tail stock
    ctx.quadraticCurveTo(-0.5, 0.012, -0.61, 0.006);          // upper fluke
    ctx.quadraticCurveTo(-0.55, 0.045, -0.535, 0.07);         // notch
    ctx.quadraticCurveTo(-0.56, 0.1, -0.6, 0.135);            // lower fluke
    ctx.quadraticCurveTo(-0.5, 0.1, -0.43, 0.078);
    ctx.quadraticCurveTo(-0.1, 0.112, 0.2, 0.078);            // belly
    ctx.quadraticCurveTo(0.38, 0.058, 0.42, 0.036);           // throat
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();                                          // dorsal fin, hooked back
    ctx.moveTo(0.05, -0.096);
    ctx.quadraticCurveTo(-0.02, -0.17, -0.13, -0.2);
    ctx.quadraticCurveTo(-0.09, -0.13, -0.15, -0.075);
    ctx.fill();
    ctx.beginPath();                                          // pectoral fin
    ctx.moveTo(0.25, 0.06);
    ctx.quadraticCurveTo(0.2, 0.12, 0.13, 0.145);
    ctx.quadraticCurveTo(0.17, 0.09, 0.17, 0.065);
    ctx.fill();
    ctx.fillStyle = belly;                                    // pale belly, from throat to tail
    ctx.beginPath();
    ctx.moveTo(0.43, 0.034);
    ctx.quadraticCurveTo(0.3, 0.02, 0.1, 0.045);
    ctx.quadraticCurveTo(-0.15, 0.06, -0.38, 0.062);
    ctx.quadraticCurveTo(-0.1, 0.108, 0.2, 0.075);
    ctx.quadraticCurveTo(0.38, 0.056, 0.43, 0.034);
    ctx.fill();
  }

  // Droplets thrown up where something leaves or enters the water.
  // s: 0..1 through the splash · big: 1 for a dolphin, larger for a whale.
  function drawSplash(sx, sy, s, R, p, spray, big) {
    const n = big > 1 ? 12 : 6;
    ctx.fillStyle = rgba(spray, 0.6 * (1 - s));
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) / ((n - 1) / 2);
      ctx.beginPath();
      ctx.arc(
        sx + o * R * 0.035 * big * (0.4 + s),
        sy - R * 0.05 * big * Math.sin(s * Math.PI) * (1 - Math.abs(o) * 0.5) * (0.8 + 0.4 * Math.sin(i * 2.7)),
        Math.max(0.8, R * 0.006 * (big > 1 ? 1.3 : 1)), 0, TAU,
      );
      ctx.fill();
    }
    if (p.plankton > 0.05) glow(sx, sy, 0, R * 0.06 * big, p.motes, 0.3 * p.plankton * (1 - s));
  }

  function drawLeaps(t, T, p, front, cx, cy, R) {
    if (!dolphins.items.length) return;
    const step = Math.max(2, R / 70);
    const pale = Math.max(clamp((p.rays - 0.3) / 0.7, 0, 1), p.stars * 0.55);
    const body = mix(mix(p.skyT, [0, 0, 0], 0.6), [70, 100, 135], pale);
    const spray = mix([235, 248, 255], p.motes, p.plankton);

    for (const j of dolphins.items) {
      const u = (t - j.t0) / j.jd;
      if (u < -0.05 || u > 1.5) continue;
      const xAt = (v) => cx + j.dir * (j.x + v * j.w) * R;
      // Splashes where it leaves and re-enters the water
      for (const [s, at] of [[u / 0.3, 0], [(u - 0.9) / 0.5, 1]]) {
        if (s > 0 && s < 1) drawSplash(xAt(at), front(xAt(at)), s, R, p, spray, 1);
      }
      if (u < 0 || u > 1) continue;
      const x = xAt(u);
      const y = front(x) + R * 0.035 - j.h * R * 4 * u * (1 - u);
      const a = Math.atan2(-j.h * (4 - 8 * u), j.w);
      const L = R * 0.17 * j.size;   // a little larger, so the shape reads

      ctx.save();
      ctx.beginPath();                                         // clip: above the surface
      ctx.moveTo(cx - R, cy - R);
      ctx.lineTo(cx + R, cy - R);
      for (let xx = cx + R; xx >= cx - R - step; xx -= step) ctx.lineTo(xx, front(xx));
      ctx.closePath();
      ctx.clip();
      ctx.translate(x, y);
      ctx.scale(j.dir, 1);
      ctx.rotate(a);
      ctx.scale(L, L);
      dolphinShape(rgba(body, 0.94), rgba(mix(body, [225, 238, 248], 0.55 * pale), 0.9));
      ctx.restore();
    }
  }

  /* ================= Rare moments & the end of a session ================= */
  // Every few minutes, a surprise: a whale breaching, a wave of light running
  // through the plankton, a meteor shower. The end of a session brings one
  // too, with a burst of lights rising from the porthole.
  //
  // For testing: ?moment brings a rare moment every 25 s, ?fete plays the
  // end-of-session celebration a few seconds after loading.

  const TEST_MOMENTS = params.has('moment');
  const TEST_PARTY = params.has('fete');

  const rare = { next: TEST_MOMENTS ? 5 : between(70, 200), items: [] };

  function startRare(t, p, level, festive) {
    const options = [['breach', 3]];
    if (p.plankton > 0.3) options.push(['glow', 3]);
    if (p.stars > 0.5) options.push(['meteors', 3]);
    const kind = options[pick(options.map((o) => o[1]))][0];
    if (kind === 'meteors') {
      meteorShower(t, level, festive ? 10 : 7);
    } else if (kind === 'breach') {
      const jd = between(3, 3.6);
      rare.items.push({ kind, t0: t + (festive ? 1 : 0), jd, dur: jd + 2, dir: eitherWay(), x: between(-0.45, -0.05), size: between(0.9, 1.05) });
    } else {
      rare.items.push({ kind, t0: t, dur: 7, dir: eitherWay() });
    }
    // At a celebration in daylight, the dolphins come along too.
    if (festive && !dolphins.items.length) {
      dolphins.wait = false;
      dolphins.next = t + 1.5;
    }
  }

  function updateRare(t, p, level) {
    rare.items = rare.items.filter((v) => t - v.t0 < v.dur);
    if (t > rare.next) {
      startRare(t, p, level, false);
      rare.next = t + (TEST_MOMENTS ? 25 : between(180, 480));
    }
  }

  // Under water: a wave of light sweeping through the plankton.
  function drawPlanktonWave(v, t, T, p, front, cx, cy, R) {
    const k = (t - v.t0) / v.dur;
    if (k < 0 || k > 1) return;
    const bx = cx + v.dir * (-1.3 + 2.6 * k) * R;
    const a = Math.sin(k * Math.PI) * (0.25 + 0.5 * p.plankton);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(bx - R * 0.35, 0, bx + R * 0.35, 0);
    g.addColorStop(0, rgba(p.motes, 0));
    g.addColorStop(0.5, rgba(p.motes, 0.28 * a));
    g.addColorStop(1, rgba(p.motes, 0));
    ctx.fillStyle = g;
    ctx.fillRect(bx - R * 0.35, cy - R, R * 0.7, 2 * R);
    for (let i = 0; i < 28; i++) {                             // sparks within the wave
      const h1 = Math.sin(i * 12.9898) * 43758.5453 % 1;
      const h2 = Math.sin(i * 78.233) * 12543.21 % 1;
      const x = bx + h1 * R * 0.3;
      const y = inWater(front, x, Math.abs(h2) * 0.7 + 0.02, cy, R);
      const tw = 0.5 + 0.5 * Math.sin(T * 5 + i);
      ctx.fillStyle = rgba(mix(p.motes, [255, 255, 255], 0.5), a * tw);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.8, R * 0.007), 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Above water: the whale breaching, and the crest lit by the plankton wave.
  function drawRareAbove(t, T, p, front, cx, cy, R) {
    if (!rare.items.length) return;
    const step = Math.max(2, R / 70);
    const pale = Math.max(clamp((p.rays - 0.3) / 0.7, 0, 1), p.stars * 0.55);
    const body = mix(mix(p.skyT, [0, 0, 0], 0.6), [70, 100, 135], pale);
    const spray = mix([235, 248, 255], p.motes, p.plankton);

    for (const v of rare.items) {
      if (v.kind === 'glow') {
        const k = (t - v.t0) / v.dur;
        const bx = cx + v.dir * (-1.3 + 2.6 * k) * R;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(p.motes, 0.6 * Math.sin(k * Math.PI) * (0.3 + 0.7 * p.plankton));
        ctx.lineWidth = 2.5;
        strokeCurve(front, bx - R * 0.25, bx + R * 0.25, step);
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      // Breach: rises almost straight up, turns in the air, falls back.
      const u = (t - v.t0) / v.jd;
      if (u < -0.05) continue;
      const xAt = (q) => cx + v.dir * (v.x + q * 0.4) * R;
      for (const [s, at, big] of [[u / 0.35, 0, 2], [(u - 0.85) / 0.6, 1, 2.6]]) {
        if (s > 0 && s < 1) drawSplash(xAt(at), front(xAt(at)), s, R, p, spray, big);
      }
      if (u > 1) continue;
      const x = xAt(u);
      const y = front(x) + R * 0.3 - R * 0.85 * 4 * u * (1 - u);
      const a = Math.atan2(-0.85 * (4 - 8 * u), 0.4) + u * 0.5;   // nose up, then rolling over
      const L = R * 0.5 * v.size;
      ctx.save();
      ctx.beginPath();                                         // clip: above the surface
      ctx.moveTo(cx - R, cy - R);
      ctx.lineTo(cx + R, cy - R);
      for (let xx = cx + R; xx >= cx - R - step; xx -= step) ctx.lineTo(xx, front(xx));
      ctx.closePath();
      ctx.clip();
      ctx.translate(x, y);
      ctx.scale(v.dir, 1);
      ctx.rotate(a);
      ctx.scale(L, L);
      ctx.fillStyle = rgba(body, 0.95);
      whaleShape(Math.sin(T * 2.2));
      ctx.restore();
    }
  }

  // The celebration at the end of a session.
  let partyPending = false;
  let party = null;            // { t0 }
  const burst = [];

  function startParty(t, p, cx, cy, R, level) {
    party = { t0: t };
    burst.length = 0;
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * TAU;
      const v = R * between(0.12, 0.45);
      burst.push({
        t0: t + between(0, 1.4), life: between(4.5, 8.5),
        x0: cx + Math.cos(a) * R, y0: cy + Math.sin(a) * R,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - R * 0.12,
        r: 0.7 + Math.random() * 2, c: i % 3, ph: Math.random() * TAU,
      });
    }
    startRare(t, p, level, true);
  }

  // 0..1..0 over the celebration: how much the halo and the rim flare.
  function partyGlow(t) {
    if (!party) return 0;
    const e = t - party.t0;
    if (e > 10) {
      party = null;
      return 0;
    }
    return Math.min(1, e / 1.2) * Math.min(1, (10 - e) / 6);
  }

  function drawParty(t, p, cx, cy, R) {
    if (!party && !burst.length) return;
    ctx.globalCompositeOperation = 'lighter';
    if (party) {                                                // a ring of light opening out
      const e = (t - party.t0) / 2.8;
      if (e < 1) {
        const ease = 1 - Math.pow(1 - e, 3);
        ctx.strokeStyle = rgba(p.aura[0], 0.5 * (1 - ease));
        ctx.lineWidth = 2 + 8 * (1 - ease);
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1 + 1.2 * ease), 0, TAU);
        ctx.stroke();
      }
    }
    const bright = Math.max(p.fire, 0.8);
    for (let i = burst.length - 1; i >= 0; i--) {
      const b = burst[i];
      const k = (t - b.t0) / b.life;
      if (k > 1) {
        burst.splice(i, 1);
        continue;
      }
      if (k < 0 || !sprites.length) continue;
      const ease = 1 - Math.pow(1 - k, 2);
      const x = b.x0 + b.vx * ease * 2 + Math.sin(t * 1.3 + b.ph) * 6;
      const y = b.y0 + b.vy * ease * 2 - R * 0.3 * k;
      ctx.globalAlpha = clamp(bright * Math.pow(Math.sin(k * Math.PI), 0.7) * (0.55 + 0.45 * Math.sin(t * 3 + b.ph)), 0, 1);
      const s = b.r * 8;
      ctx.drawImage(sprites[b.c], x - s, y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ================= Breath & smoothness ================= */
  // How the breath moves (not only where it is): positive while breathing
  // in, negative while breathing out. The floating lights rise on the
  // in-breath and hang almost still on the out-breath.
  let lastT = null, lastBreath = 0;
  let inhale = 0;
  let fireClock = 0;

  // If frames come too slowly for a while (an older phone), drop the most
  // costly effects, once and for good: smooth beats lavish. 30 fps (low
  // power mode) is fine and does not count as slow.
  let quality = 2;             // 2: everything · 1: lighter · 0: essentials
  let slowFor = 0;

  function followBreath(t, breath) {
    const dt = lastT === null ? 0 : clamp(t - lastT, 0, 0.1);
    lastT = t;
    const rate = dt > 0 ? (breath - lastBreath) / dt : 0;
    lastBreath = breath;
    if (dt > 0) inhale += (clamp(rate / 0.18, -1, 1) - inhale) * (1 - Math.exp(-dt / 0.4));
    fireClock += dt * (reduceMotion ? 0.3 : 1) * (0.55 + 1.6 * Math.max(0, inhale) + 0.3 * Math.min(0, inhale));

    if (dt > 0 && dt < 0.1) {
      slowFor = dt > 1 / 26 ? slowFor + dt : Math.max(0, slowFor - dt * 0.5);
      if (slowFor > 2.5 && quality > 0) {
        quality--;
        slowFor = 0;
      }
    }
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

  // Northern lights: three soft curtains with a bright lower edge.
  function drawAurora(p, T, cx, cy, R, breath) {
    if (p.aurora <= 0.02) return;
    const step = Math.max(3, R / 40);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < (quality ? 3 : 1); i++) {
      const col = p.aura[(i + 2) % 3];
      const base = cy - R * (0.3 + i * 0.13);
      const h = R * (0.22 + 0.06 * i);
      const edge = (x) => {
        const u = (x - cx) / R;
        return base + R * (0.06 * Math.sin(u * 2.1 + T * 0.13 + i * 2) + 0.03 * Math.sin(u * 4.7 - T * 0.21 + i));
      };
      const tall = (x) => h * (0.55 + 0.45 * Math.sin(((x - cx) / R) * 3.3 + T * 0.17 + i * 1.3));
      const a = p.aurora * (0.8 + 0.2 * Math.sin(T * 0.3 + i * 2)) * (0.7 + 0.6 * breath);   // brighter on the in-breath
      const g = ctx.createLinearGradient(0, base - h - R * 0.1, 0, base + R * 0.1);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.7, rgba(col, 0.13 * a));
      g.addColorStop(1, rgba(col, 0.3 * a));
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let x = cx - R; x <= cx + R + step; x += step) ctx.lineTo(x, edge(x));
      for (let x = cx + R + step; x >= cx - R - step; x -= step) ctx.lineTo(x, edge(x) - tall(x));
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // The halo: three coloured lights turning slowly around the porthole,
  // swelling with the breath, and flaring at the end of a session.
  function drawAura(T, p, cx, cy, R, breath, flare) {
    if (!halos.length) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(0.07 + 0.07 * breath + 0.14 * flare, 0, 1);
    const r = R * (1.55 + 0.25 * breath + 0.35 * flare);
    for (let i = 0; i < 3; i++) {
      const a = T * 0.07 + (i * TAU) / 3;
      const d = R * (0.32 + 0.08 * Math.sin(T * 0.11 + i));
      ctx.drawImage(halos[i], cx + Math.cos(a) * d - r, cy + Math.sin(a) * d * 0.8 - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFireflies(T, p, breath) {
    if (!sprites.length || p.fire <= 0.02) return;
    ctx.globalCompositeOperation = 'lighter';
    const every = quality === 2 ? 1 : quality === 1 ? 2 : 4;
    for (let i = 0; i < FIREFLIES.length; i += every) {
      const f = FIREFLIES[i];
      const k = (f.y + fireClock * f.spd) % 1;   // fireClock runs faster on the in-breath
      const y = (1 - k) * (H + 40) - 20;
      const x = f.x * W + Math.sin(T * 0.3 + f.sway) * f.swayAmp;
      const twinkle = 0.45 + 0.55 * Math.pow((Math.sin(T * f.tw + f.ph) + 1) / 2, 2);
      ctx.globalAlpha = clamp(p.fire * twinkle * Math.sin(k * Math.PI) * (0.35 + f.r * 0.2) * (0.75 + 0.5 * breath), 0, 1);
      const s = f.r * 7;
      ctx.drawImage(sprites[f.c], x - s, y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Outside the orb: background, ambient glow, stars, and the sea's horizon
  // continuing beyond the porthole as faint swells.
  function drawSurroundings(t, T, p, cx, cy, R, level, light) {
    ctx.fillStyle = rgb(p.bg);
    ctx.fillRect(0, 0, W, H);
    glow(cx, cy, R * 0.5, R * 2.4, p.glow, 0.09 + 0.12 * light.breath);
    drawAura(T, p, cx, cy, R, light.breath, light.flare);
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
    drawFireflies(T, p, light.breath);
  }

  // Beams of light fanning out from the sun, turning very slowly.
  function drawSunRays(T, p, light, R) {
    const a = p.sun * (0.4 + 0.6 * p.rays);
    if (a <= 0.02 || quality < 2) return;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const ang = T * 0.012 + (i * TAU) / 8 + Math.sin(i * 2.3) * 0.25;
      const len = R * (0.9 + 0.35 * Math.sin(T * 0.21 + i * 1.7));
      const spread = 0.05 + 0.03 * Math.sin(i * 3.1);
      const g = ctx.createRadialGradient(light.x, light.y, R * 0.08, light.x, light.y, len);
      g.addColorStop(0, rgba(p.light, 0.11 * a * (0.7 + 0.3 * Math.sin(T * 0.4 + i))));
      g.addColorStop(1, rgba(p.light, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(light.x, light.y);
      ctx.arc(light.x, light.y, len, ang - spread, ang + spread);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Now and then, in daylight, a pale rainbow appears and fades away.
  const rainbow = { next: between(12, 45), cur: null };
  const RAINBOW = [[255, 90, 90], [255, 170, 70], [255, 235, 100], [110, 230, 120], [90, 170, 255], [170, 120, 255]];

  function drawRainbow(t, p, cx, R, level) {
    const rb = rainbow;
    if (!rb.cur && t > rb.next && p.rays > 0.5) {
      rb.cur = { t0: t, dur: between(35, 60), x: between(-0.35, 0.35), r: between(0.6, 0.85) };
    }
    if (!rb.cur) return;
    const k = (t - rb.cur.t0) / rb.cur.dur;
    if (k > 1) {
      rb.cur = null;
      rb.next = t + between(60, 180);
      return;
    }
    const a = Math.pow(Math.sin(k * Math.PI), 2) * p.rays * 0.13;
    const band = R * 0.016;
    const x = cx + rb.cur.x * R;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = band * 1.3;
    RAINBOW.forEach((c, i) => {
      ctx.strokeStyle = rgba(c, a);
      ctx.beginPath();
      ctx.arc(x, level + R * 0.1, R * rb.cur.r - i * band, Math.PI, TAU);
      ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
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
  // Returns the front wave's surface function. Farther boats are drawn on
  // their own wave, so the waves in front of them can hide their hulls.
  function drawWaves(T, p, cx, cy, R, level, t) {
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
      if (i !== FRONT_WAVE) drawBoatsOn(i, f, t, T, p, cx, R);
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
        if (flicker > 0.8 && gl.d < 0.6) {   // the brightest glints become little stars
          const s = len * (flicker - 0.8) * 4.5;
          ctx.moveTo(x, y - s);
          ctx.lineTo(x, y + s);
        }
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

  // The arrival: the scene rises out of the dark and the porthole opens with
  // a ring of light, in the first seconds after the page loads.
  const INTRO = reduceMotion ? 0.8 : 3.2;
  let tStart = null;
  let testPartyDone = false;

  function drawArrival(k, intro, p, cx, cy, R) {
    ctx.globalCompositeOperation = 'lighter';
    const fade = (1 - intro) * Math.min(1, k * 6);
    glow(cx, cy, R * 0.3, R * 2.3, p.light, 0.22 * Math.sin(k * Math.PI));
    ctx.strokeStyle = rgba(p.aura[0], 0.55 * fade);
    ctx.lineWidth = 2 + 10 * (1 - intro);
    ctx.beginPath();
    ctx.arc(cx, cy, R * (1 + 0.9 * intro), 0, TAU);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(p.bg, 1 - Math.min(1, k * 2.2));   // out of the dark
    ctx.fillRect(0, 0, W, H);
  }

  // The porthole's edge: an iridescent reflection turning slowly.
  function drawRim(T, p, cx, cy, R, breath, flare) {
    const a = clamp(0.2 + 0.22 * breath + 0.4 * flare, 0, 1);
    let rim = rgba(p.light, a);
    if (ctx.createConicGradient) {
      rim = ctx.createConicGradient(T * 0.12, cx, cy);
      p.aura.forEach((c, i) => rim.addColorStop(i / 3, rgba(c, a)));
      rim.addColorStop(1, rgba(p.aura[0], a));
    }
    ctx.strokeStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, TAU);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (!quality) return;
    ctx.globalCompositeOperation = 'lighter';               // and its soft glow
    ctx.globalAlpha = clamp(0.35 + 0.4 * flare, 0, 1);
    ctx.lineWidth = 5 + 6 * flare;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 1.5, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // breath: 0 (empty lungs) .. 1 (full). t: seconds.
  function draw(breath, t) {
    if (!W) return;
    placeOrb();
    breath = clamp(breath, 0, 1);
    refreshPalette(t);
    const p = palette;
    const T = reduceMotion ? t * 0.3 : t;
    if (tStart === null) tStart = t;
    const arrival = clamp((t - tStart) / INTRO, 0, 1);
    const intro = 1 - Math.pow(1 - arrival, 3);            // ease-out
    followBreath(t, breath);

    const cx = ocx, cy = ocy;
    const R = orbMax * (0.6 + 0.4 * breath) * (0.86 + 0.14 * intro);   // the orb grows with the breath…
    const level = cy + R - (0.2 + 0.62 * breath) * 2 * R;  // …and the tide rises inside it
    const light = {
      x: cx + R * 0.28, y: cy - R * (0.12 + 0.72 * p.alt), amount: p.sun + 0.6 * p.moon, breath,
      flare: partyGlow(t),
    };

    if (TEST_PARTY && !testPartyDone && t - tStart > 4) {
      testPartyDone = true;
      partyPending = true;
    }
    if (partyPending) {
      partyPending = false;
      startParty(t, p, cx, cy, R, level);
    }

    updateShooting(t, p, level);
    updateRare(t, p, level);
    updateFleet(t);
    updateFlock(t);
    updateSeaLife(t);

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
    drawAurora(p, T, cx, cy, R, breath);
    drawRainbow(t, p, cx, R, level);
    drawClouds(p, T, cx, cy, R);
    drawSunRays(T, p, light, R);
    drawSun(p, light, R);
    for (const g of flock.gulls) drawGull(g, t, T, p, cx, cy, R, level);
    const front = drawWaves(T, p, cx, cy, R, level, t);
    drawSeaLife(t, T, p, front, cx, cy, R);
    drawUnderwaterLight(T, p, cx, cy, R, front, light);
    drawFoam(T, p, cx, R, front, breath);
    drawLeaps(t, T, p, front, cx, cy, R);
    drawRareAbove(t, T, p, front, cx, cy, R);
    drawBoatsOn(FRONT_WAVE, front, t, T, p, cx, R);

    const sheen = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R);
    sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    if (quality) {   // warmer on the in-breath, cooler on the out-breath
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = rgba(mix([110, 170, 255], [255, 184, 130], breath), 0.14);
      ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    drawRim(T, p, cx, cy, R, breath, light.flare);
    drawParty(t, p, cx, cy, R);
    if (arrival < 1) drawArrival(arrival, intro, p, cx, cy, R);
  }

  window.Scene = {
    draw,

    // 'auto' follows the clock; 'day' | 'sunset' | 'night' force a sky.
    setSky(mode) {
      skyMode = mode;
      paletteStale = true;
    },

    // End of a session: a burst of lights, the halo flares, and a rare moment.
    celebrate() {
      partyPending = true;
    },
  };
})();
