import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyMove,
  buyWildcard,
  createGame,
  currentPlayer,
  legalMoves,
  SPENT,
  UNCLAIMED,
  DEAD,
  type GameState,
} from "../../shared/rules.ts";
import { planShatter, SHATTER } from "./shatter.ts";

/**
 * The endgame animation gets tests for exactly one reason, and it is not the
 * animation: `planShatter` decides which squares fly to a scoreboard, and every
 * square that flies is a point counted onto a panel. Put a square in the wrong
 * bucket and nobody sees a rendering glitch — they see a player finish on the
 * wrong score, in the one moment of the game that is entirely about the score.
 *
 * The invariant under all of it is §17:
 *
 *   scores[p] === (boxes on the board owned by p) + harvested[p]
 *
 * so a count-up that starts at `harvested[p]` and takes +1 per landing has to
 * arrive at exactly `scores[p]`. That is the last test here, and it is the one
 * worth keeping if the others ever become inconvenient.
 */

/** Play legal moves until the game is over, or the limit trips. */
function playOut(s: GameState, limit = 1200): void {
  let moves = 0;
  while (s.phase === "playing" && moves < limit) {
    const legal = legalMoves(s);
    if (legal.length === 0) break;
    const result = applyMove(s, currentPlayer(s), legal[0]!);
    assert.ok(result.ok, "expected a legal move to succeed");
    moves++;
  }
}

describe("shatter plan", () => {
  it("flies every owned square exactly once, and nothing else", () => {
    const game = createGame({ playerCount: 3, n: 8, mode: "simple" });
    playOut(game);
    assert.equal(game.phase, "over", "the game should have finished");

    const plan = planShatter(game.boxes, 8);

    const flown = new Set(plan.flyers.map((f) => f.box));
    assert.equal(flown.size, plan.flyers.length, "a square was launched twice");

    for (let box = 0; box < game.boxes.length; box++) {
      const owner = game.boxes[box]!;
      assert.equal(
        flown.has(box),
        owner >= 0,
        `box ${box} (owner ${owner}) is on the wrong side of the split`,
      );
    }

    // Between them the two lists account for the whole board — a square that
    // appeared in neither would simply stay lit on a board everything else has
    // left, which is the failure mode most likely to survive a playtest.
    assert.equal(
      plan.flyers.length + plan.retiring.length,
      game.boxes.length,
      "every square must either fly or retire",
    );
  });

  it("keeps a Wildcard square out of the air, and drops it instead", () => {
    const game = createGame({ playerCount: 2, n: 8, mode: "twist" });
    // Bank enough to afford one, then buy — which burns ten owned squares.
    while (game.scores[0]! < 10 && game.phase === "playing") {
      const legal = legalMoves(game);
      if (legal.length === 0) break;
      applyMove(game, currentPlayer(game), legal[0]!);
    }
    const buyer = [0, 1].find((p) => game.scores[p]! >= 10);
    assert.notEqual(buyer, undefined, "nobody banked enough to buy a Wildcard");
    // Buying is only legal on your own turn, so point the rotation at them.
    game.turnPtr = [...game.turnOrder].indexOf(buyer!);
    const bought = buyWildcard(game, buyer!);
    assert.ok(bought.ok, "the buy should have succeeded");

    playOut(game);
    const plan = planShatter(game.boxes, 8);
    const flown = new Set(plan.flyers.map((f) => f.box));
    const crumbling = new Set(
      plan.retiring.filter((r) => r.crumbles).map((r) => r.box),
    );

    let spent = 0;
    for (let box = 0; box < game.boxes.length; box++) {
      if (game.boxes[box] !== SPENT) continue;
      spent++;
      assert.ok(!flown.has(box), `spent box ${box} must not fly — it counts for nobody`);
      assert.ok(crumbling.has(box), `spent box ${box} should crumble, not dissolve`);
    }
    assert.ok(spent > 0, "the buy should have burned some squares");

    // And nothing else crumbles: ash and never-claimed squares fade instead,
    // because falling is what a traded square does.
    for (const box of crumbling) {
      assert.equal(game.boxes[box], SPENT, `box ${box} crumbled without being spent`);
    }
  });

  it("bounds the launch window however big the board is", () => {
    for (const n of [8, 10, 12, 14]) {
      const game = createGame({ playerCount: 2, n: n, mode: "simple" });
      playOut(game, 2000);
      const plan = planShatter(game.boxes, n);

      assert.ok(plan.staggerMs >= SHATTER.staggerMin, `${n}: stagger under the floor`);
      assert.ok(plan.staggerMs <= SHATTER.staggerMax, `${n}: stagger over the ceiling`);

      const lastLaunch =
        plan.flyers.length > 0 ? plan.flyers[plan.flyers.length - 1]!.at : 0;
      assert.ok(
        lastLaunch <= SHATTER.flightWindowMs,
        `${n}: launches run ${lastLaunch}ms, past the ${SHATTER.flightWindowMs}ms window`,
      );
      // Grand has ~3x the squares of Small and must not take ~3x as long.
      assert.ok(
        plan.flightMs <= SHATTER.flightWindowMs + SHATTER.crumbleMs + SHATTER.pieceMs,
        `${n}: the whole flight runs ${plan.flightMs}ms`,
      );
    }
  });

  it("breaks outward from the centre", () => {
    const game = createGame({ playerCount: 2, n: 10, mode: "simple" });
    playOut(game);
    const plan = planShatter(game.boxes, 10);

    const centre = (10 - 1) / 2;
    const distanceOf = (box: number) =>
      Math.hypot(Math.floor(box / 10) - centre, (box % 10) - centre);

    let previous = -Infinity;
    for (const flyer of plan.flyers) {
      const d = distanceOf(flyer.box);
      assert.ok(d >= previous - 1e-9, "a piece launched before one nearer the centre");
      previous = d;
    }
  });

  it("counts each player up from `harvested` to exactly their final score", () => {
    /*
     * The whole point, and the reason `harvested` is the starting value rather
     * than zero. A square the fire took banked its point rounds ago and does
     * not fly again — counting from zero would leave every twist game finishing
     * short by exactly the number of squares that ever burned.
     *
     * Twist, so the board really does collapse and really does harvest.
     */
    const game = createGame({ playerCount: 4, n: 8, mode: "twist" });
    playOut(game, 2000);
    assert.equal(game.phase, "over");

    const harvestedTotal = [...game.harvested].reduce((a, b) => a + b, 0);
    assert.ok(harvestedTotal > 0, "expected a collapse to have harvested something");

    const plan = planShatter(game.boxes, 8);

    // Start where the fire left them, then add one per landing.
    const counters = [...game.harvested];
    for (const flyer of plan.flyers) counters[flyer.owner]! += 1;

    for (let p = 0; p < game.scores.length; p++) {
      assert.equal(
        counters[p],
        game.scores[p],
        `player ${p} counts up to ${counters[p]} but scored ${game.scores[p]}`,
      );
    }
  });

  it("survives a board where nobody owns anything", () => {
    // Not a real game state, but it is one frame away from several: a room that
    // ends on a collapse can leave nothing live behind, and an empty flyer list
    // divides by zero if the stagger is written the obvious way.
    const boxes = new Int8Array(64).fill(UNCLAIMED);
    boxes[0] = DEAD;
    const plan = planShatter(boxes, 8);

    assert.equal(plan.flyers.length, 0);
    assert.equal(plan.retiring.length, 64);
    assert.ok(Number.isFinite(plan.staggerMs), "stagger went non-finite on an empty board");
    assert.ok(Number.isFinite(plan.flightMs), "flight length went non-finite");
  });
});
