/**
 * The two things Twist mode has to say out loud: **the ring is about to burn**
 * and **you can buy a Wildcard** (§10.5).
 *
 * **One implementation, both screens.** This was built inside `room.ts` and hot
 * seat simply never got it — so single-player Twist had no collapse warning and
 * no Wildcard at all, which a 2026-08-12 playtest reported as "no fire warning,
 * no glowing wands". Copying the markup across would have left two versions of a
 * feature whose entire history is being invisible in slightly different ways
 * (§10.6), so it lives here instead and both screens mount it.
 *
 * Everything here is subject to §10.0: **no row may change height mid-game.**
 * The flame badge is absolutely positioned inside `.board-wrap` and holds no
 * row at all; the shop row is rendered once at mount, in Twist only, and greys
 * out rather than vanishing. Players also need to see a power exists before they
 * can afford it.
 *
 * ⚠️ And §10.6: the badge hides itself with `hidden`, which works only because
 * `base.css` carries a global `[hidden] { display: none !important }`. Do not
 * give `.burn-warning` its own `display` and expect `hidden` to win — that is
 * exactly the bug that made this warning meaningless for the whole life of the
 * feature.
 */

import {
  MAX_WILDCARD_CHARGES,
  SHRINK_INTERVAL_ROTATIONS,
  WILDCARD_COST,
} from "../../shared/constants.ts";
import { currentPlayer, roundsUntilCollapse, type GameState } from "../../shared/rules.ts";

/** The badge ring is r=19 in a 44-box viewBox; this is its circumference. */
const BURN_RING_CIRCUMFERENCE = 2 * Math.PI * 19;

/** How long the "you can afford a Wildcard" nudge stays up. */
const NUDGE_MS = 5000;

/**
 * The flame badge markup, for the caller to drop inside `.board-wrap`.
 *
 * It goes on the BOARD rather than in the shop row because that is where the
 * eyes already are mid-turn. The row's text chip stays too — the two are read at
 * different moments, and the chip alone was missed entirely in the 2026-08-03
 * playtest: 0.7rem of dim text in a row nobody was looking at.
 */
export const BURN_WARNING_HTML = `
  <div class="burn-warning" id="burn-warning" hidden aria-live="polite">
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <circle class="bw-track" cx="22" cy="22" r="19" />
      <circle class="bw-ring" cx="22" cy="22" r="19"
              stroke-dasharray="119.4" stroke-dashoffset="0" />
    </svg>
    <span class="bw-flame" aria-hidden="true">🔥</span>
    <span class="bw-count" id="burn-count"></span>
  </div>`;

/**
 * The shop row markup, for the caller to place as a fixed row.
 *
 * The nudge is anchored to the BUY BUTTON, not to the row: the row holds three
 * items, so a row-centred tail points into the gap beside the button it is
 * talking about. It floats above the row rather than sitting in it, because the
 * shop row holds ONE height for the whole game.
 */
export const SHOP_HTML = `
  <div class="shop" id="shop">
    <span class="shop-slot">
      <div class="shop-nudge" id="shop-nudge" hidden>
        Tap for Wildcard · one extra line
      </div>
      <button class="chip" id="buy"></button>
    </span>
    <button class="chip" id="arm"></button>
    <span class="shrink-chip" id="shrink"></span>
  </div>`;

export interface TwistHudView {
  state: GameState;
  /** Whose shop this is. -1 for a spectator, who has no shop of their own. */
  playerIndex: number;
  /** Watching rather than playing: everything stays visible, nothing is usable. */
  spectating: boolean;
}

export interface TwistHudOptions {
  /** Buy pressed. Online this sends `buy`; hot seat calls `buyWildcard`. */
  onBuy(): void;
  /** Arm pressed. Online this sends `arm`; hot seat calls `armWildcard`. */
  onArm(): void;
}

export interface TwistHud {
  /** Re-read the state. Safe to call on every event and every clock tick. */
  update(view: TwistHudView): void;
  dispose(): void;
}

/**
 * @param root The element containing both `BURN_WARNING_HTML` and `SHOP_HTML`.
 *             Either may be absent — a Simple-mode screen renders neither, and
 *             every method here degrades to a no-op rather than throwing.
 */
export function createTwistHud(root: HTMLElement, options: TwistHudOptions): TwistHud {
  const shrinkChip = root.querySelector<HTMLElement>("#shrink");
  const burnWarning = root.querySelector<HTMLElement>("#burn-warning");
  const burnCount = root.querySelector<HTMLElement>("#burn-count");
  const burnRing = root.querySelector<SVGCircleElement>(".bw-ring");
  const buyBtn = root.querySelector<HTMLButtonElement>("#buy");
  const armBtn = root.querySelector<HTMLButtonElement>("#arm");
  const nudge = root.querySelector<HTMLElement>("#shop-nudge");

  /*
   * The Wildcard went completely unnoticed in the 2026-08-03 playtest — a chip
   * reading "Wildcard · 10" that is disabled and dim for the first ten minutes
   * of a game teaches nobody it exists.
   *
   * So the first time you can actually afford one, say so. Once per game, five
   * seconds, and never again: a prompt that keeps returning stops being
   * information and becomes nagging.
   *
   * Deliberately NOT a buy button. It appears unprompted right where a thumb
   * already is, and spending ten hard-won squares on a mis-tap is exactly the
   * kind of thing that would make someone put the game down. It points; the real
   * button, which you have to aim at, still does the spending.
   */
  let nudgeState: "unseen" | "showing" | "done" = "unseen";
  let nudgeTimer = 0;

  function dismissNudge() {
    if (nudge) nudge.hidden = true;
    buyBtn?.classList.remove("nudged");
    window.clearTimeout(nudgeTimer);
    if (nudgeState === "showing") nudgeState = "done";
  }

  function maybeNudge(affordable: boolean) {
    if (!nudge || nudgeState !== "unseen") return;
    if (!affordable) return;
    nudgeState = "showing";
    nudge.hidden = false;
    buyBtn?.classList.add("nudged");
    nudgeTimer = window.setTimeout(dismissNudge, NUDGE_MS);
  }

  const onBuyClick = () => {
    dismissNudge();
    options.onBuy();
  };
  const onArmClick = () => options.onArm();

  buyBtn?.addEventListener("click", onBuyClick);
  armBtn?.addEventListener("click", onArmClick);
  nudge?.addEventListener("click", dismissNudge);

  /**
   * The collapse countdown, in two forms on purpose, because they are read at
   * different moments:
   *
   * - the flame badge sits ON the board, where the eyes already are, and is
   *   readable at a glance mid-turn — a drained ring means "this round";
   * - the chip spells it out in words for anyone who looks down at the row.
   */
  function updateShrink(state: GameState) {
    const rounds = roundsUntilCollapse(state);

    if (shrinkChip) {
      if (rounds === null) {
        shrinkChip.textContent = "";
        shrinkChip.className = "shrink-chip";
      } else {
        shrinkChip.textContent =
          rounds <= 1 ? "Board shrinks NEXT round" : `Board shrinks in ${rounds}`;
        shrinkChip.className = `shrink-chip visible${rounds <= 1 ? " imminent" : ""}`;
      }
    }

    if (!burnWarning || !burnCount || !burnRing) return;
    if (rounds === null) {
      // A warning that is always on is not a warning — §10.6, and the reason
      // two playtests said the burn "comes out of nowhere".
      burnWarning.hidden = true;
      return;
    }
    burnWarning.hidden = false;
    // "1" reads as a countdown; the badge going red is what says "now".
    burnCount.textContent = rounds <= 0 ? "!" : String(rounds);
    burnWarning.classList.toggle("imminent", rounds <= 1);
    burnWarning.title =
      rounds <= 1 ? "The outer ring burns next round" : `The outer ring burns in ${rounds}`;
    // Drains as it closes in: full at two rounds out, empty when it is due.
    const fraction = Math.max(0, Math.min(1, rounds / SHRINK_INTERVAL_ROTATIONS));
    burnRing.style.strokeDashoffset = String(BURN_RING_CIRCUMFERENCE * (1 - fraction));
  }

  /**
   * In twist mode the powerup row is present from the first frame and simply
   * greys out when unusable. It never leaves the layout (§10.0).
   */
  function updateShop({ state, playerIndex, spectating }: TwistHudView) {
    if (!buyBtn || !armBtn) return;

    const score = state.scores[playerIndex] ?? 0;
    const charges = state.charges[playerIndex] ?? 0;
    const myTurn =
      !spectating && currentPlayer(state) === playerIndex && state.phase === "playing";

    buyBtn.textContent = `Wildcard · ${WILDCARD_COST}`;
    buyBtn.disabled = !myTurn || score < WILDCARD_COST || charges >= MAX_WILDCARD_CHARGES;

    // Only once it is genuinely payable — pointing at a button that does
    // nothing when tapped is worse than saying nothing at all.
    maybeNudge(!buyBtn.disabled);
    if (charges > 0) dismissNudge();
    buyBtn.title = spectating
      ? "You are watching this game"
      : score < WILDCARD_COST
        ? `Costs ${WILDCARD_COST} boxes — you have ${score}`
        : `Burns ${WILDCARD_COST} of your boxes for one extra line`;

    armBtn.textContent = state.armed
      ? "Armed"
      : `Extra line${charges > 0 ? ` ×${charges}` : ""}`;
    armBtn.disabled = !myTurn || charges === 0 || state.armed;
    armBtn.classList.toggle("selected", state.armed);
  }

  return {
    update(view) {
      updateShop(view);
      updateShrink(view.state);
    },

    dispose() {
      window.clearTimeout(nudgeTimer);
      buyBtn?.removeEventListener("click", onBuyClick);
      armBtn?.removeEventListener("click", onArmClick);
      nudge?.removeEventListener("click", dismissNudge);
    },
  };
}
