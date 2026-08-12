/**
 * Spoken callouts — the announcer (§13.2).
 *
 * **Recorded, not synthesised** (2026-08-13). The first version used the
 * platform's `SpeechSynthesis` as a placeholder and it was rejected on hearing
 * it — correctly; it was a screen reader shouting. The owner produced real
 * lines, so the synthesiser is gone rather than kept as a fallback: a bad voice
 * is worse than no voice, which was the whole verdict.
 *
 * ⚠️ **A missing file is therefore SILENCE, and that is deliberate.** Nothing
 * substitutes for a line that has not been recorded yet. The game plays fine
 * without any of them.
 *
 * These are the **first sampled audio in the project**, which §13 avoided on
 * purpose — synthesis costs no bundle, no request, no decode and no codec
 * fallback. Nine short lines is a fair reason to change that, and `.mp3` is the
 * format because every target decodes it, which is what removes the fallback
 * problem the original decision was really about.
 *
 * Three rules, matching `engine.ts`:
 *
 * 1. **Nothing may ever throw.** A line that will not load or will not decode
 *    produces a quiet game, never a broken one.
 * 2. **The mute preference gates it**, through `soundEnabled()` — one answer to
 *    "is this game making noise", not two that can disagree.
 * 3. **One line at a time**, and the newest wins. `Insanity` re-fires per box
 *    (§12.4), so without a cut a long turn would queue five lines and still be
 *    talking into the next player's turn.
 */

import { audioContext, duckSfx, soundEnabled, voiceDestination } from "./engine.ts";

/**
 * Every line the game can speak.
 *
 * Streak tiers are keyed by the WORD from `STREAK_TIERS`, so `streak.ts` can
 * pass `tier.word` straight through and the ladder in `constants.ts` stays the
 * only place that decides what the tiers are.
 */
export type VoiceKey =
  | "Nice"
  | "Blazing"
  | "Ruthless"
  | "WILDFIRE"
  | "Insanity"
  | "start"
  | "winner"
  | "draw"
  | "hurry"
  | "parked";

/**
 * Where each line lives, relative to `public/`.
 *
 * **Several files per key rotate.** `Insanity` re-fires on every further box,
 * and one recording played six times in four seconds stops being an announcer
 * and becomes a stuck record — so extra takes are listed here and cycled.
 * Adding one is appending a filename; there is nothing else to change.
 *
 * ⚠️ **A listed file that does not exist is a 404 on first use, then silence
 * for that key forever after.** Harmless, but do not list takes speculatively:
 * list what has actually been recorded.
 */
const VOICE_FILES: Record<VoiceKey, string[]> = {
  Nice: ["/sfx/voice/nice.mp3"],
  Blazing: ["/sfx/voice/blazing.mp3"],
  Ruthless: ["/sfx/voice/ruthless.mp3"],
  WILDFIRE: ["/sfx/voice/wildfire.mp3"],
  Insanity: ["/sfx/voice/insanity.mp3"],
  start: ["/sfx/voice/here-we-go.mp3"],
  winner: ["/sfx/voice/heres-your-winner.mp3"],
  // Not recorded yet — "Here's your winner" is wrong on a shared victory, and
  // §9.1 makes ties a real outcome rather than an edge case.
  draw: [],
  hurry: ["/sfx/voice/tick-tick.mp3"],
  parked: ["/sfx/voice/you-there.mp3"],
};

/** Per-line level. Speech sits over the effects, but must not shout. */
const VOICE_GAIN: Partial<Record<VoiceKey, number>> = {
  Nice: 0.75,
  Blazing: 0.85,
  Ruthless: 0.92,
  WILDFIRE: 1,
  Insanity: 1,
  hurry: 0.7,
  parked: 0.8,
};

/**
 * The shortest gap between two `hurry` lines.
 *
 * ⚠️ **This exists because the 4-second warning fires EVERY TURN.** A voice on
 * every turn of a twenty-minute game is roughly a hundred repetitions of the
 * same two syllables, which is how a warning becomes wallpaper — the same
 * failure §10.5 designed the Wildcard nudge around, and §10.6's "a warning that
 * is always on is not a warning". The amber ring, the buzz and the pill still
 * fire every time; only the voice is rationed. One line to change if it turns
 * out to be too quiet or still too much.
 */
const HURRY_COOLDOWN_MS = 45_000;

const decoded = new Map<string, AudioBuffer>();
/** Files that failed once. Never retried — a 404 does not become a 200. */
const dead = new Set<string>();
/** Next take to use, per key, so repeats rotate rather than repeat. */
const rotation = new Map<VoiceKey, number>();

let current: AudioBufferSourceNode | null = null;
let lastHurryAt = 0;

/** Pick the next take for a key, skipping any that have already failed. */
function nextFile(key: VoiceKey): string | null {
  const files = VOICE_FILES[key].filter((f) => !dead.has(f));
  if (files.length === 0) return null;
  const index = (rotation.get(key) ?? 0) % files.length;
  rotation.set(key, index + 1);
  return files[index]!;
}

async function load(url: string): Promise<AudioBuffer | null> {
  const cached = decoded.get(url);
  if (cached) return cached;
  const ctx = audioContext();
  if (!ctx) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    decoded.set(url, buffer);
    return buffer;
  } catch {
    // Missing, blocked, or not decodable on this platform. Remember, so a line
    // that cannot play does not re-request on every single chain.
    dead.add(url);
    return null;
  }
}

/**
 * Say a line. Silent — never throwing, never queueing — if it cannot.
 *
 * Deliberately fire-and-forget: callers are on the game's hot path (a claim
 * landing, a turn ending) and must never wait on a decode.
 */
export function say(key: VoiceKey): void {
  if (!soundEnabled()) return;
  if (!audioContext()) return;

  if (key === "hurry") {
    const now = Date.now();
    if (now - lastHurryAt < HURRY_COOLDOWN_MS) return;
    lastHurryAt = now;
  }

  const url = nextFile(key);
  if (!url) return;

  void load(url).then((buffer) => {
    if (!buffer || !soundEnabled()) return;
    const ctx = audioContext();
    const destination = voiceDestination();
    if (!ctx || !destination) return;

    try {
      // Rule 3. The newest line wins outright.
      stop();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = VOICE_GAIN[key] ?? 0.9;
      source.connect(gain).connect(destination);
      source.onended = () => {
        if (current === source) current = null;
      };
      source.start();
      current = source;
      // Hold the effects down for exactly as long as the line lasts.
      duckSfx(buffer.duration);
    } catch {
      /* rule 1 */
    }
  });
}

function stop(): void {
  if (!current) return;
  try {
    current.onended = null;
    current.stop();
  } catch {
    /* already finished */
  }
  current = null;
}

/**
 * Shut up immediately — a turn ending badly, a resync, a view teardown.
 *
 * Worth calling on teardown specifically: the source outlives the screen that
 * started it, so a line begun on the last box of a game would otherwise carry
 * on talking over the lobby.
 */
export function silence(): void {
  stop();
}

/**
 * Reset the once-per-interval state at the start of a match.
 *
 * Without this the `hurry` cooldown carries across a rematch, and the first
 * warning of a brand-new game gets swallowed by the previous game's timer.
 */
export function resetVoiceState(): void {
  lastHurryAt = 0;
}
