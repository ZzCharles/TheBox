/**
 * Spoken callouts over the streak celebration (§12.4).
 *
 * **Two backends, one call.** `say()` plays a recording if one has been
 * registered for that line, and otherwise falls back to the platform's speech
 * synthesiser. The owner's ElevenLabs recordings drop in behind
 * `registerVoiceSample` without anything here or in `streak.ts` changing shape —
 * which is the whole reason the indirection exists. Until then the synthesiser
 * carries it, so the timing and the pacing can be felt today rather than after
 * a recording session.
 *
 * ⚠️ **The synthesiser is a placeholder, and it sounds like one.** It is
 * whatever voice the device ships: a screen reader saying "WILDFIRE", not a hype
 * announcer, and noticeably different between iOS, Android and desktop. Judge
 * the timing on it, not the delivery.
 *
 * Three rules, the same three `engine.ts` obeys, and for the same reasons:
 *
 * 1. **Nothing may ever throw.** A voice line is decoration on decoration. Every
 *    entry point is a no-op when the API is missing or refuses.
 * 2. **The mute preference gates it.** People play this in public, and a game
 *    that goes quiet except for a voice shouting "Insanity" is worse than one
 *    that never shipped the feature.
 * 3. **One line at a time.** `Insanity` re-fires on every further box (§12.4),
 *    so without a cancel a twenty-box turn would queue five utterances and still
 *    be talking well into the next player's turn.
 */

import { soundEnabled } from "./engine.ts";

export interface VoiceLine {
  /** What the synthesiser says, until a recording replaces it. */
  text: string;
  /** 0.1–10. Faster is most of what "more excited" reads as. */
  rate: number;
  /** 0–2. */
  pitch: number;
  /** 0–1. Under the sound effects: this lands on top of ticks and clicks. */
  volume: number;
}

/**
 * Keyed by the streak word from `STREAK_TIERS`, so the ladder in
 * `constants.ts` stays the single source of what the tiers ARE and this file
 * only says how they sound.
 *
 * The escalation is deliberate and mechanical — rate and pitch climb together
 * rung by rung, because those are the two knobs a synthesiser actually has.
 */
export const VOICE_LINES: Record<string, VoiceLine> = {
  Nice: { text: "Nice", rate: 1, pitch: 1, volume: 0.55 },
  Blazing: { text: "Blazing!", rate: 1.1, pitch: 1.15, volume: 0.65 },
  Ruthless: { text: "Ruthless!", rate: 1.2, pitch: 1.3, volume: 0.75 },
  WILDFIRE: { text: "Wildfire!", rate: 1.3, pitch: 1.45, volume: 0.85 },
  Insanity: { text: "Insanity!", rate: 1.4, pitch: 1.6, volume: 1 },
};

/**
 * Recordings, once they exist. Empty on purpose.
 *
 * To use real audio: put the files in `public/sfx/voice/` and register them at
 * boot — `registerVoiceSample("WILDFIRE", "/sfx/voice/wildfire.mp3")`, one line
 * per tier. Anything registered wins over the synthesiser for that tier, so the
 * set can be filled in one word at a time rather than all at once.
 *
 * ⚠️ These would be the FIRST sampled audio in the project, which §13 avoided
 * deliberately — synthesised sound costs no bundle, no request, no decode and,
 * the part that decided it, no iOS codec fallback. Five short lines is a fine
 * reason to change that, but it is a change: ship `.mp3`, which every target
 * decodes, and keep them short enough that the whole set stays under a second
 * of audio.
 */
const samples = new Map<string, string>();

/** Point a tier at a recording. Later calls replace earlier ones. */
export function registerVoiceSample(key: string, url: string): void {
  samples.set(key, url);
}

/** The element currently talking, so a re-fire can cut it off. */
let playing: HTMLAudioElement | null = null;

/**
 * Say a line. Silent — never throwing, never queueing — if it cannot.
 *
 * @param key A word from `STREAK_TIERS`.
 */
export function say(key: string): void {
  if (!soundEnabled()) return;
  const line = VOICE_LINES[key];
  if (!line) return;

  const url = samples.get(key);
  if (url) {
    playSample(url, line.volume);
    return;
  }
  synthesise(line);
}

function playSample(url: string, volume: number): void {
  try {
    stopSample();
    const audio = new Audio(url);
    audio.volume = volume;
    playing = audio;
    audio.addEventListener("ended", () => {
      if (playing === audio) playing = null;
    });
    // Rejects when autoplay policy has not been satisfied. That is a silent
    // game, which is the correct outcome (rule 1).
    void audio.play().catch(() => {
      if (playing === audio) playing = null;
    });
  } catch {
    /* rule 1 */
  }
}

function synthesise(line: VoiceLine): void {
  // Feature-detected rather than assumed: the API is absent in some embedded
  // webviews entirely, and `SpeechSynthesisUtterance` can be missing even where
  // `speechSynthesis` is present.
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance !== "function") return;

  try {
    // Rule 3. Cancel is also the only way to interrupt a line already in
    // flight, which is exactly what a re-firing Insanity needs.
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(line.text);
    utterance.rate = line.rate;
    utterance.pitch = line.pitch;
    utterance.volume = line.volume;
    synth.speak(utterance);
  } catch {
    /* rule 1 */
  }
}

function stopSample(): void {
  if (!playing) return;
  try {
    playing.pause();
    playing.currentTime = 0;
  } catch {
    /* already gone */
  }
  playing = null;
}

/**
 * Shut up immediately — a turn ending, a resync, a view teardown.
 *
 * Worth calling on teardown specifically: `speechSynthesis` belongs to the
 * window, not to the element that started it, so an utterance survives the
 * screen that asked for it and would otherwise carry on talking over the lobby.
 */
export function silence(): void {
  stopSample();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* rule 1 */
  }
}
