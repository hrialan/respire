// Respire — le souffle du vent, généré en direct (aucun fichier audio).
//
// Le souffle pilote le vent : à l'inspiration il se lève, s'éclaircit et se
// met à siffler ; à l'expiration il retombe. Par-dessus, des rafales lentes et
// irrégulières le rendent vivant, et il se déplace doucement dans l'espace.
//
// Couches (toutes à partir du même bruit rose) :
//   - le corps : un grondement grave, filtré passe-bas ;
//   - le souffle : une bande large qui monte avec l'inspiration ;
//   - le sifflement : une bande étroite et résonante, surtout dans les rafales ;
//   - la nappe : un accord chaud et ouvert (La2 Mi3 Si3 Do#4 Mi4), en fond.
(() => {
  'use strict';

  const PAD_NOTES = [110, 164.81, 246.94, 277.18, 329.63];
  const VOLUME = 2.5;   // overall level (≈ -22 dBFS RMS at full breath)

  let actx = null;
  let noise = null;
  let live = null;   // the voice that follows the breath during a session

  // iOS mutes Web Audio when the ring/silent switch is on, unless the page
  // declares itself as media playback (Safari 16.4+). Only done while the wind
  // is playing, so the app never interrupts the user's music otherwise.
  function setAudioSession(type) {
    try { if ('audioSession' in navigator) navigator.audioSession.type = type; } catch { /* unsupported */ }
  }

  // Must be called from a user gesture (iOS / autoplay policies): on start,
  // and again on resume, since iOS may suspend the context in between.
  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    setAudioSession('playback');
    if (!actx) actx = new AC();
    if (actx.state === 'suspended') actx.resume();
    return true;
  }

  // 8 s of stereo pink noise (Paul Kellet's filter), with a crossfaded loop seam.
  function pinkNoise() {
    if (noise) return noise;
    const len = actx.sampleRate * 8;
    const fade = actx.sampleRate * 0.5;
    noise = actx.createBuffer(2, len, actx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = noise.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[i] = d[i] * k + d[len - fade + i] * (1 - k);
      }
    }
    return noise;
  }

  function filter(type, freq, q) {
    const f = actx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  }

  function gain(value) {
    const g = actx.createGain();
    g.gain.value = value;
    return g;
  }

  // Stereo movement where supported (falls back to a plain gain).
  function panner() {
    return actx.createStereoPanner ? actx.createStereoPanner() : gain(1);
  }

  // Slow, irregular gusts: 0..1, never quite repeating.
  function gustAt(t) {
    const g = 0.5 * Math.sin(t * 0.13) + 0.3 * Math.sin(t * 0.31 + 1.3) + 0.2 * Math.sin(t * 0.71 + 4.1);
    return 0.5 + 0.5 * g;
  }

  // Builds one voice, silent until driven by drive().
  function createVoice() {
    const t = actx.currentTime;
    const out = gain(0);
    out.gain.setTargetAtTime(VOLUME, t, 0.8);
    out.connect(actx.destination);

    const src = actx.createBufferSource();
    src.buffer = pinkNoise();
    src.loop = true;
    src.loopEnd = noise.duration - 0.5;
    const clean = filter('highpass', 40);
    src.connect(clean);

    const bodyLp = filter('lowpass', 220, 0.5);
    const body = gain(0);
    clean.connect(bodyLp).connect(body).connect(out);

    const breathBp = filter('bandpass', 500, 0.8);
    const breathG = gain(0);
    const breathPan = panner();
    clean.connect(breathBp).connect(breathG).connect(breathPan).connect(out);

    const whistleBp = filter('bandpass', 800, 14);
    const whistleG = gain(0);
    const whistlePan = panner();
    clean.connect(whistleBp).connect(whistleG).connect(whistlePan).connect(out);
    src.start();

    const pad = gain(0);
    const padLp = filter('lowpass', 700);
    padLp.connect(pad).connect(out);
    const oscs = [];
    PAD_NOTES.forEach((f, i) => {
      for (const detune of [-0.35, 0.35]) {
        const o = actx.createOscillator();
        o.frequency.value = f + detune;
        o.connect(gain(0.5 / (i + 1.5))).connect(padLp);
        o.start();
        oscs.push(o);
      }
    });

    return {
      bodyLp, body, breathBp, breathG, breathPan, whistleBp, whistleG, whistlePan, pad,
      stop(fadeSec) {
        const now = actx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0, now, fadeSec / 4);
        const end = now + fadeSec + 0.3;
        src.stop(end);
        oscs.forEach((o) => o.stop(end));
      },
    };
  }

  // s: breath level 0..1. playing=false lets the wind die down (pause).
  function drive(v, s, playing) {
    const t = actx.currentTime;
    const tc = playing ? 0.12 : 0.6;
    const gust = gustAt(t);
    const e = s * (0.75 + 0.5 * gust);   // energy: the breath, pushed by the gusts
    const pitch = e * (1 - 0.35 * e);      // pitch rises less near the top: no shrill peak
    const on = playing ? 1 : 0;
    const set = (param, value, k = tc) => param.setTargetAtTime(value, t, k);

    set(v.bodyLp.frequency, 160 + 220 * pitch, 0.3);
    set(v.body.gain, on * (0.1 + 0.12 * e));

    set(v.breathBp.frequency, 380 + 900 * pitch + 120 * gust, 0.3);
    set(v.breathG.gain, on * (0.04 + 0.2 * e));

    set(v.whistleBp.frequency, 480 + 600 * pitch + 180 * gust, 0.4);
    set(v.whistleG.gain, on * 0.07 * Math.pow(e, 1.8));

    if (v.breathPan.pan) {
      set(v.breathPan.pan, 0.35 * Math.sin(t * 0.07), 0.5);
      set(v.whistlePan.pan, 0.6 * Math.sin(t * 0.11 + 2), 0.5);
    }
    set(v.pad.gain, on * (0.018 + 0.01 * s), 0.4);
  }

  window.Ambience = {
    unlock,

    start() {
      if (!live && unlock()) live = createVoice();
    },

    update(s, playing = true) {
      if (live) drive(live, s, playing);
    },

    stop(fadeSec = 1.2) {
      if (!live) return;
      live.stop(fadeSec);
      live = null;
      setTimeout(() => { if (!live) setAudioSession('auto'); }, (fadeSec + 0.5) * 1000);
    },

    // One slow breath in and out, to preview the sound from the settings.
    preview() {
      if (!unlock()) return;
      const v = createVoice();
      const t0 = performance.now();
      const DURATION = 5000;
      const timer = setInterval(() => {
        const k = (performance.now() - t0) / DURATION;
        if (k >= 1) {
          clearInterval(timer);
          v.stop(1.5);
          setTimeout(() => { if (!live) setAudioSession('auto'); }, 2000);
          return;
        }
        drive(v, Math.sin(k * Math.PI), true);
      }, 50);
    },
  };
})();
