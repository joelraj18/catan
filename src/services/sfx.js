// The game's sounds, made on the spot with the Web Audio API, so the game
// needs no sound files. Every effect is a few notes or bursts of filtered
// noise played through one shared bus: a soft compressor that keeps the
// level even, and a small room reverb that gives every sound the same warm
// space, so the effects belong together like one score. Notes come from one
// pentatonic scale, so sounds that overlap never clash. Playing is best
// effort: browsers without Web Audio, or before the first tap, stay silent
// and the game carries on.

let context = null;
let bus = null;

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

// A short decaying burst of noise as the impulse of a small, warm room.
const roomImpulse = (ctx, seconds = 1.6) => {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return impulse;
};

// Dry sound and a little reverb, both through a gentle compressor.
const busFor = (ctx) => {
  if (bus?.ctx === ctx) return bus;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.2;
  compressor.connect(ctx.destination);
  const reverb = ctx.createConvolver();
  reverb.buffer = roomImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  reverb.connect(wet).connect(compressor);
  bus = { ctx, dry: compressor, wet: reverb };
  return bus;
};

const tone = (ctx, out, { freq, start = 0, length = 0.12, type = 'sine', gain = 0.3, slide = null, attack = 0.01, filter = null }) => {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const at = ctx.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, at + length);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
  let source = osc;
  if (filter) {
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = filter;
    osc.connect(lowpass);
    source = lowpass;
  }
  source.connect(amp).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.05);
};

const noise = (ctx, out, { start = 0, length = 0.06, gain = 0.25, filter = 1800, q = 1, sweep = null }) => {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * length));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = q;
  const at = ctx.currentTime + start;
  band.frequency.setValueAtTime(filter, at);
  if (sweep) band.frequency.exponentialRampToValueAtTime(sweep, at + length);
  const amp = ctx.createGain();
  amp.gain.value = gain;
  source.connect(band).connect(amp).connect(out);
  source.start(at);
};

// A soft note with a gentle attack and a long tail, for calm chords.
const pad = (ctx, out, { freq, start = 0, length = 1.6, gain = 0.06, type = 'sine', attack = 0.08 }) =>
  tone(ctx, out, { freq, start, length, gain, type, attack });

// A plucked string: a bright attack that fades quickly, with an octave shimmer.
const pluck = (ctx, out, { freq, start = 0, gain = 0.16 }) => {
  tone(ctx, out, { freq, start, length: 0.55, type: 'triangle', gain });
  tone(ctx, out, { freq: freq * 2, start, length: 0.25, gain: gain * 0.35 });
};

// A wooden knock: a short low thump with a little click on top.
const knock = (ctx, out, { start = 0, freq = 180, gain = 0.35 }) => {
  tone(ctx, out, { freq, start, length: 0.09, type: 'triangle', gain, slide: freq * 0.6 });
  noise(ctx, out, { start, length: 0.025, gain: gain * 0.5, filter: 1400 });
};

// A small bell: a sine with a slightly sharp partial that rings on.
const bell = (ctx, out, { freq, start = 0, gain = 0.08, length = 1.2 }) => {
  tone(ctx, out, { freq, start, length, gain });
  tone(ctx, out, { freq: freq * 2.76, start, length: length * 0.4, gain: gain * 0.3 });
};

// A soft horn: a filtered sawtooth that swells in, for the dragon.
const horn = (ctx, out, { freq, start = 0, length = 0.6, gain = 0.09 }) =>
  tone(ctx, out, { freq, start, length, type: 'sawtooth', gain, attack: 0.12, filter: 900 });

// A wing beat: a soft swoop of low noise.
const wing = (ctx, out, { start = 0, gain = 0.2 }) => noise(ctx, out, { start, length: 0.2, gain, filter: 300, sweep: 900, q: 0.7 });

// The scale everything is tuned to: C major pentatonic.
const NOTE = { C4: 262, D4: 294, E4: 330, G4: 392, A4: 440, C5: 523, D5: 587, E5: 659, G5: 784, A5: 880, C6: 1047 };
const A3 = 220;
const E3 = 165;
const C3 = 131;

// Each resource has its own note, so a harvest plays as a little tune.
const RESOURCE_NOTE = { brick: NOTE.C5, lumber: NOTE.D5, ore: NOTE.E5, grain: NOTE.G5, wool: NOTE.A5 };

// Emote voices: a short motif per character.
const EMOTE_SOUNDS = {
  sheep: (ctx, out) => {
    // A bleat: a wobbling nasal note.
    [0, 0.07, 0.14, 0.21].forEach((start, i) => tone(ctx, out, { freq: 520 - i * 18, start, length: 0.1, type: 'square', gain: 0.05, filter: 1600 }));
  },
  dragon: (ctx, out) => {
    horn(ctx, out, { freq: A3, length: 0.5 });
    horn(ctx, out, { freq: 196, start: 0.22, length: 0.7 });
    noise(ctx, out, { start: 0.1, length: 0.5, gain: 0.08, filter: 220, sweep: 120 });
  },
  merchant: (ctx, out) => {
    bell(ctx, out, { freq: NOTE.E5, gain: 0.06, length: 0.5 });
    bell(ctx, out, { freq: NOTE.A5, start: 0.08, gain: 0.06, length: 0.6 });
  },
  knight: (ctx, out) => {
    [NOTE.C5, NOTE.E5, NOTE.G5].forEach((freq, i) => tone(ctx, out, { freq, start: i * 0.09, length: 0.3, type: 'sawtooth', gain: 0.05, filter: 2200 }));
    tone(ctx, out, { freq: NOTE.C6, start: 0.27, length: 0.5, type: 'sawtooth', gain: 0.06, filter: 2400 });
  },
  farmer: (ctx, out) => [NOTE.G4, NOTE.A4, NOTE.C5, NOTE.D5].forEach((freq, i) => pluck(ctx, out, { freq, start: i * 0.08, gain: 0.1 })),
  miner: (ctx, out) => {
    [0, 0.14].forEach((start) => {
      tone(ctx, out, { freq: 1800, start, length: 0.12, type: 'square', gain: 0.03, filter: 3000 });
      noise(ctx, out, { start, length: 0.04, gain: 0.15, filter: 3200 });
    });
  },
  lumberjack: (ctx, out) => {
    knock(ctx, out, { freq: 160, gain: 0.3 });
    noise(ctx, out, { start: 0.1, length: 0.45, gain: 0.14, filter: 400, sweep: 120 });
    knock(ctx, out, { start: 0.5, freq: 90, gain: 0.32 });
  },
  builder: (ctx, out) => {
    knock(ctx, out, { freq: 220, gain: 0.26 });
    knock(ctx, out, { start: 0.14, freq: 260, gain: 0.24 });
    bell(ctx, out, { freq: NOTE.G5, start: 0.26, gain: 0.05, length: 0.7 });
  },
};

const EFFECTS = {
  // Dice tumbling across the table, then landing with a wooden clack.
  dice: (ctx, out) => {
    [0, 0.07, 0.15, 0.21, 0.3, 0.36, 0.48].forEach((start, i) =>
      noise(ctx, out, { start, length: 0.05, gain: 0.3 - i * 0.03, filter: 2200 + i * 300 }),
    );
    knock(ctx, out, { start: 0.86, freq: 300, gain: 0.22 });
    knock(ctx, out, { start: 0.95, freq: 340, gain: 0.16 });
  },
  // A wooden piece set down (kept for older snapshots).
  build: (ctx, out) => {
    knock(ctx, out, { freq: 200, gain: 0.32 });
    tone(ctx, out, { freq: NOTE.E5, start: 0.08, length: 0.18, gain: 0.1 });
  },
  // A road laid: two quick knocks and a small rising glide.
  road: (ctx, out) => {
    knock(ctx, out, { freq: 200, gain: 0.3 });
    knock(ctx, out, { start: 0.09, freq: 240, gain: 0.22 });
    tone(ctx, out, { freq: NOTE.G4, start: 0.12, length: 0.22, gain: 0.06, slide: NOTE.C5 });
  },
  // A settlement set down: a wood block, then a two-note bell.
  settlement: (ctx, out) => {
    knock(ctx, out, { freq: 170, gain: 0.34 });
    bell(ctx, out, { freq: NOTE.C5, start: 0.08, gain: 0.07, length: 0.6 });
    bell(ctx, out, { freq: NOTE.G5, start: 0.18, gain: 0.06, length: 0.8 });
  },
  // A city raised: a bell chord over a low brass swell.
  city: (ctx, out) => {
    knock(ctx, out, { freq: 150, gain: 0.3 });
    horn(ctx, out, { freq: C3, start: 0.05, length: 1.1, gain: 0.07 });
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((freq, i) => bell(ctx, out, { freq, start: 0.08 + i * 0.06, gain: 0.05, length: 1.4 }));
  },
  // A development card drawn: a paper riffle and a sparkle.
  card: (ctx, out) => {
    [0, 0.03, 0.06, 0.09].forEach((start) => noise(ctx, out, { start, length: 0.04, gain: 0.12, filter: 4200 }));
    [NOTE.E5, NOTE.A5, NOTE.D5 * 2].forEach((freq, i) => tone(ctx, out, { freq, start: 0.12 + i * 0.05, length: 0.3, gain: 0.04 }));
  },
  // A knight played: a short brass fanfare.
  knight: (ctx, out) => EMOTE_SOUNDS.knight(ctx, out),
  // Monopoly: a cascade of coins falling into one purse.
  monopoly: (ctx, out) => {
    [NOTE.C6, NOTE.A5, NOTE.G5, NOTE.E5, NOTE.D5, NOTE.C5].forEach((freq, i) => bell(ctx, out, { freq, start: i * 0.06, gain: 0.05, length: 0.35 }));
    noise(ctx, out, { start: 0.3, length: 0.25, gain: 0.08, filter: 5000 });
  },
  // A trade with another player: two coins changing hands.
  trade: (ctx, out) => {
    bell(ctx, out, { freq: NOTE.G5, gain: 0.07, length: 0.4 });
    bell(ctx, out, { freq: NOTE.C6, start: 0.1, gain: 0.07, length: 0.5 });
  },
  // A bank trade: a counter bell.
  maritime: (ctx, out) => {
    knock(ctx, out, { freq: 280, gain: 0.18 });
    bell(ctx, out, { freq: NOTE.E5 * 2, start: 0.05, gain: 0.07, length: 0.8 });
  },
  // A card slipped away: a quick whoosh and a sly two-note figure.
  steal: (ctx, out) => {
    noise(ctx, out, { length: 0.25, gain: 0.16, filter: 1200, sweep: 4000 });
    tone(ctx, out, { freq: NOTE.E4, start: 0.12, length: 0.16, type: 'triangle', gain: 0.08 });
    tone(ctx, out, { freq: 311, start: 0.26, length: 0.26, type: 'triangle', gain: 0.07 });
  },
  // A 7: the dragon stirs. A low, dark minor chord and a growl.
  robber: (ctx, out) => EFFECTS.dragonWake(ctx, out),
  dragonWake: (ctx, out) => {
    [A3, 262, 330].forEach((freq, i) => horn(ctx, out, { freq: freq / 2, start: i * 0.04, length: 1.2, gain: 0.06 }));
    noise(ctx, out, { start: 0.15, length: 0.7, gain: 0.08, filter: 180, sweep: 90 });
  },
  // The dragon flies: wing beats under a rising horn motif, then it lands
  // and settles to sleep with a soft two-note lullaby.
  dragon: (ctx, out) => {
    [0, 0.22, 0.44, 0.66].forEach((start, i) => wing(ctx, out, { start, gain: 0.2 - i * 0.02 }));
    horn(ctx, out, { freq: A3, start: 0.05, length: 0.35 });
    horn(ctx, out, { freq: 262, start: 0.3, length: 0.35 });
    horn(ctx, out, { freq: 330, start: 0.55, length: 0.55, gain: 0.1 });
    knock(ctx, out, { start: 1.0, freq: 90, gain: 0.25 });
    pad(ctx, out, { freq: NOTE.E5, start: 1.15, length: 0.9, gain: 0.04 });
    pad(ctx, out, { freq: NOTE.C5, start: 1.5, length: 1.4, gain: 0.04 });
    pad(ctx, out, { freq: E3, start: 1.1, length: 1.8, gain: 0.03 });
  },
  // A quiet clock tick for the last seconds of a move.
  tick: (ctx, out) => {
    tone(ctx, out, { freq: 1320, length: 0.045, gain: 0.07 });
    noise(ctx, out, { length: 0.02, gain: 0.05, filter: 5200 });
  },
  // Someone else's turn begins.
  turn: (ctx, out) => {
    tone(ctx, out, { freq: NOTE.C5, length: 0.25, gain: 0.07 });
    tone(ctx, out, { freq: NOTE.E5, start: 0.06, length: 0.3, gain: 0.05 });
  },
  // Your turn begins: a gentle three-note call.
  myTurn: (ctx, out) => [NOTE.G4, NOTE.C5, NOTE.E5].forEach((freq, i) => bell(ctx, out, { freq, start: i * 0.11, gain: 0.07, length: 0.9 })),
  // A win: a calm major chord that blooms, then a short music-box tune.
  win: (ctx, out) => {
    [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5].forEach((freq, i) => pad(ctx, out, { freq, start: i * 0.04, length: 4, gain: 0.045, attack: 0.5 }));
    [NOTE.G5, NOTE.E5, NOTE.G5, NOTE.A5, NOTE.G5, NOTE.E5, NOTE.D5, NOTE.C5].forEach((freq, i) =>
      bell(ctx, out, { freq, start: 0.5 + i * 0.26, gain: 0.04, length: 1.1 }),
    );
  },
};

// One pluck per resource for the harvest, and one voice per emote.
Object.entries(RESOURCE_NOTE).forEach(([resource, freq]) => {
  EFFECTS[`pluck-${resource}`] = (ctx, out) => pluck(ctx, out, { freq });
});
Object.entries(EMOTE_SOUNDS).forEach(([key, effect]) => {
  EFFECTS[`emote-${key}`] = effect;
});

export const SFX_KEYS = Object.keys(EFFECTS);

export const playSfx = (key, volume = 0.8) => {
  const effect = EFFECTS[key];
  if (!effect || volume <= 0) return false;
  const ctx = audio();
  if (!ctx) return false;
  try {
    const { dry, wet } = busFor(ctx);
    const out = ctx.createGain();
    out.gain.value = Math.min(1, Math.max(0, volume));
    out.connect(dry);
    out.connect(wet);
    effect(ctx, out);
    return true;
  } catch {
    return false;
  }
};
