/**
 * Streak callouts — a big chain should feel like an event (§12.4).
 *
 * ONE element that climbs rather than one slam per tier. A ten-box turn shows
 * "Nice", then swaps to "Blazing", then "Ruthless" as the boxes land, getting
 * hotter each time. Firing a separate callout per tier would stack three
 * animations on top of each other mid-chain, which is noise, not drama.
 *
 * Two constraints from §10.0 and §12.4, and both are why this is DOM and not
 * canvas:
 *
 * - it must never move a row, so it is absolutely positioned inside
 *   `.board-wrap` like the collapse badge;
 * - it must never block a tap, because the player is mid-turn and still on the
 *   clock — hence `pointer-events: none` on everything here.
 *
 * Staying off the canvas also keeps it out of the frame budget (§10.3)
 * entirely. The fire vocabulary is shared with `burn.ts` through `FIRE` in
 * constants.ts rather than reinvented, so the word burns in the same flames the
 * board does.
 */

import { streakTier } from "../../shared/constants.ts";
import { motionReduced } from "../net/identity.ts";

/**
 * How long a tier stays up before clearing itself.
 *
 * It clears even if the chain is still running. The word sits over the middle
 * of the board, and the player is mid-chain with the clock going — parking it
 * there for the whole run would hide the squares they are trying to tap. It
 * cannot literally block a tap (`pointer-events: none`), but obscuring the
 * board under a shot clock is the same problem wearing a different hat.
 */
const SHOW_MS = 850;
/** Matches the fade in game.css; only used to leave the a11y tree afterwards. */
const FADE_MS = 260;

export interface Streak {
  /**
   * Boxes claimed so far in the current turn. Safe to call on every move —
   * it only reacts when the total crosses into a new tier.
   */
  climb(boxesThisTurn: number): void;
  /** The turn ended. Lets the callout fade rather than cutting it. */
  end(): void;
  /** Drop it immediately — a resync, a rematch, a view teardown. */
  reset(): void;
  dispose(): void;
}

export function createStreak(host: HTMLElement): Streak {
  const el = document.createElement("div");
  el.className = "streak";
  el.hidden = true;
  el.setAttribute("aria-live", "polite");

  /*
   * The word lives in its own element, and the slam scales THAT rather than
   * `.streak`. `.streak` is `inset: 0`, so scaling it would scale a box the
   * size of the whole board out past the wrap — a 2.1x board is easily wider
   * than the phone, and the cost of being wrong is a horizontal scrollbar
   * flashing on every big chain. Scaling only the word keeps the growing box
   * small and inside the clip.
   */
  const word = document.createElement("span");
  word.className = "streak-word";
  el.appendChild(word);
  host.appendChild(el);

  /** Highest tier already announced this turn. -1 between turns. */
  let shownTier = -1;
  let hideTimer = 0;
  let clearTimer = 0;

  function stopTimers() {
    window.clearTimeout(hideTimer);
    window.clearTimeout(clearTimer);
    hideTimer = 0;
    clearTimer = 0;
  }

  function hide() {
    stopTimers();
    el.hidden = true;
    el.classList.remove("out");
    word.classList.remove("slam");
  }

  return {
    climb(boxesThisTurn) {
      const tier = streakTier(boxesThisTurn);
      if (!tier) return;
      // Only react on the way UP. This runs on every move of a chain, so
      // without it the animation would restart on each box.
      if (tier.at <= shownTier) return;

      shownTier = tier.at;
      stopTimers();
      el.hidden = false;
      el.classList.remove("out");
      word.textContent = tier.word;
      // One attribute drives every visual step, so the CSS owns what "hotter"
      // means rather than this file guessing at colours.
      el.dataset.tier = String(tier.at);
      el.classList.toggle("still", motionReduced());

      // Restart the slam even when the word was already up — reading
      // offsetWidth forces the reflow that lets the animation run again.
      word.classList.remove("slam");
      void word.offsetWidth;
      word.classList.add("slam");

      hideTimer = window.setTimeout(() => {
        el.classList.add("out");
        clearTimer = window.setTimeout(hide, FADE_MS);
      }, SHOW_MS);
    },

    end() {
      // The word is already clearing itself; the turn ending only needs to
      // arm the next one.
      shownTier = -1;
    },

    reset() {
      shownTier = -1;
      hide();
    },

    dispose() {
      stopTimers();
      el.remove();
    },
  };
}
