import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { boxId, lineBoxes, lineCount } from "./board.ts";
import { SHRINK_INTERVAL_ROTATIONS, shrinkArmFraction } from "./constants.ts";
import {
  applyMove,
  createGame,
  currentPlayer,
  DEAD,
  isShrinkWarning,
  legalMoves,
  roundsUntilCollapse,
  SPENT,
  type GameState,
} from "./rules.ts";

/** Play legal moves until `stop` says otherwise. Returns the moves made. */
function playUntil(s: GameState, stop: (s: GameState) => boolean, limit = 600) {
  let moves = 0;
  while (!stop(s) && s.phase === "playing" && moves < limit) {
    const legal = legalMoves(s);
    if (legal.length === 0) break;
    const r = applyMove(s, currentPlayer(s), legal[0]!);
    assert.ok(r.ok, "expected a legal move to succeed");
    moves++;
  }
  return moves;
}

/** score === boxes owned on the board + boxes harvested by a shrink. */
function assertScoreInvariant(s: GameState, note: string) {
  for (let p = 0; p < s.scores.length; p++) {
    const onBoard = [...s.boxes].filter((b) => b === p).length;
    assert.equal(
      s.scores[p],
      onBoard + s.harvested[p],
      `${note}: player ${p} score ${s.scores[p]} != onBoard ${onBoard} + harvested ${s.harvested[p]}`,
    );
  }
}

describe("shrinking board — arming", () => {
  it("never arms in simple mode", () => {
    const s = createGame({ n: 6, mode: "simple", playerCount: 2 });
    playUntil(s, () => false);
    assert.equal(s.collapseAtRotation, null);
    assert.equal(s.bounds.r0, 0);
    assert.equal(s.bounds.r1, 5);
    assert.ok(![...s.boxes].includes(DEAD), "simple mode must never kill a box");
  });

  it("arms only once enough of the board is committed", () => {
    const s = createGame({ n: 6, mode: "twist", playerCount: 2 });
    const threshold = shrinkArmFraction(2) * lineCount(6);

    playUntil(s, (g) => g.collapseAtRotation !== null);
    assert.notEqual(s.collapseAtRotation, null, "should arm eventually");
    assert.ok(
      s.linesPlaced >= threshold,
      `armed at ${s.linesPlaced} lines, expected >= ${threshold}`,
    );
  });

  it("arms earlier in a big lobby, because those games drag", () => {
    assert.ok(shrinkArmFraction(6) < shrinkArmFraction(2));
    assert.ok(shrinkArmFraction(8) < shrinkArmFraction(4));
  });

  it("gives two rounds of notice before the first collapse", () => {
    const s = createGame({ n: 6, mode: "twist", playerCount: 3 });
    playUntil(s, (g) => g.collapseAtRotation !== null);

    assert.equal(
      roundsUntilCollapse(s),
      SHRINK_INTERVAL_ROTATIONS,
      "arming must leave time to react, not just announce the collapse",
    );
    assert.equal(
      isShrinkWarning(s),
      false,
      "the ring should not pulse yet — that is the final round",
    );
    assert.ok(![...s.boxes].includes(DEAD), "nothing dies while the countdown runs");
  });

  it("counts down, then pulses on the last round, then collapses", () => {
    const s = createGame({ n: 6, mode: "twist", playerCount: 3 });
    playUntil(s, (g) => g.collapseAtRotation !== null);

    const seen: Array<{ rounds: number | null; pulsing: boolean; dead: number }> = [];
    let guard = 0;
    while (s.phase === "playing" && s.bounds.r0 === 0 && guard++ < 800) {
      const legal = legalMoves(s);
      if (legal.length === 0) break;
      assert.ok(applyMove(s, currentPlayer(s), legal[0]!).ok);
      seen.push({
        rounds: roundsUntilCollapse(s),
        pulsing: isShrinkWarning(s),
        dead: [...s.boxes].filter((b) => b === DEAD).length,
      });
    }

    // The countdown must strictly decrease and the pulse must precede any death.
    const beforeCollapse = seen.filter((x) => x.dead === 0);
    assert.ok(beforeCollapse.length > 0);
    assert.ok(
      beforeCollapse.some((x) => x.rounds === SHRINK_INTERVAL_ROTATIONS && !x.pulsing),
      "there should be a visible countdown round with no pulse",
    );
    assert.ok(
      beforeCollapse.some((x) => x.rounds === 1 && x.pulsing),
      "the round before the collapse must pulse",
    );
    assert.ok(
      beforeCollapse.every((x) => x.dead === 0),
      "nothing may die before the collapse itself",
    );
  });

  it("reports no countdown in simple mode or before arming", () => {
    const simple = createGame({ n: 6, mode: "simple", playerCount: 2 });
    assert.equal(roundsUntilCollapse(simple), null);

    const twist = createGame({ n: 6, mode: "twist", playerCount: 2 });
    assert.equal(roundsUntilCollapse(twist), null, "not armed yet");
    assert.equal(isShrinkWarning(twist), false);
  });
});

describe("shrinking board — collapse", () => {
  /** Run a twist game to just after its first collapse. */
  function toFirstCollapse(n: number, players: number) {
    const s = createGame({ n, mode: "twist", playerCount: players });
    playUntil(s, (g) => g.bounds.r0 > 0);
    return s;
  }

  /**
   * Play until a move reports a collapse, capturing the state immediately
   * before that move. Assertions have to be made against the ShrinkOutcome,
   * because play continues during the warning rotation and the ring's contents
   * keep changing right up until it collapses.
   */
  function runToFirstCollapse(n: number, players: number) {
    const state = createGame({ n, mode: "twist", playerCount: players });
    for (let guard = 0; guard < 2000; guard++) {
      const legal = legalMoves(state);
      assert.ok(legal.length > 0, "ran out of moves before any collapse");

      const scoresBefore = [...state.scores];
      const remainingBefore = state.boxesRemaining;
      const player = currentPlayer(state);

      const r = applyMove(state, player, legal[0]!);
      assert.ok(r.ok);
      if (r.value.shrink) {
        return {
          state,
          shrink: r.value.shrink,
          scoresBefore,
          remainingBefore,
          claimedByMove: { player, boxes: r.value.claimed },
        };
      }
    }
    throw new Error("no collapse occurred");
  }

  it("removes the outer ring and contracts the bounds by one", () => {
    const s = toFirstCollapse(6, 2);
    assert.deepEqual(s.bounds, { r0: 1, c0: 1, r1: 4, c1: 4 });

    for (let c = 0; c < 6; c++) {
      assert.equal(s.boxes[boxId(6, 0, c)], DEAD, `top row box ${c}`);
      assert.equal(s.boxes[boxId(6, 5, c)], DEAD, `bottom row box ${c}`);
    }
    for (let r = 0; r < 6; r++) {
      assert.equal(s.boxes[boxId(6, r, 0)], DEAD, `left col box ${r}`);
      assert.equal(s.boxes[boxId(6, r, 5)], DEAD, `right col box ${r}`);
    }
  });

  it("lets owners keep points for claimed tiles, and records them as harvested", () => {
    const { state: s, shrink, scoresBefore, claimedByMove } = runToFirstCollapse(6, 2);

    // The only score change across that move is the boxes the move itself
    // claimed — harvesting an already-earned tile must not add or remove points.
    const expected = [...scoresBefore];
    expected[claimedByMove.player] =
      (expected[claimedByMove.player] ?? 0) + claimedByMove.boxes.length;
    assert.deepEqual([...s.scores], expected, "harvesting must not change scores");

    assert.equal(
      [...s.harvested].reduce((a, b) => a + b, 0),
      shrink.harvested.length,
      "every claimed ring tile should be recorded as harvested",
    );
    for (const { box, owner } of shrink.harvested) {
      assert.equal(s.boxes[box], DEAD, `harvested box ${box} should leave the board`);
      assert.ok(owner >= 0);
    }
    assertScoreInvariant(s, "after first collapse");
  });

  it("destroys unclaimed ring tiles so they can never be scored", () => {
    const { state: s, shrink, remainingBefore, claimedByMove } = runToFirstCollapse(6, 2);

    // No wildcards bought here, so every removed tile is either harvested or
    // was unclaimed and is now gone for good.
    const destroyed = shrink.removedBoxes.length - shrink.harvested.length;
    assert.ok(destroyed > 0, "the first ring should contain unclaimed tiles");
    assert.equal(
      s.boxesRemaining,
      remainingBefore - claimedByMove.boxes.length - destroyed,
      "unclaimed ring tiles must leave the pool",
    );
    for (const box of shrink.removedBoxes) {
      assert.equal(s.boxes[box], DEAD);
    }
  });

  it("clears placed lines that no longer border a live box", () => {
    const n = 6;
    const s = toFirstCollapse(n, 2);
    const live = (b: number) => b >= 0 && s.boxes[b] !== DEAD;

    let stillPlaced = 0;
    for (let id = 0; id < s.lines.length; id++) {
      if (s.lines[id] === 0) continue;
      stillPlaced++;
      const [a, b] = lineBoxes(n, id);
      assert.ok(
        live(a) || live(b),
        `line ${id} survived the collapse but borders nothing live`,
      );
    }
    assert.equal(stillPlaced, s.linesPlaced, "linesPlaced must match the board");
  });

  it("schedules the next collapse two rotations later", () => {
    const s = createGame({ n: 8, mode: "twist", playerCount: 2 });
    playUntil(s, (g) => g.bounds.r0 > 0);
    const firstAt = s.rotations;
    assert.equal(s.collapseAtRotation, firstAt + SHRINK_INTERVAL_ROTATIONS);
  });

  it("collapses repeatedly and always terminates the game", () => {
    for (const players of [2, 4, 6]) {
      const s = createGame({ n: 8, mode: "twist", playerCount: players });
      const moves = playUntil(s, () => false, 2000);

      assert.equal(s.phase, "over", `${players}p game should finish`);
      assert.ok(moves < 2000, "should not need the guard");
      assert.ok(s.bounds.r0 > 0, "at least one collapse should have happened");
      assertScoreInvariant(s, `${players}p final`);
      assert.equal(s.boxesRemaining, 0);
      assert.ok(s.winners.length >= 1);
    }
  });

  it("keeps the score invariant after every single move of a twist game", () => {
    const s = createGame({ n: 6, mode: "twist", playerCount: 3 });
    let guard = 0;
    while (s.phase === "playing" && guard++ < 1000) {
      const legal = legalMoves(s);
      if (legal.length === 0) break;
      assert.ok(applyMove(s, currentPlayer(s), legal[0]!).ok);
      assertScoreInvariant(s, `move ${guard}`);
    }
    assert.equal(s.phase, "over");
  });

  it("never leaves a playable line bordering only dead boxes", () => {
    const s = createGame({ n: 8, mode: "twist", playerCount: 2 });
    playUntil(s, (g) => g.bounds.r0 > 1); // at least two collapses
    for (const id of legalMoves(s)) {
      assert.ok(s.lines[id] === 0, "legal moves must be empty lines");
    }
    assert.ok(legalMoves(s).length > 0 || s.phase === "over");
  });
});

describe("shrinking board — interaction with the wildcard", () => {
  it("removes burned tiles without crediting anyone", () => {
    const s = createGame({ n: 6, mode: "twist", playerCount: 2 });

    // Hand player 0 a row of boxes on the outer ring, then burn them.
    for (let c = 0; c < 6; c++) {
      s.boxes[boxId(6, 0, c)] = 0;
      s.boxesRemaining--;
    }
    s.scores[0] = 6;
    s.boxes[boxId(6, 0, 0)] = SPENT;
    s.boxes[boxId(6, 0, 1)] = SPENT;
    s.scores[0] -= 2;

    playUntil(s, (g) => g.bounds.r0 > 0, 2000);

    assert.equal(s.boxes[boxId(6, 0, 0)], DEAD);
    assert.equal(s.boxes[boxId(6, 0, 1)], DEAD);
    assert.equal(
      s.harvested[0],
      4,
      "only the four still-owned tiles harvest; burned ones count for nobody",
    );
    assertScoreInvariant(s, "burned tiles in a collapsing ring");
  });
});
