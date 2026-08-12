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

import {
  audioContext,
  duckSfx,
  releaseDuck,
  soundEnabled,
  voiceDestination,
} from "./engine.ts";

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
/**
 * Files that are definitively not audio — a 404, or a body that came back as
 * HTML. Never retried, because that answer will not change.
 *
 * ⚠️ **A network failure does NOT go in here.** That distinction is the whole
 * point: this Worker serves the SPA fallback for unknown paths, so "the file is
 * wrong" and "the network hiccuped" both surface as a failed decode, and
 * treating the second as permanent means one dropped request silences a line
 * for the rest of the session.
 */
const dead = new Set<string>();
/** Next take to use, per key, so repeats rotate rather than repeat. */
const rotation = new Map<VoiceKey, number>();

let current: AudioBufferSourceNode | null = null;
let lastHurryAt = 0;
/**
 * Increments on every `say` and every `silence`.
 *
 * Loads resolve out of order — a cached line returns instantly while an
 * uncached one waits on a fetch — so without a token the LAST line to finish
 * loading wins rather than the last one requested, and a 4-box "Nice" can cut
 * off the "Blazing" that overtook it. Captured before the await, re-checked
 * after; a stale token means someone else has spoken since, so drop it.
 */
let generation = 0;

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

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    // Transport failure — offline, aborted, DNS. Says nothing about the file,
    // so do NOT mark it dead; the next chain can try again.
    return null;
  }

  /*
   * ⚠️ **`response.ok` is not enough on this deployment.** The Worker answers an
   * unknown asset path with the SPA fallback — `index.html`, at status **200**.
   * A misnamed file therefore arrives looking like a success, and only fails
   * later inside `decodeAudioData` where the reason is unrecoverable.
   *
   * §0.1 records the same shape biting a deploy: for ~30 seconds after shipping,
   * even a CORRECT path can transiently return the fallback. So HTML is treated
   * as "not this time" rather than "never" — permanent death is reserved for a
   * real 404, and for bytes that are genuinely not decodable audio.
   */
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/html")) {
    console.warn(`[tiki] ${url} returned HTML, not audio — wrong filename, or a fresh deploy`);
    return null;
  }
  if (!response.ok) {
    dead.add(url);
    return null;
  }

  try {
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    decoded.set(url, buffer);
    return buffer;
  } catch {
    // Real bytes that this platform will not decode. That will not change on a
    // retry, so remember it and stop asking.
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

  // Claimed BEFORE the await. Anything that speaks or silences after this point
  // bumps the counter and this line is abandoned — which is what stops a slow
  // "Nice" from overtaking the "Blazing" that superseded it, and what stops a
  // line begun on the last box of a game from starting after teardown.
  const mine = ++generation;

  void load(url).then((buffer) => {
    if (mine !== generation) return;
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
  // Bumping the generation is the half that matters: `stop()` can only cut a
  // line that is already playing, and the one that bites is the line still
  // waiting on its decode, which would otherwise start over the screen that
  // just tore down.
  generation++;
  stop();
  // A duck outlives the line it was scheduled for. Cutting a 2s line at 0.2s
  // would otherwise leave the effects at 32% for the remaining 1.8s, and the
  // first ticks of the next game arrive noticeably quiet.
  releaseDuck();
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
