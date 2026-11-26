// Respire — ambiance sonore générée en direct (aucun fichier audio).
//
// Deux couches :
//   - le ressac : un bruit rose filtré. Quand le souffle monte, le filtre
//     s'ouvre et le volume augmente, comme une vague qui arrive puis se retire ;
//   - une nappe : un accord ouvert et chaud (La2 Mi3 Si3 Do#4 Mi4), chaque note
//     doublée et très légèrement désaccordée pour un miroitement lent.
// Les plages de variation sont volontairement étroites : la mer respire,
// elle ne se déchaîne jamais.
(() => {
  'use strict';

  const PAD_NOTES = [110, 164.81, 246.94, 277.18, 329.63];
  const surfFreq = (s) => 220 + 650 * s;
  const surfGain = (s) => 0.06 + 0.13 * s;
  const padGain = (s) => 0.022 + 0.012 * s;

  let actx = null;
  let noise = null;
  let live = null;   // the voice that follows the breath during a session

  // Must be called from a user gesture at least once (iOS / autoplay policies).
  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
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

  // Builds one voice (surf + pad) that fades in, silent until driven.
  function createVoice() {
    const t = actx.currentTime;
    const out = gain(0);
    out.gain.setTargetAtTime(1, t, 0.8);
    out.connect(actx.destination);

    const src = actx.createBufferSource();
    src.buffer = pinkNoise();
    src.loop = true;
    src.loopEnd = noise.duration - 0.5;
    const lp = filter('lowpass', surfFreq(0), 0.3);
    const surf = gain(0);
    src.connect(filter('highpass', 70)).connect(lp).connect(surf).connect(out);
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
      lp, surf, pad,
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

  window.Ambience = {
    unlock,

    start() {
      if (!live && unlock()) live = createVoice();
    },

    // s: breath level 0..1. playing=false fades to silence (pause).
    update(s, playing = true) {
      if (!live) return;
      const t = actx.currentTime;
      const tc = playing ? 0.25 : 0.5;
      live.lp.frequency.setTargetAtTime(surfFreq(s), t, 0.25);
      live.surf.gain.setTargetAtTime(playing ? surfGain(s) : 0, t, tc);
      live.pad.gain.setTargetAtTime(playing ? padGain(s) : 0, t, tc);
    },

    stop(fadeSec = 1.2) {
      if (!live) return;
      live.stop(fadeSec);
      live = null;
    },

    // A single slow wave in and out, to preview the sound from the settings.
    preview() {
      if (!unlock()) return;
      const v = createVoice();
      const t = actx.currentTime;
      v.pad.gain.setTargetAtTime(padGain(0.5), t, 0.5);
      for (const [param, fn] of [[v.surf.gain, surfGain], [v.lp.frequency, surfFreq]]) {
        param.setValueAtTime(fn(0), t);
        param.linearRampToValueAtTime(fn(1), t + 2.2);
        param.linearRampToValueAtTime(fn(0), t + 4.5);
      }
      setTimeout(() => v.stop(1.5), 4500);
    },
  };
})();
