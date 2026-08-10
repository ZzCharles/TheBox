/**
 * The eight sounds, synthesised sample by sample.
 *
 * PURE. No Web Audio, no DOM — a name and a sample rate in, a mono
 * `Float32Array` out. That is what makes them testable under `node --test`
 * alongside the rules engine, and it is the same trick `rules.ts` plays: keep
 * the part with the interesting logic free of the platform.
 *
 * Why synthesis rather than the `.webm` + `.mp3` files the brief first
 * specified: these are six clicks and a fanfare, none longer than 1.2s. Written
 * as maths they cost no bytes in the bundle, no request, no decode, and — the
 * part that actually mattered — no iOS codec fallback. Tuning one is editing a
 * number here rather than opening a DAW.
 *
 * Everything here is deterministic: the noise comes from a seeded generator, so
 * `tick` is the same 45 milliseconds every time it is rendered on every device.
 */

export type SfxName =
  | "tick"
  | "click"
  | "thunk"
  | "whoosh"
  | "clack"
  | "blip"
  | "crack"
  | "fanfare";

export const SFX_NAMES: readonly SfxName[] = [
  "tick",
  "click",
  "thunk",
  "whoosh",
  "clack",
  "blip",
  "crack",
  "fanfare",
] as const;

/** Length of each sound, in seconds. */
export const SFX_SECONDS: Record<SfxName, number> = {
  // A drawn line is a stroke, not an impact, and 45ms is impact length — there
  // is no room in it for an attack and a travel. 75ms is still shorter than the
  // gap between two taps.
  tick: 0.075,
  // A latch is caught, not left to ring. 45ms also clears the 70ms spacing used
  // when one line closes two boxes, so they read as two clicks, not one smear.
  click: 0.045,
  thunk: 0.15,
  whoosh: 0.4,
  clack: 0.06,
  blip: 0.05,
  crack: 0.25,
  fanfare: 1.2,
};

/**
 * Peak amplitude each sound is normalised to, which is the ONLY place relative
 * loudness is decided. `tick` fires on every line and `blip` interrupts you, so
 * both sit well under the fanfare; a sound you notice every three seconds has
 * to be quieter than one you hear once a game.
 */
const SFX_PEAK: Record<SfxName, number> = {
  tick: 0.42,
  click: 0.6,
  thunk: 0.75,
  whoosh: 0.5,
  clack: 0.62,
  blip: 0.3,
  // Once a game, and it is the beat the whole endgame hangs off — the board
  // breaking should be the second-loudest thing in the set, under the fanfare
  // it is setting up.
  crack: 0.8,
  fanfare: 0.85,
};

export function renderSfx(name: SfxName, sampleRate: number): Float32Array {
  const out = new Float32Array(Math.round(SFX_SECONDS[name] * sampleRate));
  GENERATORS[name](out, sampleRate);
  return polish(out, sampleRate, SFX_PEAK[name]);
}

// ------------------------------------------------------------------- parts ---

/**
 * Deterministic white noise (xorshift32). `Math.random()` would make the sound
 * — and therefore the test — different on every render for no audible gain.
 */
function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

/**
 * A one-pole lowpass, carrying its own state. The cutoff is an argument rather
 * than fixed at construction so it can sweep — `whoosh` is nothing but a noise
 * source behind a cutoff that opens and shuts.
 *
 * Feed it EVERY sample even when you are about to ignore the output: skipping
 * samples leaves the filter's memory describing a signal that never happened.
 */
function lowpass(sampleRate: number): (x: number, hz: number) => number {
  let y = 0;
  return (x, hz) => {
    y += (1 - Math.exp((-2 * Math.PI * hz) / sampleRate)) * (x - y);
    return y;
  };
}

/** Exponential decay: 1 at t=0, ~0.37 at t=tau. */
function decay(t: number, tau: number): number {
  return Math.exp(-t / tau);
}

// -------------------------------------------------------------- generators ---

type Generator = (out: Float32Array, sr: number) => void;

const GENERATORS: Record<SfxName, Generator> = {
  /**
   * Line placed — graphite dragged across paper. By far the most-heard sound in
   * the game, and the one the 2026-08-10 playtest named first. Chosen from three
   * candidates on 2026-08-10 ("Graphite").
   *
   * It was a 45ms band of noise with a 2600Hz sine under it: an impact, and an
   * electronic one. Drawing a line is neither.
   *
   * ⚠️ **The grains are the sound. Everything else is support.** A first attempt
   * modulated the friction band with a smoothed noise source at 110Hz and was
   * rejected on the spot — 110Hz is a slow wobble, and paper has no wobble in
   * it. Graphite catching on paper fibres is HUNDREDS OF TINY IMPACTS A SECOND,
   * so the tooth here is built from actual impulses: sparse spikes, each one a
   * fibre giving way, bandpassed into a short scratch. Replace them with any
   * kind of smooth modulation and this is a hiss again.
   *
   * The rest: a quiet continuous hiss underneath so it reads as one stroke
   * rather than a rattle, a band that dulls as it travels (pressure lifting at
   * the end of a stroke), and 4ms of attack — the point biting. No pitched
   * partial anywhere; a sine is what made the original sound like a device.
   */
  tick(out, sr) {
    const rand = noise(0x5eed01);
    const grit = noise(0x9a17e5);
    const hi = lowpass(sr);
    const lo = lowpass(sr);
    const grainHi = lowpass(sr);
    const grainLo = lowpass(sr);

    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const u = i / out.length;
      const n = rand();

      // Friction, in a bright band that closes over the stroke.
      const hiss = hi(n, 9000 - 3500 * u) - lo(n, 1800);

      // One fibre catching. The threshold sets how sparse the grains are, and
      // sparse is what makes them audible as grains rather than as more noise.
      const g = grit();
      const spike = Math.abs(g) > 0.955 ? g * 3.2 : 0;
      const grain = grainHi(spike, 6800) - grainLo(spike, 2200);

      const env = Math.min(1, t / 0.004) * decay(Math.max(0, t - 0.004), 0.021);

      out[i] = (hiss * 0.45 + grain * 1.5) * env;
    }
  },

  /**
   * Box claimed — a padlock snapping shut. Asked for "more clicky, like when you
   * press a padlock"; chosen from three candidates on 2026-08-10 ("Tight latch",
   * the driest of them).
   *
   * It used to be a struck wooden block with a SINE for a body, and that is why
   * it never read as a latch: a sine is a tone, and a padlock is metal. Metal
   * rings inharmonically, so the body here is three partials at 3600/5400/7300
   * that share no common fundamental — deliberately not an octave or a fifth,
   * for the same reason `click`'s old 1.48x partial was not a 2x.
   *
   * Damped hard (5ms) because this take is the dry one: the metal is heard, then
   * immediately caught. A second small contact at 5ms is the shackle seating,
   * which is what makes it a mechanism rather than a pop — `thunk` does the same
   * trick at 38ms, far enough out that you hear it as a separate event.
   *
   * Half the length it was (45ms, was 90ms). Two boxes closed by one line play
   * 70ms apart, so they now clear each other completely instead of smearing.
   */
  click(out, sr) {
    const rand = noise(0xc11c4a);
    const lo = lowpass(sr);
    const lo2 = lowpass(sr);

    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const n = rand();

      // The contact: bright, wide, and over almost before it began.
      const snap = (n - lo(n, 4200)) * decay(t, 0.0018);

      // Inharmonic partials — the sound of small, hard metal.
      const ring =
        (Math.sin(2 * Math.PI * 3600 * t) * 0.5 +
          Math.sin(2 * Math.PI * 5400 * t) * 0.32 +
          Math.sin(2 * Math.PI * 7300 * t) * 0.18) *
        decay(t, 0.005);

      // A trace of the lock's mass, so it is not purely surface.
      const mass = Math.sin(2 * Math.PI * 620 * t) * decay(t, 0.01) * 0.12;

      const st = t - 0.005;
      const seat = st > 0 ? (n - lo2(n, 5200)) * decay(st, 0.0024) * 0.42 : 0;

      out[i] = snap + ring * 0.42 + mass + seat;
    }
  },

  /**
   * The Play-button lid, and the Wildcard being paid for. A latch: one strike,
   * a low body dropping in pitch, then the catch engaging ~38ms later. That
   * second hit is the whole reason it reads as mechanical rather than as a drum.
   */
  thunk(out, sr) {
    const rand = noise(0x740104);
    const lo = lowpass(sr);
    const lo2 = lowpass(sr);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const f = 165 - 60 * Math.min(1, t / 0.08);
      phase += (2 * Math.PI * f) / sr;
      const n = rand();
      const strike = (n - lo(n, 800)) * decay(t, 0.005) * 0.5;
      const catchTone = n - lo2(n, 1600);
      const tl = t - 0.038;
      out[i] =
        Math.sin(phase) * decay(t, 0.05) * 0.9 +
        strike +
        (tl > 0 ? catchTone * decay(tl, 0.006) * 0.35 : 0);
    }
  },

  /**
   * The board collapsing inward. A swell of air: noise behind a cutoff that
   * opens and closes over the 400ms, with a low sweep underneath for weight.
   */
  whoosh(out, sr) {
    const rand = noise(0x330577);
    const lo = lowpass(sr);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const u = i / out.length;
      const swell = Math.sin(Math.PI * u) ** 1.4;
      const air = lo(rand(), 260 + 2400 * Math.sin(Math.PI * u)) * swell;
      phase += (2 * Math.PI * (95 - 45 * u)) / sr;
      out[i] = air * 1.6 + Math.sin(phase) * swell * 0.5;
    }
  },

  /**
   * An endgame piece landing on a score panel. Tile on tile: harder and higher
   * than `click`, and short enough that forty of them can overlap.
   */
  clack(out, sr) {
    const rand = noise(0xc1ac33);
    const lo = lowpass(sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const n = rand();
      const body =
        (Math.sin(2 * Math.PI * 1900 * t) * 0.5 + Math.sin(2 * Math.PI * 2810 * t) * 0.35) *
        decay(t, 0.012);
      out[i] = (n - lo(n, 1500)) * decay(t, 0.006) * 0.9 + body * 0.5;
    }
  },

  /**
   * Four seconds left. Quiet and high, with a 2ms attack so it does not click.
   * This one arrives uninvited, so it is the quietest thing in the set.
   */
  blip(out, sr) {
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const env = Math.min(1, t / 0.002) * decay(t, 0.016);
      out[i] =
        (Math.sin(2 * Math.PI * 1760 * t) * 0.8 + Math.sin(2 * Math.PI * 3520 * t) * 0.15) * env;
    }
  },

  /**
   * The board fracturing, once, at the end of the game.
   *
   * Three parts, and the third is the one that makes it read as a CRACK rather
   * than as a drum: a low body dropping away underneath, a hard rip of filtered
   * noise on top, and then four progressively smaller aftershocks racing off
   * into the tail. Those are the fracture lines running out along the box
   * boundaries — the sound is doing the same thing the picture is (§12.3 step
   * 2), and it is why this is 250ms rather than the 60ms `clack` is.
   */
  crack(out, sr) {
    const rand = noise(0xc4ac41);
    const lo = lowpass(sr);
    const lo2 = lowpass(sr);
    // Each one is quieter, later and shorter than the last, so the fracture
    // sounds like it is travelling away rather than repeating in place.
    const shocks = [
      { at: 0.058, gain: 0.5, tau: 0.012 },
      { at: 0.104, gain: 0.34, tau: 0.009 },
      { at: 0.157, gain: 0.22, tau: 0.007 },
      { at: 0.206, gain: 0.13, tau: 0.005 },
    ];
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const n = rand();

      // The body: low and falling, which is what "low crack" means here.
      phase += (2 * Math.PI * (150 - 95 * Math.min(1, t / 0.12))) / sr;
      const body = Math.sin(phase) * decay(t, 0.075) * 0.9;

      // The rip. A closing cutoff turns a bright snap into a dry one over ~40ms.
      const rip = (n - lo(n, 380 + 5200 * decay(t, 0.02))) * decay(t, 0.016) * 0.85;

      // The aftershocks share one filter, so they sit in the same room as the
      // rip instead of arriving as four unrelated noises.
      let after = 0;
      const bright = n - lo2(n, 2200);
      for (const s of shocks) {
        const st = t - s.at;
        if (st > 0) after += bright * decay(st, s.tau) * s.gain;
      }

      out[i] = body + rip + after * 0.55;
    }
  },

  /**
   * Victory. A major triad arriving one note at a time, then the octave over
   * the top ringing out longest. Each note carries two quiet partials and a
   * slightly detuned twin, which is what keeps it from sounding like a phone.
   */
  fanfare(out, sr) {
    const notes = [
      { f: 523.25, at: 0.0, tau: 0.3 },
      { f: 659.25, at: 0.085, tau: 0.32 },
      { f: 783.99, at: 0.17, tau: 0.36 },
      { f: 1046.5, at: 0.3, tau: 0.62 },
    ];
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      let s = 0;
      for (const note of notes) {
        const nt = t - note.at;
        if (nt <= 0) continue;
        const env = Math.min(1, nt / 0.008) * decay(nt, note.tau);
        const w = 2 * Math.PI * note.f * nt;
        s +=
          (Math.sin(w) + 0.35 * Math.sin(2 * w) + 0.12 * Math.sin(3 * w)) * env * 0.5 +
          0.25 * Math.sin(2 * Math.PI * note.f * 1.004 * nt) * env;
      }
      out[i] = s;
    }
  },
};

// ------------------------------------------------------------------ finish ---

/**
 * Raised-cosine fades at both ends, then peak-normalise.
 *
 * The fades matter more than they look: a buffer that starts or ends on a
 * non-zero sample is a step change in the speaker, which is an audible click
 * ON TOP of the sound you designed — and it is loudest on exactly the short,
 * sharp sounds where it is hardest to diagnose.
 *
 * Normalising last is deliberate. Scaling preserves zeros, so the fades survive
 * it, and the whole set ends up at an amplitude decided in one table rather
 * than falling out of whatever the maths happened to produce.
 */
function polish(out: Float32Array, sr: number, peak: number): Float32Array {
  const fadeIn = Math.max(1, Math.round(0.0015 * sr));
  const fadeOut = Math.max(1, Math.round(Math.min(0.02, (out.length / sr) * 0.2) * sr));

  for (let i = 0; i < fadeIn && i < out.length; i++) {
    out[i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
  }
  for (let i = 0; i < fadeOut && i < out.length; i++) {
    const at = out.length - 1 - i;
    out[at]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  }

  let max = 0;
  for (const s of out) max = Math.max(max, Math.abs(s));
  if (max > 0) {
    const scale = peak / max;
    for (let i = 0; i < out.length; i++) out[i]! *= scale;
  }
  return out;
}
