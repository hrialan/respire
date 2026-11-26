(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const ringProgress = $('ringProgress');
  const phaseEl = $('phase');
  const subEl = $('sub');
  const sheet = $('sheet');
  const backdrop = $('backdrop');

  /* ---------- Settings ---------- */

  const SETTINGS_KEY = 'respire.settings';
  const STATS_KEY = 'respire.stats';
  const DEFAULTS = { duration: 5, rhythm: '5-5', inhale: 5, exhale: 5, vibration: true, sound: false, sky: 'auto' };

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

  // Warm, open pad under the surf (A2 E3 B3 C#4 E4), each note doubled and
  // slightly detuned for a slow, soft shimmer.
  const PAD_NOTES = [110, 164.81, 246.94, 277.18, 329.63];

  function createSurf() {
    const t = actx.currentTime;
    const out = actx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.setTargetAtTime(1, t, 0.8);
    out.connect(master);

    const src = actx.createBufferSource();
    src.buffer = pinkNoise();
    src.loop = true;
    src.loopEnd = noiseBuf.duration - 0.5;
    const hp = actx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 70;
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.3;
    lp.frequency.value = surfFreq(0);
    const sg = actx.createGain();
    sg.gain.value = 0;
    src.connect(hp).connect(lp).connect(sg).connect(out);
    src.start();

    const padLp = actx.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 700;
    const pg = actx.createGain();
    pg.gain.value = 0;
    padLp.connect(pg).connect(out);
    const oscs = [];
    PAD_NOTES.forEach((f, i) => {
      [-0.35, 0.35].forEach((dt) => {
        const o = actx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f + dt;
        const g = actx.createGain();
        g.gain.value = 0.5 / (i + 1.5);
        o.connect(g).connect(padLp);
        o.start();
        oscs.push(o);
      });
    });
    return { src, lp, sg, pg, out, oscs };
  }

  // Deliberately narrow ranges: the surf breathes, it never crashes.
  function surfFreq(s) { return 220 + 650 * s; }
  function surfGain(s) { return 0.06 + 0.13 * s; }
  function padGain(s) { return 0.022 + 0.012 * s; }

  function startSurf() {
    if (!settings.sound) return;
    unlockAudio();
    if (actx && !surf) surf = createSurf();
  }

  function updateSurf(s, on = true) {
    if (!surf) return;
    const t = actx.currentTime;
    const tc = on ? 0.25 : 0.5;
    surf.lp.frequency.setTargetAtTime(surfFreq(s), t, 0.25);
    surf.sg.gain.setTargetAtTime(on ? surfGain(s) : 0, t, tc);
    surf.pg.gain.setTargetAtTime(on ? padGain(s) : 0, t, tc);
  }

  function stopNodes(n, fade) {
    const t = actx.currentTime;
    n.out.gain.cancelScheduledValues(t);
    n.out.gain.setTargetAtTime(0, t, fade / 4);
    n.src.stop(t + fade + 0.3);
    n.oscs.forEach((o) => o.stop(t + fade + 0.3));
  }

  function stopSurf(fade = 1.2) {
    if (!surf) return;
    stopNodes(surf, fade);
    surf = null;
  }

  // One slow wave in and out, to preview the sound in settings.
  function previewSurf() {
    unlockAudio();
    if (!actx) return;
    const n = createSurf();
    const t = actx.currentTime;
    n.pg.gain.setTargetAtTime(padGain(0.5), t, 0.5);
    n.sg.gain.setValueAtTime(surfGain(0), t);
    n.sg.gain.linearRampToValueAtTime(surfGain(1), t + 2.2);
    n.sg.gain.linearRampToValueAtTime(surfGain(0), t + 4.5);
    n.lp.frequency.setValueAtTime(surfFreq(0), t);
    n.lp.frequency.linearRampToValueAtTime(surfFreq(1), t + 2.2);
    n.lp.frequency.linearRampToValueAtTime(surfFreq(0), t + 4.5);
    setTimeout(() => stopNodes(n, 1.5), 4500);
  }

  const cue = haptic;

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
    Scene.draw(vis, now / 1000);
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
      if (key === 'sky') Scene.setSky(settings.sky);
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

  Scene.setSky(settings.sky);
  renderSettings();
  subEl.textContent = homeSummary();
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})();
