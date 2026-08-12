/**
 * Playback: one AudioContext, seven buffers, a handful of voices.
 *
 * Three rules govern everything here.
 *
 * 1. **A browser will not make a sound until the user has touched it.** The
 *    context has to be CREATED inside a real gesture handler on iOS, not merely
 *    resumed from one, so nothing exists until the first tap anywhere in the
 *    app. §12.1 of the brief puts this on the Play button; until that sequence
 *    is built, the first tap of any kind does the job, and the Play button will
 *    simply be one of them.
 *
 * 2. **Nothing here may ever throw.** Audio is decoration. A browser with the
 *    API missing, blocked by policy, or out of hardware voices must produce a
 *    silent game, never a broken one — so every entry point is a no-op when the
 *    context is absent.
 *
 * 3. **Cap the voices.** A chain of claims fires faster than the sounds decay,
 *    and eight overlapping copies of the same 90ms click is mush, not feedback.
 */

import { prefs } from "../net/identity.ts";
import { renderSfx, SFX_NAMES, type SfxName } from "./waveforms.ts";

export type { SfxName };

/** Headroom under 1.0, so four stacked voices still cannot clip the output. */
const MASTER_GAIN = 0.7;

/** §13: duck to four concurrent voices. Beyond that, the oldest is cut. */
const MAX_VOICES = 4;

/**
 * ±5% playback rate. A chain of six identical ticks sounds like a machine;
 * the same six with a little pitch scatter sound like a hand placing pieces.
 */
const PITCH_JITTER = 0.05;

let ctx: AudioContext | null = null;
/**
 * Two buses into one master gain, so a spoken line can duck the effects (§13.2)
 * without touching itself. Nothing holds the master node in a variable — the
 * graph does, and an unread reference is just something to keep in step.
 */
let sfxBus: GainNode | null = null;
let voiceBus: GainNode | null = null;
let enabled = true;
const buffers = new Map<SfxName, AudioBuffer>();
const voices: AudioBufferSourceNode[] = [];

const GESTURES = ["pointerdown", "keydown", "touchend"] as const;

/**
 * Arm the unlock. Cheap and synchronous — it only installs listeners; the
 * context and the buffers arrive with the first gesture.
 */
export function initAudio(): void {
  enabled = prefs().sound;
  if (ctx) return;
  for (const type of GESTURES) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }
}

function unlock(): void {
  for (const type of GESTURES) window.removeEventListener(type, unlock, { capture: true });
  if (ctx) return;

  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;

  try {
    const context = new Ctor();
    const gain = context.createGain();
    gain.gain.value = MASTER_GAIN;
    gain.connect(context.destination);

    // Two buses into one master. Effects can be pulled down under a voice line
    // without touching the voice, which is the only way "Here's your winner"
    // survives 144 endgame clacks arriving underneath it (§12.3 step 4).
    const sfx = context.createGain();
    sfx.gain.value = 1;
    sfx.connect(gain);
    const voice = context.createGain();
    voice.gain.value = 1;
    voice.connect(gain);

    // Rendered at the context's own rate, so playback never resamples. Seven
    // sounds totalling under two seconds of audio — a couple of milliseconds
    // of maths, once, inside a gesture we are already handling.
    for (const name of SFX_NAMES) {
      const samples = renderSfx(name, context.sampleRate);
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.getChannelData(0).set(samples);
      buffers.set(name, buffer);
    }

    ctx = context;
    sfxBus = sfx;
    voiceBus = voice;
    void context.resume();
  } catch {
    // Blocked, unsupported, or out of contexts. The game is now silent, which
    // is the correct outcome and not worth a console full of noise.
    ctx = null;
    sfxBus = null;
    voiceBus = null;
    buffers.clear();
  }
}

export interface PlayOptions {
  /** Multiplier on this one voice, 0–1. */
  gain?: number;
  /** Seconds from now. Used to space the two claims a single line can make. */
  delay?: number;
  /** Override the pitch scatter. Pass 0 for anything musical. */
  jitter?: number;
}

export function play(name: SfxName, options: PlayOptions = {}): void {
  if (!enabled || !ctx || !sfxBus) return;
  const buffer = buffers.get(name);
  if (!buffer) return;

  // Safari suspends the context when the tab goes to the background and does
  // not resume it on the way back.
  if (ctx.state === "suspended") void ctx.resume();

  while (voices.length >= MAX_VOICES) {
    // `stop()` fires `onended`, but this source is already off the list, so the
    // handler's `indexOf` finds nothing and the bookkeeping stays consistent.
    try {
      voices.shift()?.stop();
    } catch {
      /* already finished */
    }
  }

  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const jitter = options.jitter ?? PITCH_JITTER;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * jitter;

    const gain = ctx.createGain();
    gain.gain.value = options.gain ?? 1;
    source.connect(gain).connect(sfxBus);

    source.onended = () => {
      const at = voices.indexOf(source);
      if (at >= 0) voices.splice(at, 1);
    };
    source.start(ctx.currentTime + (options.delay ?? 0));
    voices.push(source);
  } catch {
    /* see rule 2 */
  }
}

/** Called by Settings. The preference gates playback rather than the context. */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (on && ctx?.state === "suspended") void ctx.resume();
}

/** True once a gesture has actually unlocked audio. Settings uses it to explain itself. */
export function soundReady(): boolean {
  return ctx !== null;
}

/**
 * The mute preference, for audio that does not go through this engine.
 *
 * `voice.ts` speaks through the platform synthesiser rather than the
 * AudioContext, so it cannot be gated by `play()` — but it must obey the same
 * toggle, and reading it from here rather than from `prefs()` keeps one answer
 * to "is this game making noise" instead of two that can disagree the moment
 * Settings changes it.
 */
export function soundEnabled(): boolean {
  return enabled;
}

// ------------------------------------------------------------------ voice ---

/**
 * The shared context, so `voice.ts` decodes its files at the sample rate
 * everything else already runs at and plays through the same output stage.
 *
 * ⚠️ **Voice deliberately does NOT go through `play()`.** The four-voice cap
 * with oldest-evicted (rule 3) is right for a chain of ticks and wrong for
 * speech: a line cut off halfway through by the next `clack` is worse than no
 * line at all.
 */
export function audioContext(): AudioContext | null {
  return ctx;
}

/** Where spoken lines connect. Null until the first gesture unlocks audio. */
export function voiceDestination(): GainNode | null {
  return voiceBus;
}

/** How far the effects bus drops under a voice line, and how fast it moves. */
const DUCK_TO = 0.32;
const DUCK_RAMP_SECONDS = 0.08;

/**
 * Pull the effects down for `seconds`, then bring them back.
 *
 * Ramped rather than stepped: a hard gain change on a bus that is already
 * making noise is an audible click, which is the exact artefact §13's
 * zero-endpoint test exists to avoid inside a single sound.
 */
export function duckSfx(seconds: number): void {
  if (!ctx || !sfxBus) return;
  try {
    const now = ctx.currentTime;
    const gain = sfxBus.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(DUCK_TO, now + DUCK_RAMP_SECONDS);
    gain.setValueAtTime(DUCK_TO, now + Math.max(seconds, DUCK_RAMP_SECONDS));
    gain.linearRampToValueAtTime(1, now + Math.max(seconds, DUCK_RAMP_SECONDS) + 0.18);
  } catch {
    /* see rule 2 */
  }
}
