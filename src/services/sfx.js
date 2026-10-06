// Short sound effects made with the Web Audio API, so the game needs no
// effect files. Each effect is a few oscillator or noise notes. Playing is
// best effort: browsers without Web Audio, or before the first tap, stay
// silent and the game carries on.

let context = null;

const audio = () => {
  if (typeof window === 'undefined') return null;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  if (!context) {
    try {
      context = new Context();
    } catch {
      return null;
    }
  }
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
};

const tone = (ctx, out, { freq, start = 0, length = 0.12, type = 'sine', gain = 0.3, slide = null }) => {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const at = ctx.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, at + length);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(amp).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.02);
};

const noise = (ctx, out, { start = 0, length = 0.06, gain = 0.25, filter = 1800 }) => {
  const frames = Math.floor(ctx.sampleRate * length);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = filter;
  const amp = ctx.createGain();
  amp.gain.value = gain;
  source.connect(band).connect(amp).connect(out);
  source.start(ctx.currentTime + start);
};

// A soft note with a gentle attack and a long tail, for calm chords.
const pad = (ctx, out, { freq, start = 0, length = 1.6, gain = 0.06, type = 'sine', attack = 0.08 }) => {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const at = ctx.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(amp).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.05);
};

// A wooden knock: a short low thump with a little click on top.
const knock = (ctx, out, { start = 0, freq = 180, gain = 0.35 }) => {
  tone(ctx, out, { freq, start, length: 0.09, type: 'triangle', gain, slide: freq * 0.6 });
  noise(ctx, out, { start, length: 0.025, gain: gain * 0.5, filter: 1400 });
};

const EFFECTS = {
  // Dice clattering on the table.
  dice: (ctx, out) => {
    [0, 0.07, 0.15, 0.21, 0.3, 0.36].forEach((start, i) =>
      noise(ctx, out, { start, length: 0.05, gain: 0.35 - i * 0.03, filter: 2200 + i * 300 }),
    );
  },
  // A wooden piece set down (kept for older snapshots).
  build: (ctx, out) => {
    tone(ctx, out, { freq: 220, length: 0.12, type: 'triangle', gain: 0.4, slide: 140 });
    noise(ctx, out, { length: 0.04, gain: 0.2, filter: 900 });
    tone(ctx, out, { freq: 660, start: 0.08, length: 0.18, gain: 0.12 });
  },
  // A low, sly phrase.
  robber: (ctx, out) => {
    tone(ctx, out, { freq: 196, length: 0.22, type: 'sawtooth', gain: 0.12 });
    tone(ctx, out, { freq: 185, start: 0.2, length: 0.22, type: 'sawtooth', gain: 0.12 });
    tone(ctx, out, { freq: 147, start: 0.42, length: 0.4, type: 'sawtooth', gain: 0.12, slide: 110 });
  },
  // Two bright notes, cards changing hands.
  trade: (ctx, out) => {
    tone(ctx, out, { freq: 784, length: 0.12, gain: 0.18 });
    tone(ctx, out, { freq: 1047, start: 0.1, length: 0.16, gain: 0.16 });
  },
  // A card flipped over.
  card: (ctx, out) => {
    noise(ctx, out, { length: 0.08, gain: 0.25, filter: 4000 });
    tone(ctx, out, { freq: 880, start: 0.05, length: 0.14, gain: 0.12, slide: 1320 });
  },
  // A quiet clock tick for the last seconds of a move.
  tick: (ctx, out) => {
    tone(ctx, out, { freq: 1320, length: 0.045, gain: 0.07 });
    noise(ctx, out, { length: 0.02, gain: 0.05, filter: 5200 });
  },
  // A road laid: two quick wooden knocks.
  road: (ctx, out) => {
    knock(ctx, out, { freq: 200, gain: 0.3 });
    knock(ctx, out, { start: 0.09, freq: 240, gain: 0.22 });
  },
  // A settlement set down: a wood block, then a warm two-note answer.
  settlement: (ctx, out) => {
    knock(ctx, out, { freq: 170, gain: 0.34 });
    tone(ctx, out, { freq: 523, start: 0.08, length: 0.22, gain: 0.1 });
    tone(ctx, out, { freq: 784, start: 0.16, length: 0.3, gain: 0.08 });
  },
  // A city raised: a soft bell chord that rings out.
  city: (ctx, out) => {
    knock(ctx, out, { freq: 150, gain: 0.3 });
    [523, 659, 784, 1047].forEach((freq, i) => pad(ctx, out, { freq, start: 0.06 + i * 0.05, length: 1.2, gain: 0.05 }));
  },
  // A card slipped away: a quick airy whoosh.
  steal: (ctx, out) => {
    noise(ctx, out, { length: 0.22, gain: 0.18, filter: 2600 });
    tone(ctx, out, { freq: 660, start: 0.04, length: 0.2, gain: 0.06, slide: 330 });
  },
  // The robber's dragon: three soft wing beats.
  dragon: (ctx, out) => {
    [0, 0.16, 0.32].forEach((start, i) => noise(ctx, out, { start, length: 0.12, gain: 0.22 - i * 0.04, filter: 500 + i * 80 }));
    tone(ctx, out, { freq: 140, start: 0.42, length: 0.35, type: 'triangle', gain: 0.08, slide: 110 });
  },
  // A win: a calm major chord that blooms, with a few music box notes.
  win: (ctx, out) => {
    [262, 330, 392, 523].forEach((freq, i) => pad(ctx, out, { freq, start: i * 0.04, length: 3.6, gain: 0.045, attack: 0.5 }));
    [784, 988, 1175, 1568, 1319].forEach((freq, i) =>
      pad(ctx, out, { freq, start: 0.45 + i * 0.32, length: 1.4, gain: 0.04, type: 'triangle', attack: 0.01 }),
    );
  },
  // A soft chime when the turn passes on.
  turn: (ctx, out) => {
    tone(ctx, out, { freq: 523, length: 0.25, gain: 0.1 });
    tone(ctx, out, { freq: 659, start: 0.06, length: 0.3, gain: 0.08 });
  },
};

export const SFX_KEYS = Object.keys(EFFECTS);

export const playSfx = (key, volume = 0.8) => {
  const effect = EFFECTS[key];
  if (!effect || volume <= 0) return false;
  const ctx = audio();
  if (!ctx) return false;
  try {
    const out = ctx.createGain();
    out.gain.value = Math.min(1, Math.max(0, volume));
    out.connect(ctx.destination);
    effect(ctx, out);
    return true;
  } catch {
    return false;
  }
};
