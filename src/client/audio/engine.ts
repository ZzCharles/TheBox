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
let master: GainNode | null = null;
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
    master = gain;
    void context.resume();
  } catch {
    // Blocked, unsupported, or out of contexts. The game is now silent, which
    // is the correct outcome and not worth a console full of noise.
    ctx = null;
    master = null;
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
  if (!enabled || !ctx || !master) return;
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
    source.connect(gain).connect(master);

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
