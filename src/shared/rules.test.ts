import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { boxId, boxLineIds, hLineId, lineCount, vLineId } from "./board.ts";
import {
  CONTINUATION_TURN_SECONDS,
  MAX_WILDCARD_CHARGES,
  MISSED_TURNS_TO_BENCH,
  TURN_SECONDS,
  WILDCARD_COST,
} from "./constants.ts";
import {
  applyMove,
  armWildcard,
  bench,
  buyWildcard,
  canPlace,
  createGame,
  currentPlayer,
  legalMoves,
  skipTurn,
  SPENT,
  UNCLAIMED,
  unbench,
  type GameState,
  type MoveOutcome,
  type Result,
} from "./rules.ts";

// ------------------------------------------------------------------ helpers ---

function game(n: number, players: number, mode: "simple" | "twist" = "simple") {
  return createGame({ n, mode, playerCount: players });
}

/** Apply a move that is expected to succeed, and return its outcome. */
function play(s: GameState, player: number, lineId: number): MoveOutcome {
  const r = applyMove(s, player, lineId);
  assert.ok(r.ok, `expected move ${lineId} by p${player} to succeed`);
  return r.value;
}

function expectReject<T>(r: Result<T>, reason: string) {
  assert.ok(!r.ok, `expected rejection (${reason})`);
  assert.equal(r.reason, reason);
}

/** Fill lines directly, bypassing turn order, to set up a position. */
function preset(s: GameState, player: number, ...lineIds: number[]) {
  for (const id of lineIds) s.lines[id] = player + 1;
  s.linesPlaced += lineIds.length;
}

// --------------------------------------------------------------------- core ---

describe("setup", () => {
  it("starts empty with everything to play for", () => {
    const s = game(8, 4);
    assert.equal(s.lines.length, lineCount(8));
    assert.equal(s.boxes.length, 64);
    assert.equal(s.boxesRemaining, 64);
    assert.ok(s.boxes.every((b) => b === UNCLAIMED));
    assert.equal(s.phase, "playing");
    assert.equal(currentPlayer(s), 0);
    assert.equal(legalMoves(s).length, lineCount(8));
  });

  it("honours a supplied rotation order", () => {
    const s = createGame({ n: 4, mode: "simple", playerCount: 3, turnOrder: [2, 0, 1] });
    assert.equal(currentPlayer(s), 2);
    play(s, 2, hLineId(4, 0, 0));
    assert.equal(currentPlayer(s), 0);
  });
});

describe("placing lines", () => {
  it("passes the turn when nothing is claimed", () => {
    const s = game(4, 3);
    const out = play(s, 0, hLineId(4, 0, 0));
    assert.deepEqual(out.claimed, []);
    assert.equal(out.again, false);
    assert.equal(out.nextPlayerIndex, 1);
    assert.equal(out.nextTurnSeconds, TURN_SECONDS);
    assert.equal(s.lines[hLineId(4, 0, 0)], 1); // player index + 1
  });

  it("rejects a line that is already taken", () => {
    const s = game(4, 2);
    play(s, 0, hLineId(4, 0, 0));
    expectReject(applyMove(s, 1, hLineId(4, 0, 0)), "line-taken");
  });

  it("rejects out-of-turn and out-of-range moves", () => {
    const s = game(4, 3);
    expectReject(applyMove(s, 1, hLineId(4, 0, 0)), "not-your-turn");
    expectReject(applyMove(s, 0, -1), "bad-line");
    expectReject(applyMove(s, 0, lineCount(4)), "bad-line");
  });

  it("claims a box on the fourth side and grants another turn", () => {
    const n = 4;
    const s = game(n, 2);
    const [top, bottom, left, right] = boxLineIds(n, 0, 0);
    preset(s, 1, top, bottom, left);

    const out = play(s, 0, right);
    assert.deepEqual(out.claimed, [boxId(n, 0, 0)]);
    assert.equal(out.again, true);
    assert.equal(out.nextPlayerIndex, 0, "claimer moves again");
    assert.equal(out.continuation, true);
    assert.equal(
      out.nextTurnSeconds,
      CONTINUATION_TURN_SECONDS,
      "continuation turns run on the short clock",
    );
    assert.equal(s.scores[0], 1);
    assert.equal(s.scores[1], 0, "presetting lines must not award points");
    assert.equal(s.boxesRemaining, n * n - 1);
  });

  it("claims both boxes when one line completes a pair", () => {
    const n = 2;
    const s = game(n, 2);
    // Boxes (0,0) and (0,1) share the vertical line V[0][1].
    const shared = vLineId(n, 0, 1);
    preset(s, 0, hLineId(n, 0, 0), hLineId(n, 1, 0), vLineId(n, 0, 0));
    preset(s, 0, hLineId(n, 0, 1), hLineId(n, 1, 1), vLineId(n, 0, 2));

    const out = play(s, 0, shared);
    assert.equal(out.claimed.length, 2);
    assert.deepEqual(out.claimed.sort(), [boxId(n, 0, 0), boxId(n, 0, 1)]);
    assert.equal(s.scores[0], 2);
    assert.equal(out.again, true);
  });

  it("plays a 1x1 board to completion", () => {
    const s = game(1, 2);
    play(s, 0, 0);
    play(s, 1, 1);
    play(s, 0, 2);
    const out = play(s, 1, 3);

    assert.equal(out.gameOver, true);
    assert.equal(s.phase, "over");
    assert.equal(s.boxesRemaining, 0);
    assert.deepEqual(out.winners, [1]);
    expectReject(applyMove(s, 0, 0), "game-over");
  });

  it("ends only when every box is claimed", () => {
    const n = 3;
    const s = game(n, 2);
    let guard = 0;
    while (s.phase === "playing") {
      const moves = legalMoves(s);
      assert.ok(moves.length > 0, "a playing game must have a legal move");
      play(s, currentPlayer(s), moves[0]);
      assert.ok(++guard < 500, "runaway loop");
    }
    assert.equal(s.linesPlaced, lineCount(n));
    assert.equal(s.boxesRemaining, 0);
    assert.equal(s.scores[0] + s.scores[1], n * n);
    assert.ok(s.boxes.every((b) => b !== UNCLAIMED));
  });

  it("declares a shared victory on a tie", () => {
    const s = game(2, 2);
    s.scores[0] = 2;
    s.scores[1] = 2;
    s.boxesRemaining = 1;
    s.boxes[0] = 0;
    s.boxes[1] = 1;
    s.boxes[2] = 0;
    const [top, bottom, left, right] = boxLineIds(2, 1, 1);
    preset(s, 1, top, bottom, left);

    const out = play(s, 0, right);
    assert.equal(out.gameOver, true);
    assert.equal(s.scores[0], 3);
    assert.deepEqual(out.winners, [0]);
  });
});

// ------------------------------------------------------------- shot clock ---

describe("shot clock and parking", () => {
  it("passes the turn on a skip without parking on the first miss", () => {
    const s = game(4, 3);
    const r = skipTurn(s, 0);
    assert.ok(r.ok);
    assert.equal(r.value.benched, false);
    assert.equal(r.value.nextPlayerIndex, 1);
    assert.equal(s.missed[0], 1);
    assert.equal(s.benched[0], 0);
  });

  it(`parks a player after ${MISSED_TURNS_TO_BENCH} consecutive misses`, () => {
    const s = game(4, 3);
    skipTurn(s, 0);
    skipTurn(s, 1);
    skipTurn(s, 2);
    const r = skipTurn(s, 0);
    assert.ok(r.ok);
    assert.equal(r.value.benched, true);
    assert.equal(s.benched[0], 1);
  });

  it("resets the miss counter on any successful move", () => {
    const s = game(4, 3);
    skipTurn(s, 0);
    assert.equal(s.missed[0], 1);
    skipTurn(s, 1);
    skipTurn(s, 2);
    play(s, 0, hLineId(4, 0, 0));
    assert.equal(s.missed[0], 0, "one slow turn must never park anyone");
    assert.equal(s.benched[0], 0);
  });

  it("skips parked players in the rotation", () => {
    const s = game(4, 3);
    bench(s, 1);
    const out = play(s, 0, hLineId(4, 0, 0));
    assert.equal(out.nextPlayerIndex, 2, "parked player is passed over");
  });

  it("moves the turn on if the active player is parked mid-turn", () => {
    const s = game(4, 3);
    assert.equal(currentPlayer(s), 0);
    bench(s, 0);
    assert.equal(currentPlayer(s), 1);
  });

  it("pauses rather than ending when everyone is parked", () => {
    const s = game(4, 2);
    bench(s, 0);
    bench(s, 1);
    assert.equal(s.paused, true);
    assert.equal(s.phase, "playing", "a fully parked room must not end the game");
    expectReject(applyMove(s, 0, hLineId(4, 0, 0)), "paused");
  });

  it("resumes when a parked player taps back in", () => {
    const s = game(4, 2);
    bench(s, 0);
    bench(s, 1);
    unbench(s, 1);
    assert.equal(s.paused, false);
    assert.equal(currentPlayer(s), 1);
    assert.equal(s.missed[1], 0);
    play(s, 1, hLineId(4, 0, 0));
  });

  it("keeps score and charges through a park", () => {
    const s = game(4, 2, "twist");
    s.scores[0] = 7;
    s.charges[0] = 1;
    bench(s, 0);
    unbench(s, 0);
    assert.equal(s.scores[0], 7);
    assert.equal(s.charges[0], 1);
  });
});

// ---------------------------------------------------------------- wildcard ---

describe("wildcard", () => {
  /** A twist game where p0 already owns `owned` boxes. */
  function twistWithBoxes(owned: number): GameState {
    const s = game(8, 3, "twist");
    for (let i = 0; i < owned; i++) {
      s.boxes[i] = 0;
      s.boxesRemaining--;
    }
    s.scores[0] = owned;
    return s;
  }

  it("is unavailable in simple mode", () => {
    const s = game(8, 2);
    s.scores[0] = 50;
    expectReject(buyWildcard(s, 0), "wrong-mode");
    expectReject(armWildcard(s, 0), "wrong-mode");
  });

  it("refuses a purchase you cannot afford", () => {
    const s = twistWithBoxes(WILDCARD_COST - 1);
    expectReject(buyWildcard(s, 0), "cannot-afford");
  });

  it("burns real boxes to pay, keeping score equal to boxes owned", () => {
    const s = twistWithBoxes(WILDCARD_COST + 3);
    const r = buyWildcard(s, 0);
    assert.ok(r.ok);

    assert.equal(r.value.burned.length, WILDCARD_COST);
    assert.equal(s.charges[0], 1);
    assert.equal(s.scores[0], 3);

    const stillOwned = [...s.boxes].filter((b) => b === 0).length;
    const spent = [...s.boxes].filter((b) => b === SPENT).length;
    assert.equal(spent, WILDCARD_COST);
    assert.equal(
      stillOwned,
      s.scores[0],
      "INVARIANT: score must equal boxes visibly owned",
    );
  });

  it("does not resurrect burned boxes as claimable", () => {
    const s = twistWithBoxes(WILDCARD_COST);
    const before = s.boxesRemaining;
    assert.ok(buyWildcard(s, 0).ok);
    assert.equal(s.boxesRemaining, before, "burned boxes were already claimed");
  });

  it("caps charges", () => {
    const s = twistWithBoxes(WILDCARD_COST * (MAX_WILDCARD_CHARGES + 1));
    for (let i = 0; i < MAX_WILDCARD_CHARGES; i++) {
      assert.ok(buyWildcard(s, i === 0 ? 0 : 0).ok);
    }
    expectReject(buyWildcard(s, 0), "charges-full");
  });

  it("needs a charge to arm, and only one at a time", () => {
    const s = twistWithBoxes(WILDCARD_COST);
    expectReject(armWildcard(s, 0), "no-charges");
    assert.ok(buyWildcard(s, 0).ok);
    assert.ok(armWildcard(s, 0).ok);
    assert.equal(s.charges[0], 0);
    expectReject(armWildcard(s, 0), "already-armed");
  });

  it("fires on the move that would have ended the turn", () => {
    const s = twistWithBoxes(WILDCARD_COST);
    assert.ok(buyWildcard(s, 0).ok);
    assert.ok(armWildcard(s, 0).ok);

    const out = play(s, 0, hLineId(8, 0, 0));
    assert.equal(out.claimed.length, 0);
    assert.equal(out.wildcardFired, true);
    assert.equal(out.again, true);
    assert.equal(out.nextPlayerIndex, 0);
    assert.equal(
      out.nextTurnSeconds,
      TURN_SECONDS,
      "a rescue is not a chain, so it gets the full clock",
    );
    assert.equal(s.armed, false);

    // Spent — the next quiet move passes the turn as normal.
    const next = play(s, 0, hLineId(8, 0, 1));
    assert.equal(next.wildcardFired, false);
    assert.equal(next.nextPlayerIndex, 1);
  });

  it("is not wasted on a move that already earned a continuation", () => {
    const n = 8;
    const s = twistWithBoxes(WILDCARD_COST);
    assert.ok(buyWildcard(s, 0).ok);
    assert.ok(armWildcard(s, 0).ok);

    const target = boxLineIds(n, 4, 4);
    preset(s, 1, target[0], target[1], target[2]);

    const out = play(s, 0, target[3]);
    assert.equal(out.claimed.length, 1);
    assert.equal(out.wildcardFired, false);
    assert.equal(s.armed, true, "still armed for later in the same turn");
    assert.equal(out.nextTurnSeconds, CONTINUATION_TURN_SECONDS);

    // It fires on the next move that would end the turn.
    const rescue = play(s, 0, hLineId(n, 0, 0));
    assert.equal(rescue.wildcardFired, true);
    assert.equal(s.armed, false);
  });

  it("disarms when the turn ends", () => {
    const s = twistWithBoxes(WILDCARD_COST);
    assert.ok(buyWildcard(s, 0).ok);
    assert.ok(armWildcard(s, 0).ok);
    play(s, 0, hLineId(8, 0, 0)); // fires, p0 continues
    play(s, 0, hLineId(8, 0, 1)); // turn passes
    assert.equal(s.armed, false);
    assert.equal(currentPlayer(s), 1);
  });

  it("can only be bought or armed on your own turn", () => {
    const s = twistWithBoxes(WILDCARD_COST);
    s.scores[1] = 50;
    expectReject(buyWildcard(s, 1), "not-your-turn");
    expectReject(armWildcard(s, 1), "not-your-turn");
  });
});

// --------------------------------------------------------------- integrity ---

describe("invariants", () => {
  it("keeps scores equal to owned boxes across a whole game", () => {
    const s = game(4, 3);
    while (s.phase === "playing") {
      const moves = legalMoves(s);
      play(s, currentPlayer(s), moves[moves.length - 1]);

      for (let p = 0; p < 3; p++) {
        const owned = [...s.boxes].filter((b) => b === p).length;
        assert.equal(s.scores[p], owned, `player ${p} score drifted`);
      }
    }
    assert.deepEqual(
      [...s.boxes].filter((b) => b === UNCLAIMED),
      [],
    );
  });

  it("agrees between canPlace and legalMoves", () => {
    const s = game(3, 2);
    for (let i = 0; i < 10; i++) {
      const moves = legalMoves(s);
      for (let id = 0; id < s.lines.length; id++) {
        assert.equal(canPlace(s, id), moves.includes(id));
      }
      play(s, currentPlayer(s), moves[0]);
    }
  });
});
