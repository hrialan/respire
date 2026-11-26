// Respire — moteur de séance, réglages et interactions.
//
// États : home → countdown → running ⇄ paused → done → home.
// La respiration est calculée à partir de l'horloge (aucune dérive) et
// pilote à la fois la scène (Scene), le son (Ambience) et les vibrations.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const phaseEl = $('phase');
  const subEl = $('sub');
  const ringProgress = $('ringProgress');
  const sheet = $('sheet');
  const backdrop = $('backdrop');

  /* ================= Settings ================= */

  const SETTINGS_KEY = 'respire.settings';
  const STATS_KEY = 'respire.stats';
  const DEFAULTS = { duration: 5, rhythm: '5-5', inhale: 5, exhale: 5, vibration: true, sound: false, sky: 'auto' };

  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep in memory */ }
    },
  };

  const settings = { ...DEFAULTS, ...store.get(SETTINGS_KEY, {}) };

  function updateSettings(patch) {
    Object.assign(settings, patch);
    store.set(SETTINGS_KEY, settings);
    renderSettings();
  }

  // [inhale, exhale] in seconds
  function rhythm() {
    if (settings.rhythm === 'custom') return [settings.inhale, settings.exhale];
    return settings.rhythm.split('-').map(Number);
  }

  const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  function homeSummary() {
    const [i, x] = rhythm();
    return `${settings.duration} min · ${fmt(i)} s / ${fmt(x)} s`;
  }

  /* ================= Text ================= */

  let phaseText = phaseEl.textContent;
  let phaseTimer = 0;

  // Cross-fades the big label.
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

  /* ================= Haptics ================= */

  const canVibrate = typeof navigator.vibrate === 'function';
  const VIBRATIONS = { in: [45], out: [30, 90, 30], end: [60, 110, 60, 110, 220], tap: [12] };
  const IOS_TICKS = { in: 1, out: 2, end: 3, tap: 1 };

  // iOS Safari has no Vibration API. Since iOS 18, toggling a native
  // <input type="checkbox" switch> plays a light system haptic. Best effort:
  // recent iOS versions reportedly only allow it right after a tap, so it
  // rarely fires during a session (the settings sheet says so).
  function iosTick() {
    try {
      const label = document.createElement('label');
      const input = document.createElement('input');
      label.ariaHidden = 'true';
      label.style.display = 'none';
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      label.appendChild(input);
      document.head.appendChild(label);
      label.click();
      label.remove();
    } catch { /* unsupported */ }
  }

  function haptic(kind) {
    if (!settings.vibration) return;
    if (canVibrate) {
      try { navigator.vibrate(VIBRATIONS[kind]); } catch { /* blocked */ }
    } else {
      for (let k = 0; k < IOS_TICKS[kind]; k++) setTimeout(iosTick, k * 140);
    }
  }

  /* ================= Screen wake lock ================= */

  let wakeLock = null;

  async function keepAwake() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch { wakeLock = null; }
  }

  function allowSleep() {
    try { wakeLock?.release(); } catch { /* already released */ }
    wakeLock = null;
  }

  /* ================= Daily count ================= */

  function recordSession() {
    const d = new Date();
    const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const stats = store.get(STATS_KEY, { day: '', count: 0 });
    const count = stats.day === day ? stats.count + 1 : 1;
    store.set(STATS_KEY, { day, count });
    return count;
  }

  /* ================= Session engine ================= */

  const COUNTDOWN_MS = 3000;

  let state = 'home';
  let run = null;             // the current session's timing
  let countdownStart = 0;
  let breath = 0.4;           // 0..1, drives orb size, tide and sound
  let lastFrame = performance.now();
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
    if (settings.sound) Ambience.start();
    keepAwake();

    const [inh, exh] = rhythm();
    const cycleMs = (inh + exh) * 1000;
    const cycles = Math.max(1, Math.round((settings.duration * 60000) / cycleMs));   // whole breaths only
    run = {
      inhMs: inh * 1000,
      exhMs: exh * 1000,
      cycleMs,
      cycles,
      totalMs: cycles * cycleMs,
      start: 0,
      pausedAt: 0,
      pausedTotal: 0,
      phaseKey: -1,         // index of the current half-breath, to detect changes
      remaining: -1,
      quietCue: false,      // after a resume: restore the label without a cue
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
    Ambience.update(breath, false);
    allowSleep();
  }

  function resume() {
    if (state !== 'paused') return;
    run.pausedTotal += performance.now() - run.pausedAt;
    run.phaseKey = -1;
    run.remaining = -1;
    run.quietCue = true;
    setState('running');
    if (settings.sound) Ambience.unlock();   // iOS may have suspended audio meanwhile
    keepAwake();
  }

  function finish() {
    const count = recordSession();
    const mins = Math.max(1, Math.round(run.totalMs / 60000));
    const nth = count === 1 ? '1ʳᵉ' : `${count}ᵉ`;
    setState('done');
    setProgress(1);
    haptic('end');
    Ambience.stop(4);
    allowSleep();
    setPhase('Séance terminée');
    subEl.textContent = `${mins} min · ${run.cycles} respirations\n${nth} séance aujourd’hui`;
    run = null;
  }

  function goHome() {
    setState('home');
    run = null;
    Ambience.stop();
    allowSleep();
    setPhase('Respire');
    subEl.textContent = homeSummary();
    setTimeout(() => { if (state === 'home') setProgress(0); }, 1000);
  }

  // One running frame: where are we in the breath?
  function tickRun(now) {
    const elapsed = now - run.start - run.pausedTotal;
    if (elapsed >= run.totalMs) {
      breath = 0;
      finish();
      return;
    }
    const cycle = Math.floor(elapsed / run.cycleMs);
    const pos = elapsed - cycle * run.cycleMs;
    const inhaling = pos < run.inhMs;
    const p = inhaling ? pos / run.inhMs : (pos - run.inhMs) / run.exhMs;
    breath = inhaling ? (1 - Math.cos(Math.PI * p)) / 2 : (1 + Math.cos(Math.PI * p)) / 2;   // sine ease

    const key = cycle * 2 + (inhaling ? 0 : 1);
    if (key !== run.phaseKey) {
      run.phaseKey = key;
      if (run.quietCue) run.quietCue = false;
      else haptic(inhaling ? 'in' : 'out');
      setPhase(inhaling ? 'Inspirez' : 'Expirez');
    }

    const remaining = Math.ceil((run.totalMs - elapsed) / 1000);
    if (remaining !== run.remaining) {
      run.remaining = remaining;
      subEl.textContent = mmss(remaining);
    }
    setProgress(elapsed / run.totalMs);
    Ambience.update(breath);
  }

  function frame(now) {
    const dt = Math.max(0, Math.min(100, now - lastFrame));   // rAF timestamps can precede lastFrame
    lastFrame = now;
    let target = null;   // eased towards when not driven by a session

    if (state === 'running') {
      tickRun(now);
    } else if (state === 'countdown') {
      const e = now - countdownStart;
      if (e >= COUNTDOWN_MS) beginRun(now);
      else setPhase(String(3 - Math.floor(e / 1000)));
      target = 0;
    } else if (state === 'home' || state === 'done') {
      target = 0.42 + 0.1 * Math.sin((now / 8000) * 2 * Math.PI);   // slow idle breathing
    }

    if (target !== null) breath += (target - breath) * (1 - Math.exp(-dt / 350));
    if (state === 'countdown') Ambience.update(breath);
    Scene.draw(breath, now / 1000);
    requestAnimationFrame(frame);
  }

  /* ================= Settings sheet ================= */

  const customBox = $('custom');
  const inhaleR = $('inhaleR');
  const exhaleR = $('exhaleR');
  const vibToggle = $('vibToggle');
  const soundToggle = $('soundToggle');

  function renderSettings() {
    for (const seg of document.querySelectorAll('.seg')) {
      for (const b of seg.querySelectorAll('button')) {
        const active = String(settings[seg.dataset.key]) === b.dataset.v;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      }
    }
    const [i, x] = rhythm();
    customBox.hidden = settings.rhythm !== 'custom';
    inhaleR.value = settings.inhale;
    exhaleR.value = settings.exhale;
    $('inhaleV').textContent = `${fmt(settings.inhale)} s`;
    $('exhaleV').textContent = `${fmt(settings.exhale)} s`;
    $('rhythmNote').textContent = `${fmt(60 / (i + x))} respirations par minute`;
    vibToggle.checked = settings.vibration;
    soundToggle.checked = settings.sound;
    $('vibNote').hidden = canVibrate;
    Scene.setSky(settings.sky);
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

  for (const seg of document.querySelectorAll('.seg')) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const key = seg.dataset.key;
      updateSettings({ [key]: key === 'duration' ? Number(b.dataset.v) : b.dataset.v });
      haptic('tap');
    });
  }

  inhaleR.addEventListener('input', () => updateSettings({ inhale: Number(inhaleR.value) }));
  exhaleR.addEventListener('input', () => updateSettings({ exhale: Number(exhaleR.value) }));
  vibToggle.addEventListener('change', () => {
    updateSettings({ vibration: vibToggle.checked });
    haptic('in');
  });
  soundToggle.addEventListener('change', () => {
    updateSettings({ sound: soundToggle.checked });
    if (settings.sound) Ambience.preview();
  });

  $('settingsBtn').addEventListener('click', openSheet);
  $('closeSheet').addEventListener('click', closeSheet);
  backdrop.addEventListener('click', closeSheet);

  /* ================= Controls ================= */

  $('startBtn').addEventListener('click', startSession);
  $('doneBtn').addEventListener('click', goHome);
  $('stopBtn').addEventListener('click', goHome);

  // Tap anywhere (but on a button) to pause / resume.
  app.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (state === 'running') pause();
    else if (state === 'paused') resume();
  });

  // Space / Enter: start, pause, resume, close. Escape: stop.
  document.addEventListener('keydown', (e) => {
    if (sheet.classList.contains('open')) {
      if (e.key === 'Escape') closeSheet();
      return;
    }
    if (e.key === 'Escape' && state !== 'home') { goHome(); return; }
    if (e.code !== 'Space' && e.key !== 'Enter') return;
    if (e.target.closest?.('button, input')) return;
    e.preventDefault();
    if (state === 'home') startSession();
    else if (state === 'running') pause();
    else if (state === 'paused') resume();
    else if (state === 'done') goHome();
  });

  // Leaving the app pauses the session (timers and rAF stop in the background).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (state === 'running') pause();
    else if (state === 'countdown') goHome();
  });

  /* ================= Boot ================= */

  renderSettings();
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
