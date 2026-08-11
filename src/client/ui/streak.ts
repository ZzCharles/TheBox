/**
 * Streak callouts — a big chain should feel like an event (§12.4).
 *
 * ONE element that climbs rather than one slam per tier. A ten-box turn shows
 * "Nice", then swaps to "Blazing", then "Ruthless" as the boxes land, getting
 * hotter each time. Firing a separate callout per tier would stack three
 * animations on top of each other mid-chain, which is noise, not drama.
 *
 * **The top rung is the exception.** `Insanity` re-fires on every further box
 * (owner's call, 2026-08-12): there is no higher word to climb to, so repetition
 * is the only escalation left. `isTopStreakTier` in constants.ts is what makes
 * that one rung different, rather than a magic number here.
 *
 * **It sits over the SCOREBOARD, not the board** (moved 2026-08-12, owner's
 * call). It used to be centred in `.board-wrap`, which put the word squarely
 * over the squares the player was still trying to tap. Anchoring it to the
 * scoreboard host means it lands over the scores on both screens automatically
 * — hot seat has no header row and the online game does, so any fixed offset
 * from the top would have been right on one screen and wrong on the other.
 *
 * Two constraints from §10.0 and §12.4, and both are why this is DOM and not
 * canvas:
 *
 * - it must never move a row, so it is absolutely positioned inside its host
 *   and takes no part in the layout;
 * - it must never block a tap, because the player is mid-turn and still on the
 *   clock — hence `pointer-events: none` on everything here.
 *
 * Staying off the canvas also keeps it out of the frame budget (§10.3)
 * entirely. The fire vocabulary is shared with `burn.ts` through `FIRE` in
 * constants.ts rather than reinvented, so the word burns in the same flames the
 * board does.
 */

import { isTopStreakTier, STREAK_TIERS, streakTier } from "../../shared/constants.ts";
import { say, silence } from "../audio/voice.ts";
import { motionReduced } from "../net/identity.ts";

/**
 * How long a tier stays up before clearing itself.
 *
 * It clears even if the chain is still running. The player is mid-chain with
 * the clock going, and a word parked over the scoreboard hides the one number
 * they are playing against. It cannot literally block a tap
 * (`pointer-events: none`), but obscuring the scores under a shot clock is the
 * same problem wearing a different hat.
 */
const SHOW_MS = 850;
/** Matches the fade in game.css; only used to leave the a11y tree afterwards. */
const FADE_MS = 260;

/**
 * Embers drifting up off the word, per tier. Index is the rung, not the
 * threshold: nothing at `Nice`, a scatter by `Ruthless`, a column by `Insanity`.
 *
 * They are spans rather than particles because this is the DOM layer — a canvas
 * here would buy nothing and would land back inside the frame budget the whole
 * file exists to stay out of.
 */
const EMBERS_PER_TIER = [0, 4, 9, 14, 20];

export interface Streak {
  /**
   * Boxes claimed so far in the current turn. Safe to call on every move —
   * it only reacts when the total crosses into a new tier, or when it grows at
   * the top tier, which re-fires per box.
   */
  climb(boxesThisTurn: number): void;
  /** The turn ended. Lets the callout fade rather than cutting it. */
  end(): void;
  /** Drop it immediately — a resync, a rematch, a view teardown. */
  reset(): void;
  dispose(): void;
}

/**
 * @param host The element the callout centres itself on. Pass the SCOREBOARD
 *             host, not the board wrap — the callout covers it while it plays.
 *             `game.css` gives it the `position: relative` this needs.
 */
export function createStreak(host: HTMLElement): Streak {
  const el = document.createElement("div");
  el.className = "streak";
  el.hidden = true;
  el.setAttribute("aria-live", "polite");

  /*
   * Four elements, because each owns exactly ONE animation and CSS gives an
   * element only one `animation` property. The word slams, the ink inside it
   * burns and shakes, the sheet behind it licks, the embers rise. Folding the
   * slam and the burn together means the later rule silently wins and the fire
   * stops for the 260ms everyone is looking at it.
   *
   * The slam also scales the WORD rather than `.streak`, which is `inset: 0`:
   * scaling that would scale a box the size of the host, and the cost of being
   * wrong is a horizontal scrollbar flashing on every big chain.
   */
  const flames = document.createElement("span");
  flames.className = "streak-flames";
  flames.setAttribute("aria-hidden", "true");

  const word = document.createElement("span");
  word.className = "streak-word";
  const ink = document.createElement("span");
  ink.className = "streak-ink";
  word.appendChild(ink);

  const embers = document.createElement("span");
  embers.className = "streak-embers";
  embers.setAttribute("aria-hidden", "true");

  el.append(flames, word, embers);
  host.appendChild(el);

  /** Highest tier already announced this turn. -1 between turns. */
  let shownTier = -1;
  /** Boxes the last callout was fired for, so the top tier can spot growth. */
  let shownHaul = 0;
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
    embers.replaceChildren();
  }

  /**
   * Rebuild the ember column for a tier.
   *
   * Each ember carries its own horizontal offset, delay, drift and duration as
   * custom properties, so one keyframe animation produces a scatter rather than
   * a rank of identical sparks marching in step. Rebuilt per fire, which is
   * what makes a re-firing Insanity throw a fresh handful each time.
   */
  function buildEmbers(rung: number) {
    const count = motionReduced() ? 0 : (EMBERS_PER_TIER[rung] ?? 0);
    const next: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const ember = document.createElement("i");
      ember.className = "ember";
      ember.style.setProperty("--x", `${Math.round(Math.random() * 100)}%`);
      ember.style.setProperty("--drift", `${(Math.random() * 2 - 1) * 26}px`);
      ember.style.setProperty("--delay", `${Math.round(Math.random() * 260)}ms`);
      ember.style.setProperty("--dur", `${700 + Math.round(Math.random() * 500)}ms`);
      ember.style.setProperty("--size", `${2 + Math.round(Math.random() * 3)}px`);
      next.push(ember);
    }
    embers.replaceChildren(...next);
  }

  return {
    climb(boxesThisTurn) {
      const tier = streakTier(boxesThisTurn);
      if (!tier) return;

      // Only react on the way UP — this runs on every move of a chain, so
      // without the guard the animation would restart on each box. The top
      // rung deliberately opts out: past sixteen there is nothing higher to
      // climb to, so every further box re-fires the same word instead.
      const grew = boxesThisTurn > shownHaul;
      const refires = isTopStreakTier(tier) && grew;
      if (tier.at <= shownTier && !refires) return;

      // Derived from the table, never restated — a second copy of the
      // thresholds here would silently disagree the first time one is tuned,
      // and §12.4.1 says tuning them is expected.
      const rung = Math.max(0, STREAK_TIERS.findIndex((t) => t.at === tier.at));

      shownTier = tier.at;
      shownHaul = boxesThisTurn;
      stopTimers();
      el.hidden = false;
      el.classList.remove("out");
      ink.textContent = tier.word;
      // One attribute drives every visual step, so the CSS owns what "hotter"
      // means rather than this file guessing at colours.
      el.dataset.tier = String(tier.at);
      el.classList.toggle("still", motionReduced());
      buildEmbers(rung);

      // Restart the slam even when the word was already up — reading
      // offsetWidth forces the reflow that lets the animation run again.
      word.classList.remove("slam");
      void word.offsetWidth;
      word.classList.add("slam");

      // Decoration on decoration: `say` is a no-op when muted, when the API is
      // missing, or when the platform simply refuses. It never throws and it
      // never queues, so a re-firing Insanity cuts its own previous line off
      // rather than talking into the next player's turn.
      say(tier.word);

      hideTimer = window.setTimeout(() => {
        el.classList.add("out");
        clearTimer = window.setTimeout(hide, FADE_MS);
      }, SHOW_MS);
    },

    end() {
      // The word is already clearing itself; the turn ending only needs to
      // arm the next one.
      shownTier = -1;
      shownHaul = 0;
    },

    reset() {
      shownTier = -1;
      shownHaul = 0;
      silence();
      hide();
    },

    dispose() {
      stopTimers();
      // The synthesiser belongs to the window, not to this element, so an
      // utterance outlives the screen that started it unless it is cancelled.
      silence();
      el.remove();
    },
  };
}
