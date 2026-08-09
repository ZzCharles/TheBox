/**
 * The start sequence: the mark draws itself, hits, and hands the screen to the
 * board.
 *
 * Values from `design/tiki-ui.html` → `Copy values`. ⚠️ This is NOT the
 * box-with-a-lid sequence in `box-start-sequence.html`; the design pass
 * superseded it with the Tiki mark, and the handover says so in §0. The old
 * prototype survives only as the reference for the shake and roll-in timings,
 * which this reuses.
 *
 * The whole point is that **the logo performs the game's own gesture**: the
 * stem of the first `i` draws downward with exactly the duration and easing of
 * placing a line, then the mark flares, lands, and shakes the table hard enough
 * to knock the dots loose — and the dots fall into place as the board.
 *
 * ```
 *    0ms          the mark, stem not yet drawn
 *  120ms          the stem draws down          140ms, the line-placing easing
 *  250ms          the mark flares               90ms box-shadow ramp
 *  270ms  IMPACT  screen shake begins          180ms, quadratic decay
 *                 `thunk` fires here — on contact, never on the tap
 *  380ms          the mark swells and fades    200ms, scale 1 -> 1.09
 *  440ms          the board begins rolling in
 *         +240ms  after the board lands, the HUD arrives and play begins
 * ```
 */

import { play } from "../audio/engine.ts";

const T = {
  /** The stem starts drawing here, and takes `stemDrawMs`. */
  stemAtMs: 120,
  stemDrawMs: 140,
  flareAtMs: 250,
  flareMs: 90,
  /** Contact. Everything below is measured from this. */
  hitMs: 270,
  shakeMs: 180,
  shakePx: 6,
  swellDelayMs: 110,
  swellMs: 200,
  swellTo: 1.09,
  boardDelayMs: 170,
  /** Quiet beat after the last row lands, before the HUD appears. */
  handoffMs: 240,
} as const;

/** The same curve the board uses to draw a placed line. */
const STEM_EASE = "cubic-bezier(.2,.7,.3,1)";
const SWELL_EASE = "cubic-bezier(.3,0,.5,1)";

export interface StartSequence {
  /** Stop early and clean up. Safe to call more than once. */
  cancel(): void;
}

/**
 * When the board should begin rolling in, measured from the first frame.
 *
 * The renderer is ARMED with this ahead of time rather than told at the moment
 * — it draws nothing until then, which is what gives the mark an empty table to
 * land on instead of a board already sitting there behind it.
 */
export const BOARD_START_OFFSET_MS = T.hitMs + T.boardDelayMs;

export interface StartSequenceOptions {
  /** The element to shake, and the one the overlay is appended to. */
  stage: HTMLElement;
  /** How long the roll-in will take, so the hand-off lands after it. */
  boardMs: number;
  /** Fires once play should begin. ALWAYS called, including on cancel. */
  onDone(): void;
}

export function playStartSequence(options: StartSequenceOptions): StartSequence {
  const { stage, boardMs, onDone } = options;

  const overlay = document.createElement("div");
  overlay.className = "start-seq";
  overlay.setAttribute("aria-hidden", "true");
  // Built by hand rather than through wordmark(), because this one must NOT
  // play the load-in assemble animation — the sequence drives the stem itself.
  overlay.innerHTML =
    '<span class="tiki start-mark">T<span class="mk"><s></s><b></b></span>ki</span>';
  stage.appendChild(overlay);

  const mark = overlay.querySelector<HTMLElement>(".start-mark")!;
  const dot = overlay.querySelector<HTMLElement>(".mk s")!;
  const stem = overlay.querySelector<HTMLElement>(".mk b")!;

  const timers: number[] = [];
  let frame = 0;
  let finished = false;
  const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

  // 1. The stem draws down from the dot, as though someone placed it.
  stem.animate(
    [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }],
    { duration: T.stemDrawMs, delay: T.stemAtMs, easing: STEM_EASE, fill: "both" },
  );

  // 2. The mark flares.
  at(T.flareAtMs, () => {
    dot.style.transition = `box-shadow ${T.flareMs}ms`;
    dot.style.boxShadow =
      "0 0 .2em .08em rgba(255,200,90,1), 0 0 .7em .2em rgba(255,176,32,.6)";
  });

  // 3. Contact: the sound, then the shake. `thunk` fires HERE and not on the
  //    tap — a latch you hear before it lands sounds like a different object.
  at(T.hitMs, () => {
    play("thunk");
    const start = performance.now();
    const shake = (now: number) => {
      const p = (now - start) / T.shakeMs;
      if (p >= 1) {
        stage.style.transform = "";
        return;
      }
      // Quadratic decay, and two different frequencies so the two axes never
      // line up into a diagonal wobble.
      const decay = (1 - p) * (1 - p);
      const x = Math.sin(p * Math.PI * 7.3) * T.shakePx * decay;
      const y = Math.cos(p * Math.PI * 5.1) * T.shakePx * 0.7 * decay;
      stage.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      frame = requestAnimationFrame(shake);
    };
    frame = requestAnimationFrame(shake);
  });

  // 4. The mark swells away, uncovering the board behind it.
  at(T.hitMs + T.swellDelayMs, () => {
    mark.animate(
      [
        { transform: "scale(1)", opacity: 1 },
        { transform: `scale(${T.swellTo})`, opacity: 0 },
      ],
      { duration: T.swellMs, easing: SWELL_EASE, fill: "forwards" },
    );
  });

  // 5. The dots roll in — already armed on the renderer, see
  //    BOARD_START_OFFSET_MS. Nothing to do here but wait for them.
  // 6. Hand off to the game.
  at(BOARD_START_OFFSET_MS + boardMs + T.handoffMs, finish);

  function finish() {
    if (finished) return;
    finished = true;
    for (const t of timers) window.clearTimeout(t);
    if (frame !== 0) cancelAnimationFrame(frame);
    stage.style.transform = "";
    overlay.remove();
    onDone();
  }

  return { cancel: finish };
}

/** Total wall-clock length, so callers can reason about it without guessing. */
export function startSequenceMs(boardMs: number): number {
  return T.hitMs + T.boardDelayMs + boardMs + T.handoffMs;
}
