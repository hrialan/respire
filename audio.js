// Respire — le son, généré en direct (aucun fichier audio).
//
// Trois ambiances au choix, toutes guidées par le souffle :
//   - les vagues : à l'inspiration, la vague se retire en montant (un
//     chuintement qui gonfle) ; à l'expiration, elle déferle puis s'étale
//     sur le sable, et l'écume pétille. Chaque vague est un peu différente ;
//   - le vent : il se lève à l'inspiration, siffle dans les rafales, retombe
//     à l'expiration ;
//   - les repères seuls, sans fond sonore.
// À chaque changement de phase, un bol chantant effleuré : une note claire
// qui monte pour inspirer, une note grave qui descend pour expirer. On peut
// respirer les yeux fermés.
//
// Sous les vagues et le vent, une nappe d'accords qui s'ouvre à l'inspiration
// et dont la couleur suit l'heure (lumineuse le jour, chaude au couchant,
// profonde la nuit). À la fin de la séance, une cascade de notes cristallines ;
// quand une baleine saute, son chant, lointain.
//
// Tout part du même bruit rose. Les notes passent par une réverbération
// générée elle aussi, et le tout par un limiteur qui évite la saturation.
//
// API : Ambience.unlock(), start(mode, mood), update(souffle, enCours),
// cue('in' | 'out'), celebrate(), whale(délai), stop(fondu), preview(mode, mood).
// mode : 'waves' | 'wind' | 'cues' · mood : 'day' | 'sunset' | 'night'.
(() => {
  'use strict';

  const VOLUME = 2.5;          // level of the noise beds (≈ -22 dBFS RMS at full breath)
  const CUE_LEVEL = 0.1;       // singing bowl at each change of phase
  const CHORDS = {             // the pad, by time of day
    day: [110, 164.81, 246.94, 277.18, 329.63],      // A2 E3 B3 C#4 E4: open, bright
    sunset: [73.42, 110, 185, 220, 277.18],         // D2 A2 F#3 A3 C#4: warm
    night: [110, 164.81, 246.94, 261.63, 329.63],    // A2 E3 B3 C4 E4: deep, a little minor
  };
  const SPARKLE = [880, 987.77, 1108.73, 1318.51, 1479.98, 1760, 1975.53, 2217.46];   // A major pentatonic

  let actx = null;
  let noise = null;
  let reverb = null;           // shared input of the reverb (notes only)
  let master = null;           // everything goes through it: a limiter against clipping
  let lastDrive = 0;           // when the breath last reached the audio graph (ms)
  let live = null;             // the voice that follows the breath during a session
  let busyUntil = 0;           // wall-clock time (ms) until which sound may still ring
  let preview = null;          // the settings preview playing, if any: { voice, timer }

  const between = (lo, hi) => lo + Math.random() * (hi - lo);

  // iOS mutes Web Audio when the ring/silent switch is on, unless the page
  // declares itself as media playback (Safari 16.4+). Only done while sound
  // is playing, so the app never interrupts the user's music otherwise.
  function setAudioSession(type) {
    try { if ('audioSession' in navigator) navigator.audioSession.type = type; } catch { /* unsupported */ }
  }

  // Hand the audio session back once nothing is playing any more. Wall-clock
  // time, not the audio clock: that one stops while iOS suspends the context.
  function releaseLater(sec) {
    busyUntil = Math.max(busyUntil, performance.now() + sec * 1000);
    setTimeout(() => {
      if (!live && !preview && performance.now() >= busyUntil - 50) setAudioSession('auto');
    }, sec * 1000 + 100);
  }

  // Stop the settings preview at once (another choice, or a session starting).
  function stopPreview() {
    if (!preview) return;
    clearInterval(preview.timer);
    if (preview.voice) preview.voice.stop(0.4);
    preview = null;
  }

  // Must be called from a user gesture (iOS / autoplay policies): on start,
  // and again on resume, since iOS may suspend the context in between.
  function unlock() {
    // No webkitAudioContext fallback: the Safari versions that needed it could
    // not chain connect() calls, and lack the audio session anyway.
    if (!window.AudioContext) return false;
    setAudioSession('playback');
    if (!actx) actx = new AudioContext();
    if (actx.state !== 'running') actx.resume().catch(() => {});   // suspended, or interrupted (a phone call)
    return true;
  }

  // The way out: a limiter, so the loudest moment (a wave breaking as the bowl
  // rings) never clips.
  function output() {
    if (master) return master;
    master = actx.createDynamicsCompressor();
    master.threshold.value = -6;
    master.knee.value = 3;
    master.ratio.value = 20;
    master.attack.value = 0.003;
    master.release.value = 0.25;
    master.connect(actx.destination);
    return master;
  }

  // The heavy buffers, made in the tap that starts the sound rather than in
  // the middle of an animation frame.
  function prepare() {
    output();
    pinkNoise();
    reverbIn();
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
  function panner(value = 0) {
    if (!actx.createStereoPanner) return gain(1);
    const p = actx.createStereoPanner();
    p.pan.value = value;
    return p;
  }

  // A soft hall for the notes: dry and wet, the wet from a generated impulse.
  function reverbIn() {
    if (reverb) return reverb;
    const len = Math.round(actx.sampleRate * 3.2);
    const ir = actx.createBuffer(2, len, actx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      const k = Math.exp(-6.5 / len);                       // about -56 dB at the end
      let env = 1;
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * env;
        env *= k;
      }
    }
    const conv = actx.createConvolver();
    conv.buffer = ir;
    reverb = gain(1);
    reverb.connect(output());                                  // dry
    reverb.connect(conv).connect(gain(0.55)).connect(output());   // wet
    return reverb;
  }

  /* ================= Beds: what follows the breath ================= */

  // Slow, irregular gusts: 0..1, never quite repeating.
  function gustAt(t) {
    const g = 0.5 * Math.sin(t * 0.13) + 0.3 * Math.sin(t * 0.31 + 1.3) + 0.2 * Math.sin(t * 0.71 + 4.1);
    return 0.5 + 0.5 * g;
  }

  // The wind: a low body, a wide breath that rises with the in-breath, and a
  // narrow resonant whistle, mostly in the gusts.
  function wind(src, out) {
    const bodyLp = filter('lowpass', 220, 0.5);
    const body = gain(0);
    src.connect(bodyLp).connect(body).connect(out);

    const breathBp = filter('bandpass', 500, 0.8);
    const breathG = gain(0);
    const breathPan = panner();
    src.connect(breathBp).connect(breathG).connect(breathPan).connect(out);

    const whistleBp = filter('bandpass', 800, 14);
    const whistleG = gain(0);
    const whistlePan = panner();
    src.connect(whistleBp).connect(whistleG).connect(whistlePan).connect(out);

    return {
      phase() {},
      drive(s, playing) {
        const t = actx.currentTime;
        const tc = playing ? 0.12 : 0.6;
        const gust = gustAt(t);
        const e = s * (0.75 + 0.5 * gust);   // energy: the breath, pushed by the gusts
        const pitch = e * (1 - 0.35 * e);      // pitch rises less near the top: no shrill peak
        const on = playing ? 1 : 0;
        const set = (param, value, k = tc) => param.setTargetAtTime(value, t, k);

        set(bodyLp.frequency, 160 + 220 * pitch, 0.3);
        set(body.gain, on * (0.1 + 0.12 * e));
        set(breathBp.frequency, 380 + 900 * pitch + 120 * gust, 0.3);
        set(breathG.gain, on * (0.04 + 0.2 * e));
        set(whistleBp.frequency, 480 + 600 * pitch + 180 * gust, 0.4);
        set(whistleG.gain, on * 0.07 * Math.pow(e, 1.8));
        if (breathPan.pan) {
          set(breathPan.pan, 0.35 * Math.sin(t * 0.07), 0.5);
          set(whistlePan.pan, 0.6 * Math.sin(t * 0.11 + 2), 0.5);
        }
      },
    };
  }

  // The sea. On the in-breath the wave draws back: a low swell and a hiss
  // that rises and brightens. On the out-breath it breaks (a burst, from a
  // slightly different place each time), then spreads over the sand, softer
  // and duller as it ebbs, with the foam fizzing.
  function waves(src, out) {
    const bodyLp = filter('lowpass', 400, 0.6);               // the water's weight
    const body = gain(0);
    src.connect(bodyLp).connect(body).connect(out);

    const hissBp = filter('bandpass', 1500, 0.7);             // backwash, then the wash
    const hiss = gain(0);
    const hissPan = panner();
    src.connect(hissBp).connect(hiss).connect(hissPan).connect(out);

    const foamHp = filter('highpass', 3500);                  // fizzing foam
    const foam = gain(0);
    src.connect(foamHp).connect(foam).connect(out);

    const crashLp = filter('lowpass', 900, 0.4);              // the break itself
    const crash = gain(0);
    const crashPan = panner();
    src.connect(crashLp).connect(crash).connect(crashPan).connect(out);

    let phase = 'out';
    let size = 1;                                              // each wave a little different

    return {
      phase(kind) {
        phase = kind;
        const t = actx.currentTime;
        if (kind === 'out') {
          size = between(0.75, 1.1);
          crash.gain.cancelScheduledValues(t);
          crash.gain.setTargetAtTime(0.38 * size, t, 0.12);
          crash.gain.setTargetAtTime(0, t + 0.5, 0.9);
          crashLp.frequency.cancelScheduledValues(t);
          crashLp.frequency.setTargetAtTime(1500, t, 0.1);
          crashLp.frequency.setTargetAtTime(380, t + 0.4, 1.2);
          if (crashPan.pan) crashPan.pan.setTargetAtTime(between(-0.4, 0.4), t, 0.05);
        } else if (hissPan.pan) {
          hissPan.pan.setTargetAtTime(between(-0.3, 0.3), t, 1);
        }
      },
      drive(s, playing) {
        const t = actx.currentTime;
        const on = playing ? 1 : 0;
        const set = (param, value, k) => param.setTargetAtTime(value, t, playing ? k : 0.6);
        if (phase === 'in') {
          set(bodyLp.frequency, 250 + 500 * s, 0.3);
          set(body.gain, on * (0.12 + 0.18 * s), 0.15);
          set(hissBp.frequency, 900 + 1600 * s, 0.3);
          set(hiss.gain, on * (0.03 + 0.16 * s * s), 0.15);
          set(foam.gain, on * 0.01, 0.6);
        } else {
          const w = Math.pow(s, 0.7);
          set(bodyLp.frequency, 220 + 900 * w, 0.4);
          set(body.gain, on * (0.08 + 0.3 * w * size), 0.2);
          set(hissBp.frequency, 700 + 1300 * w, 0.5);
          set(hiss.gain, on * (0.02 + 0.14 * w * size), 0.2);
          set(foam.gain, on * (0.005 + 0.05 * w * size), 0.8);
        }
        if (!playing) set(crash.gain, 0, 0.3);
      },
    };
  }

  // The pad: a soft chord whose upper notes open on the in-breath.
  function pad(out, mood) {
    const notes = CHORDS[mood] || CHORDS.day;
    const lp = filter('lowpass', 600);
    const level = gain(0);
    lp.connect(level).connect(out);
    const upper = gain(0.4);
    upper.connect(lp);
    const oscs = [];
    notes.forEach((f, i) => {
      for (const detune of [-0.35, 0.35]) {
        const o = actx.createOscillator();
        o.frequency.value = f + detune;
        o.connect(gain(0.5 / (i + 1.5))).connect(i >= 3 ? upper : lp);
        o.start();
        oscs.push(o);
      }
    });
    return {
      drive(s, playing) {
        const t = actx.currentTime;
        const on = playing ? 1 : 0;
        lp.frequency.setTargetAtTime(500 + 900 * s, t, 0.4);
        level.gain.setTargetAtTime(on * (0.018 + 0.012 * s), t, 0.4);
        upper.gain.setTargetAtTime(0.4 + 0.6 * s, t, 0.4);
      },
      stop(end) {
        oscs.forEach((o) => o.stop(end));
      },
    };
  }

  // One voice: a bed (waves or wind) and the pad, silent until driven.
  function createVoice(mode, mood) {
    const t = actx.currentTime;
    const out = gain(0);
    out.gain.setTargetAtTime(VOLUME, t, 0.8);
    out.connect(output());

    const src = actx.createBufferSource();
    src.buffer = pinkNoise();
    src.loop = true;
    src.loopEnd = noise.duration - 0.5;
    const clean = filter('highpass', 30);
    src.connect(clean);
    src.start();

    const bed = mode === 'wind' ? wind(clean, out) : waves(clean, out);
    const chord = pad(out, mood);

    return {
      phase: (kind) => bed.phase(kind),
      drive(s, playing) {
        bed.drive(s, playing);
        chord.drive(s, playing);
      },
      stop(fadeSec) {
        const now = actx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0, now, fadeSec / 4);
        const end = now + fadeSec + 0.3;
        src.stop(end);
        chord.stop(end);
        setTimeout(() => out.disconnect(), (fadeSec + 0.6) * 1000);
      },
    };
  }

  // Cues only: nothing follows the breath, the bowls do the guiding.
  const quietVoice = { phase() {}, drive() {}, stop() {} };

  /* ================= Notes ================= */

  // A singing bowl, lightly struck: inharmonic partials, the lowest beating
  // slowly. glide: a slight rise or fall of pitch at the start.
  function bowl(freq, level, when, glide = 1, pan = 0) {
    const out = panner(pan);
    out.connect(reverbIn());
    const partials = [[1, 1, 4.5], [2.76, 0.45, 2.6], [5.4, 0.22, 1.6], [8.93, 0.1, 1]];   // ratio, level, decay (s)
    for (const [ratio, amp, decay] of partials) {
      for (const beat of ratio === 1 ? [0, 1.3] : [0]) {
        const o = actx.createOscillator();
        const f = freq * ratio + beat;
        o.frequency.setValueAtTime(f * glide, when);
        o.frequency.exponentialRampToValueAtTime(f, when + 0.35);
        const g = gain(0);
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(amp * level * (beat ? 0.5 : 1), when + 0.02);
        g.gain.setTargetAtTime(0, when + 0.02, decay / 3);
        o.connect(g).connect(out);
        o.onended = () => g.disconnect();
        o.start(when);
        o.stop(when + decay * 1.6);   // by then it has faded below hearing
      }
    }
  }

  // A small bell, brighter and shorter than the bowl.
  function bell(freq, level, when, pan) {
    const out = panner(pan);
    out.connect(reverbIn());
    for (const [ratio, amp, decay] of [[1, 1, 2.2], [2, 0.4, 1.5], [3, 0.2, 1], [4.2, 0.12, 0.6]]) {
      const o = actx.createOscillator();
      o.frequency.value = freq * ratio;
      const g = gain(0);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(amp * level, when + 0.005);
      g.gain.setTargetAtTime(0, when + 0.005, decay / 3);
      o.connect(g).connect(out);
      o.onended = () => g.disconnect();
      o.start(when);
      o.stop(when + decay * 1.6);
    }
  }

  // One call of a whale, far away: a slow gliding moan with a little vibrato.
  function whaleCall(when, freqs, dur, level) {
    const out = filter('lowpass', 900);
    out.connect(reverbIn());
    const env = gain(0);
    env.connect(out);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(level, when + dur * 0.25);
    env.gain.setTargetAtTime(0, when + dur * 0.6, dur * 0.15);

    const vib = actx.createOscillator();
    vib.frequency.value = 4.5;
    const vibDepth = gain(3);
    vib.connect(vibDepth);

    const formant = filter('bandpass', 520, 3);
    formant.connect(env);
    for (const [type, mult, amp] of [['sine', 1, 1], ['triangle', 2, 0.5]]) {
      const o = actx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freqs[0] * mult, when);
      freqs.forEach((f, i) => {
        if (i) o.frequency.exponentialRampToValueAtTime(f * mult, when + (dur * i) / (freqs.length - 1));
      });
      vibDepth.connect(o.frequency);
      const g = gain(amp);
      o.connect(g).connect(type === 'sine' ? env : formant);
      o.start(when);
      o.stop(when + dur + 1);
    }
    vib.start(when);
    vib.stop(when + dur + 1);
  }

  /* ================= API ================= */

  window.Ambience = {
    unlock,

    start(mode = 'waves', mood = 'day') {
      if (live || !unlock()) return;
      stopPreview();
      prepare();
      live = mode === 'cues' ? quietVoice : createVoice(mode, mood);
    },

    // Called every animation frame; the audio graph only needs about 30 updates
    // a second (its time constants are 0.12 s or more), so the rest are skipped.
    update(s, playing = true) {
      if (!live) return;
      const now = performance.now();
      if (playing && now - lastDrive < 33) return;
      lastDrive = now;
      live.drive(s, playing);
    },

    // A change of phase: the bowl, and the wave turns.
    cue(kind) {
      if (!live) return;
      live.phase(kind);
      const t = actx.currentTime + 0.01;
      if (kind === 'in') bowl(493.88, CUE_LEVEL, t, 0.97);    // B4, rising
      else bowl(329.63, CUE_LEVEL, t, 1.03);                   // E4, settling
    },

    // End of a session: a cascade of crystal notes rising, then a low bowl.
    celebrate() {
      if (!live) return;
      const t = actx.currentTime + 0.3;
      SPARKLE.forEach((f, i) => bell(f, 0.035, t + i * 0.16 + between(0, 0.05), between(-0.6, 0.6)));
      bowl(220, CUE_LEVEL * 1.4, t + SPARKLE.length * 0.16 + 0.2);
      releaseLater(9);
    },

    // A whale breaching (a rare moment): its song, from far away. Only while
    // a session is playing, or its last notes still ring.
    whale(delay = 0) {
      if (!actx || (!live && performance.now() > busyUntil)) return;
      const t = actx.currentTime + delay + 0.6;
      whaleCall(t, [170, 290, 230], 2.6, 0.05);
      whaleCall(t + 3.2, [260, 150], 2.4, 0.04);
      releaseLater(delay + 9);
    },

    stop(fadeSec = 1.2) {
      if (!live) return;
      live.stop(fadeSec);
      live = null;
      releaseLater(fadeSec + 0.5);
    },

    // One slow breath in and out, to hear a choice from the settings.
    preview(mode = 'waves', mood = 'day') {
      if (live || !unlock()) return;
      stopPreview();
      prepare();
      const t = actx.currentTime + 0.05;
      if (mode === 'cues') {
        bowl(493.88, CUE_LEVEL, t, 0.97);
        bowl(329.63, CUE_LEVEL, t + 2.5, 1.03);
        releaseLater(7);
        return;
      }
      const v = createVoice(mode, mood);
      const DURATION = 6000;
      const t0 = performance.now();
      let half = false;
      v.phase('in');
      bowl(493.88, CUE_LEVEL, t, 0.97);
      releaseLater(DURATION / 1000 + 5);   // keep the session playing until it has faded
      const p = { voice: v, timer: 0 };
      preview = p;
      p.timer = setInterval(() => {
        if (preview !== p) return;
        const k = (performance.now() - t0) / DURATION;
        if (k >= 1) {
          clearInterval(p.timer);
          v.stop(1.5);
          preview = null;
          releaseLater(5);
          return;
        }
        if (k >= 0.5 && !half) {
          half = true;
          v.phase('out');
          bowl(329.63, CUE_LEVEL, actx.currentTime + 0.01, 1.03);
        }
        v.drive(Math.sin(k * Math.PI), true);
      }, 50);
    },
  };
})();
