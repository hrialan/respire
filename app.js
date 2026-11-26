(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const sea = $('sea');
  const ctx = sea.getContext('2d');
  const ringProgress = $('ringProgress');
  const phaseEl = $('phase');
  const subEl = $('sub');
  const sheet = $('sheet');
  const backdrop = $('backdrop');

  /* ---------- Settings ---------- */

  const SETTINGS_KEY = 'respire.settings';
  const STATS_KEY = 'respire.stats';
  const DEFAULTS = { duration: 5, rhythm: '5-5', inhale: 5, exhale: 5, vibration: true, sound: false };

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
    },
  };

  const settings = { ...DEFAULTS, ...store.get(SETTINGS_KEY, {}) };
  const save = () => store.set(SETTINGS_KEY, settings);

  function rhythm() {
    if (settings.rhythm === 'custom') return [settings.inhale, settings.exhale];
    return settings.rhythm.split('-').map(Number);
  }

  const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  /* ---------- Text ---------- */

  let phaseText = phaseEl.textContent;
  let phaseTimer = 0;
  function setPhase(text) {
    if (text === phaseText) return;
    phaseText = text;
    phaseEl.classList.add('out');
    clearTimeout(phaseTimer);
    phaseTimer = setTimeout(() => {
      phaseEl.textContent = text;
      phaseEl.classList.remove('out');
    }, 200);
  }

  function homeSummary() {
    const [i, x] = rhythm();
    return `${settings.duration} min · ${fmt(i)} s / ${fmt(x)} s`;
  }

  /* ---------- Haptics ---------- */

  const canVibrate = typeof navigator.vibrate === 'function';
  const PATTERNS = { in: [45], out: [30, 90, 30], end: [60, 110, 60, 110, 220], tap: [12] };
  const IOS_TICKS = { in: 1, out: 2, end: 3, tap: 1 };

  // iOS Safari has no Vibration API. Since iOS 18, toggling a native
  // <input type="checkbox" switch> plays a system haptic.
  function iosTick() {
    try {
      const label = document.createElement('label');
      label.ariaHidden = 'true';
      label.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      label.appendChild(input);
      document.head.appendChild(label);
      label.click();
      label.remove();
    } catch { /* ignore */ }
  }

  function haptic(kind) {
    if (!settings.vibration) return;
    if (canVibrate) {
      try { navigator.vibrate(PATTERNS[kind]); } catch { /* ignore */ }
    } else {
      for (let k = 0; k < IOS_TICKS[kind]; k++) setTimeout(iosTick, k * 140);
    }
  }

  /* ---------- Sound: synthesized surf ---------- */
  // Pink noise through a low-pass filter. As the breath swells, the filter
  // opens and the volume rises: a wave rolling in, then drawing back.

  let actx = null;
  let master = null;
  let noiseBuf = null;
  let surf = null;

  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!actx) {
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 1;
      master.connect(actx.destination);
    }
    if (actx.state === 'suspended') actx.resume();
  }

  function pinkNoise() {
    if (noiseBuf) return noiseBuf;
    const len = actx.sampleRate * 8;
    noiseBuf = actx.createBuffer(2, len, actx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = noiseBuf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      // Crossfade the loop seam
      const fade = actx.sampleRate * 0.5;
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[i] = d[i] * k + d[len - fade + i] * (1 - k);
      }
    }
    return noiseBuf;
  }

  function createSurf() {
    const src = actx.createBufferSource();
    src.buffer = pinkNoise();
    src.loop = true;
    src.loopEnd = noiseBuf.duration - 0.5;
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.4;
    lp.frequency.value = 200;
    const hp = actx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 60;
    const gain = actx.createGain();
    gain.gain.value = 0;
    src.connect(hp).connect(lp).connect(gain).connect(master);
    src.start();
    return { src, lp, gain };
  }

  const surfFreq = (s) => 180 + 1500 * s * s;
  const surfGain = (s) => 0.03 + 0.3 * s;

  function startSurf() {
    if (!settings.sound) return;
    unlockAudio();
    if (actx && !surf) surf = createSurf();
  }

  function updateSurf(s, on = true) {
    if (!surf) return;
    const t = actx.currentTime;
    surf.lp.frequency.setTargetAtTime(surfFreq(s), t, 0.06);
    surf.gain.gain.setTargetAtTime(on ? surfGain(s) : 0, t, on ? 0.06 : 0.35);
  }

  function stopSurf(fade = 1.2) {
    if (!surf) return;
    const { src, lp, gain } = surf;
    surf = null;
    const t = actx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setTargetAtTime(0, t, fade / 4);
    lp.frequency.setTargetAtTime(150, t, fade / 3);
    src.stop(t + fade + 0.3);
  }

  // One wave rolling in and out, to preview the sound in settings.
  function previewSurf() {
    unlockAudio();
    if (!actx) return;
    const w = createSurf();
    const t = actx.currentTime;
    w.gain.gain.setValueAtTime(0, t);
    w.gain.gain.linearRampToValueAtTime(surfGain(1), t + 1.8);
    w.gain.gain.linearRampToValueAtTime(0, t + 4);
    w.lp.frequency.setValueAtTime(surfFreq(0), t);
    w.lp.frequency.exponentialRampToValueAtTime(surfFreq(1), t + 1.8);
    w.lp.frequency.exponentialRampToValueAtTime(surfFreq(0), t + 4);
    w.src.stop(t + 4.2);
  }

  const cue = haptic;

  /* ---------- Sea rendering ---------- */

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0;
  let H = 0;

  function resize() {
    const r = sea.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    sea.width = Math.round(W * dpr);
    sea.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(sea);

  // Back to front. off: height offset (×R), amp: amplitude (×R), k: waves across, spd: rad/s
  const WAVES = [
    { off: -0.09, amp: 0.06, k: 1.2, spd: 0.4, top: [45, 115, 170, 0.5], bot: [4, 18, 40, 0.85] },
    { off: -0.03, amp: 0.055, k: 1.8, spd: -0.55, top: [55, 150, 200, 0.55], bot: [4, 22, 48, 0.9] },
    { off: 0.03, amp: 0.045, k: 2.5, spd: 0.75, top: [95, 195, 225, 0.6], bot: [3, 16, 36, 0.96] },
  ];
  const rgba = (c, a = c[3]) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function drawSea(s, t) {
    if (!W) return;
    const tt = reduceMotion ? t * 0.25 : t;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    const R = (W / 3) * (0.6 + 0.4 * s);   // canvas is 150% of the stage box
    const TAU = Math.PI * 2;

    // Halo
    let g = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.5);
    g.addColorStop(0, `rgba(70,170,215,${0.14 + 0.2 * s})`);
    g.addColorStop(1, 'rgba(70,170,215,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.5, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();

    // Night sky inside the orb
    g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    g.addColorStop(0, '#071423');
    g.addColorStop(1, '#0c2639');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

    // Tide: water surface rises with the breath
    const level = cy + R - (0.2 + 0.62 * s) * 2 * R;
    const step = Math.max(2, R / 60);

    WAVES.forEach((w, i) => {
      const surface = (x) => {
        const u = (x - cx) / R;
        return level + w.off * R + w.amp * R * (
          0.65 * Math.sin(u * w.k * Math.PI + tt * w.spd + i * 1.7) +
          0.35 * Math.sin(u * w.k * 2.3 * Math.PI - tt * w.spd * 1.4 + i)
        );
      };
      ctx.beginPath();
      ctx.moveTo(cx - R, cy + R);
      for (let x = cx - R; x <= cx + R + step; x += step) ctx.lineTo(x, surface(x));
      ctx.lineTo(cx + R, cy + R);
      ctx.closePath();
      g = ctx.createLinearGradient(0, level - R * 0.1, 0, level + R * 1.1);
      g.addColorStop(0, rgba(w.top));
      g.addColorStop(1, rgba(w.bot));
      ctx.fillStyle = g;
      ctx.fill();

      if (i === WAVES.length - 1) {
        // Foam on the front crest
        ctx.beginPath();
        for (let x = cx - R; x <= cx + R + step; x += step) ctx.lineTo(x, surface(x));
        ctx.strokeStyle = `rgba(215,245,255,${0.35 + 0.25 * s})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });

    // Glassy sheen
    g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R * 0.9);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();

    // Rim
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, TAU);
    ctx.strokeStyle = `rgba(160,225,245,${0.1 + 0.12 * s})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ---------- Wake lock ---------- */

  let wake = null;
  async function requestWake() {
    if (!('wakeLock' in navigator) || wake) return;
    try {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } catch { wake = null; }
  }
  function releaseWake() {
    try { if (wake) wake.release(); } catch { /* ignore */ }
    wake = null;
  }

  /* ---------- Stats ---------- */

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  function recordSession() {
    const stats = store.get(STATS_KEY, { day: '', count: 0 });
    const day = today();
    const count = stats.day === day ? stats.count + 1 : 1;
    store.set(STATS_KEY, { day, count });
    return count;
  }

  /* ---------- Engine ---------- */

  let state = 'home';
  let run = null;
  let countdownStart = 0;
  let vis = 0.4;              // current breath level (orb size + tide), 0..1
  let last = performance.now();
  let hintTimer = 0;

  function setState(s) {
    state = s;
    app.dataset.state = s;
  }

  function setProgress(p) {
    ringProgress.style.strokeDashoffset = String(1 - Math.min(1, Math.max(0, p)));
  }

  function startSession() {
    if (state !== 'home') return;
    closeSheet();
    startSurf();
    requestWake();

    const [inh, exh] = rhythm();
    const cycleMs = (inh + exh) * 1000;
    const cycles = Math.max(1, Math.round((settings.duration * 60000) / cycleMs));
    run = {
      inhMs: inh * 1000,
      exhMs: exh * 1000,
      cycleMs,
      cycles,
      totalMs: cycles * cycleMs,
      start: 0,
      pausedAt: 0,
      pausedTotal: 0,
      lastKey: -1,
      rem: -1,
      silentNext: false,
    };

    setProgress(0);
    setState('countdown');
    countdownStart = performance.now();
    setPhase('3');
    subEl.textContent = 'Installez-vous';
  }

  function beginRun(now) {
    run.start = now;
    setState('running');
    app.classList.add('show-hint');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => app.classList.remove('show-hint'), 5000);
  }

  function pause() {
    if (state !== 'running') return;
    run.pausedAt = performance.now();
    setState('paused');
    setPhase('En pause');
    subEl.textContent = 'Touchez pour reprendre';
    updateSurf(vis, false);
    releaseWake();
  }

  function resume() {
    if (state !== 'paused') return;
    run.pausedTotal += performance.now() - run.pausedAt;
    run.lastKey = -1;
    run.rem = -1;
    run.silentNext = true;   // restore the label without re-firing the cue mid-phase
    setState('running');
    requestWake();
  }

  function finish() {
    const count = recordSession();
    setState('done');
    setProgress(1);
    cue('end');
    stopSurf(4);
    releaseWake();
    const mins = Math.max(1, Math.round(run.totalMs / 60000));
    const nth = count === 1 ? '1ʳᵉ' : `${count}ᵉ`;
    setPhase('Séance terminée');
    subEl.textContent = `${mins} min · ${run.cycles} respirations\n${nth} séance aujourd’hui`;
    run = null;
  }

  function goHome() {
    setState('home');
    run = null;
    stopSurf();
    releaseWake();
    setPhase('Respire');
    subEl.textContent = homeSummary();
    setTimeout(() => { if (state === 'home') setProgress(0); }, 1000);
  }

  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    let target = null;

    if (state === 'running') {
      const e = now - run.start - run.pausedTotal;
      if (e >= run.totalMs) {
        finish();
        vis = 0;
      } else {
        const idx = Math.floor(e / run.cycleMs);
        const pos = e - idx * run.cycleMs;
        const inhaling = pos < run.inhMs;
        const p = inhaling ? pos / run.inhMs : (pos - run.inhMs) / run.exhMs;
        vis = inhaling ? (1 - Math.cos(Math.PI * p)) / 2 : (1 + Math.cos(Math.PI * p)) / 2;

        const key = idx * 2 + (inhaling ? 0 : 1);
        if (key !== run.lastKey) {
          run.lastKey = key;
          if (run.silentNext) run.silentNext = false;
          else cue(inhaling ? 'in' : 'out');
          setPhase(inhaling ? 'Inspirez' : 'Expirez');
        }
        const rem = Math.ceil((run.totalMs - e) / 1000);
        if (rem !== run.rem) {
          run.rem = rem;
          subEl.textContent = mmss(rem);
        }
        setProgress(e / run.totalMs);
        updateSurf(vis);
      }
    } else if (state === 'countdown') {
      const e = now - countdownStart;
      if (e >= 3000) beginRun(now);
      else setPhase(String(3 - Math.floor(e / 1000)));
      target = 0;
    } else if (state === 'home' || state === 'done') {
      // Slow idle breathing
      target = 0.42 + 0.1 * Math.sin((now / 8000) * 2 * Math.PI);
    }

    if (target !== null) vis += (target - vis) * (1 - Math.exp(-dt / 350));
    if (state === 'countdown') updateSurf(vis);
    drawSea(vis, now / 1000);
    requestAnimationFrame(frame);
  }

  /* ---------- Settings sheet ---------- */

  const custom = $('custom');
  const inhaleR = $('inhaleR');
  const exhaleR = $('exhaleR');
  const vibToggle = $('vibToggle');
  const soundToggle = $('soundToggle');

  function renderSettings() {
    document.querySelectorAll('.seg').forEach((seg) => {
      const key = seg.dataset.key;
      seg.querySelectorAll('button').forEach((b) => {
        const active = String(settings[key]) === b.dataset.v;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
    });
    custom.hidden = settings.rhythm !== 'custom';
    inhaleR.value = settings.inhale;
    exhaleR.value = settings.exhale;
    $('inhaleV').textContent = `${fmt(settings.inhale)} s`;
    $('exhaleV').textContent = `${fmt(settings.exhale)} s`;
    const [i, x] = rhythm();
    $('rhythmNote').textContent = `${fmt(60 / (i + x))} respirations par minute`;
    vibToggle.checked = settings.vibration;
    soundToggle.checked = settings.sound;
    $('vibNote').hidden = canVibrate || !settings.vibration;
    if (state === 'home') subEl.textContent = homeSummary();
  }

  function openSheet() {
    if (state !== 'home') return;
    sheet.inert = false;
    sheet.classList.add('open');
    backdrop.classList.add('open');
  }
  function closeSheet() {
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    sheet.inert = true;
  }

  document.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const key = seg.dataset.key;
      settings[key] = key === 'duration' ? Number(b.dataset.v) : b.dataset.v;
      save();
      renderSettings();
      haptic('tap');
    });
  });

  inhaleR.addEventListener('input', () => { settings.inhale = Number(inhaleR.value); save(); renderSettings(); });
  exhaleR.addEventListener('input', () => { settings.exhale = Number(exhaleR.value); save(); renderSettings(); });

  vibToggle.addEventListener('change', () => {
    settings.vibration = vibToggle.checked;
    save();
    renderSettings();
    haptic('in');
  });
  soundToggle.addEventListener('change', () => {
    settings.sound = soundToggle.checked;
    save();
    renderSettings();
    if (settings.sound) previewSurf();
  });

  $('settingsBtn').addEventListener('click', openSheet);
  $('closeSheet').addEventListener('click', closeSheet);
  backdrop.addEventListener('click', closeSheet);

  /* ---------- Controls ---------- */

  $('startBtn').addEventListener('click', startSession);
  $('doneBtn').addEventListener('click', goHome);
  $('stopBtn').addEventListener('click', goHome);

  app.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (state === 'running') pause();
    else if (state === 'paused') resume();
  });

  document.addEventListener('keydown', (e) => {
    if (sheet.classList.contains('open')) {
      if (e.key === 'Escape') closeSheet();
      return;
    }
    if (e.key === 'Escape' && state !== 'home') { goHome(); return; }
    if (e.code !== 'Space' && e.key !== 'Enter') return;
    if (e.target.closest && e.target.closest('button, input')) return;
    e.preventDefault();
    if (state === 'home') startSession();
    else if (state === 'running') pause();
    else if (state === 'paused') resume();
    else if (state === 'done') goHome();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (state === 'running') pause();
    else if (state === 'countdown') goHome();
  });

  /* ---------- Boot ---------- */

  renderSettings();
  subEl.textContent = homeSummary();
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})();
