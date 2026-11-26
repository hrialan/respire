(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const flower = $('flower');
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

  /* ---------- Sound ---------- */

  let actx = null;
  let master = null;

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

  // Soft bell: a few sine partials with an exponential decay.
  function bell(freq, { dur = 2.4, vol = 0.09, delay = 0 } = {}) {
    if (!actx) return;
    const t = actx.currentTime + 0.02 + delay;
    [[1, 1], [2.01, 0.22], [2.99, 0.07]].forEach(([mult, gain]) => {
      const osc = actx.createOscillator();
      const env = actx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(vol * gain, t + 0.04);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur / mult);
      osc.connect(env).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    });
  }

  function sound(kind) {
    if (!settings.sound) return;
    unlockAudio();
    if (kind === 'in') bell(523.25);
    else if (kind === 'out') bell(392);
    else if (kind === 'end') {
      bell(392, { dur: 3.2 });
      bell(493.88, { dur: 3.2, delay: 0.14 });
      bell(587.33, { dur: 3.6, delay: 0.28 });
    }
  }

  function cue(kind) {
    haptic(kind);
    sound(kind);
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
  let vis = 0.4;              // current flower expansion, 0..1
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
    if (settings.sound) unlockAudio();
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
    flower.style.setProperty('--s', vis.toFixed(4));
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
    sound('in');
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
