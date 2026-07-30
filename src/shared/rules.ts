/**
 * The rules engine. PURE — imports only sibling shared modules, touches no I/O,
 * no DOM, no Workers APIs, no clock, no randomness.
 *
 * The server runs this to be authoritative. The client runs THE SAME FILE to
 * predict moves and grey out illegal taps. If behaviour diverges between them,
 * the bug is in the plumbing, not in here.
 *
 * Functions mutate the state they are given and return a description of what
 * happened. Callers that need history should snapshot before calling.
 */

import {
  CONTINUATION_TURN_SECONDS,
  MAX_WILDCARD_CHARGES,
  MISSED_TURNS_TO_BENCH,
  SHRINK_INTERVAL_ROTATIONS,
  TURN_SECONDS,
  WILDCARD_COST,
  shrinkArmFraction,
} from "./constants.ts";
import {
  boxCol,
  boxId,
  boxLineIds,
  boxRow,
  isValidLineId,
  lineBoxes,
  lineCount,
} from "./board.ts";

// ------------------------------------------------------------------ types ---

export type Mode = "simple" | "twist";

/** Sentinel owners for `GameState.boxes`. Non-negative values are player indices. */
export const UNCLAIMED = -1;
/** Claimed, then burned to pay for a Wildcard. Counts for nobody. */
export const SPENT = -2;
/** Removed by the shrinking board. Not playable, worth nothing. */
export const DEAD = -3;

/** Inclusive box coordinates of the still-playable area. Shrinks in twist mode. */
export interface Bounds {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export interface GameState {
  mode: Mode;
  /** Box grid is n x n. */
  n: number;

  /** Per line: 0 = empty, otherwise owning player index + 1. */
  lines: Uint8Array;
  /** Per box: UNCLAIMED | SPENT | DEAD | player index. */
  boxes: Int8Array;

  scores: Int32Array;
  /**
   * Boxes taken off the board early by a shrink, per player. They already flew
   * to the scoreboard, so they must not fly again in the endgame.
   *
   * INVARIANT: `scores[p] === (boxes on the board owned by p) + harvested[p]`.
   */
  harvested: Int32Array;
  /** Wildcard charges held, per player. */
  charges: Uint8Array;
  /** 1 = parked. Skipped in rotation, keeps score and charges. */
  benched: Uint8Array;
  /** Consecutive missed shot clocks, per player. Resets on any successful move. */
  missed: Uint8Array;

  /** Player indices in rotation order, shuffled once at match start. */
  turnOrder: Int32Array;
  /** Index into `turnOrder`. */
  turnPtr: number;
  /** True when every player is parked — the server stops the clock. */
  paused: boolean;

  /** Current turn came from claiming a box, so it runs on the short clock. */
  continuation: boolean;
  /** A Wildcard is armed for the current player's turn. */
  armed: boolean;

  linesPlaced: number;
  boxesRemaining: number;
  rotations: number;
  turnSeq: number;

  /** Playable area. Full board in simple mode; contracts in twist mode. */
  bounds: Bounds;
  /**
   * Rotation index at which the outer ring collapses. `null` before the
   * shrinking board arms. Players get one full rotation of warning, so the ring
   * pulses red from `collapseAtRotation - 1`.
   */
  collapseAtRotation: number | null;

  phase: "playing" | "over";
  /** Populated when phase becomes "over". More than one index means a tie. */
  winners: number[];
}

export type RejectReason =
  | "game-over"
  | "paused"
  | "not-your-turn"
  | "bad-line"
  | "line-taken"
  | "dead-line"
  | "wrong-mode"
  | "cannot-afford"
  | "charges-full"
  | "no-charges"
  | "already-armed";

export interface ShrinkOutcome {
  /** Every box removed from play, claimed or not. */
  removedBoxes: number[];
  /** Claimed boxes that flew to their owner. Their points are kept. */
  harvested: Array<{ box: number; owner: number }>;
  /** Placed lines cleared because they no longer border a live box. */
  removedLines: number[];
  bounds: Bounds;
}

export interface MoveOutcome {
  playerIndex: number;
  lineId: number;
  /** Box ids claimed by this line. A single line can claim two. */
  claimed: number[];
  /** The same player moves again. */
  again: boolean;
  /** The Wildcard fired to prevent the turn ending. */
  wildcardFired: boolean;
  nextPlayerIndex: number;
  /** Whether the next turn runs on the short clock. */
  continuation: boolean;
  nextTurnSeconds: number;
  gameOver: boolean;
  winners: number[];
  /** Set when this move's turn advance triggered a ring collapse. */
  shrink: ShrinkOutcome | null;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: RejectReason };

const reject = (reason: RejectReason): { ok: false; reason: RejectReason } => ({
  ok: false,
  reason,
});

// --------------------------------------------------------------- creation ---

export function createGame(opts: {
  n: number;
  mode: Mode;
  playerCount: number;
  /** Rotation order. Caller shuffles — this module stays deterministic. */
  turnOrder?: number[];
}): GameState {
  const { n, mode, playerCount } = opts;
  const order = opts.turnOrder ?? Array.from({ length: playerCount }, (_, i) => i);

  return {
    mode,
    n,
    lines: new Uint8Array(lineCount(n)),
    boxes: new Int8Array(n * n).fill(UNCLAIMED),
    scores: new Int32Array(playerCount),
    harvested: new Int32Array(playerCount),
    charges: new Uint8Array(playerCount),
    benched: new Uint8Array(playerCount),
    missed: new Uint8Array(playerCount),
    turnOrder: Int32Array.from(order),
    turnPtr: 0,
    paused: false,
    continuation: false,
    armed: false,
    linesPlaced: 0,
    boxesRemaining: n * n,
    rotations: 0,
    turnSeq: 0,
    bounds: { r0: 0, c0: 0, r1: n - 1, c1: n - 1 },
    collapseAtRotation: null,
    phase: "playing",
    winners: [],
  };
}

// ---------------------------------------------------------------- queries ---

export function currentPlayer(s: GameState): number {
  return s.turnOrder[s.turnPtr];
}

export function turnSecondsFor(s: GameState): number {
  return s.continuation ? CONTINUATION_TURN_SECONDS : TURN_SECONDS;
}

export function playerCount(s: GameState): number {
  return s.scores.length;
}

/** A line is playable if it is empty and borders at least one live box. */
export function canPlace(s: GameState, lineId: number): boolean {
  if (s.phase !== "playing" || s.paused) return false;
  if (!isValidLineId(s.n, lineId)) return false;
  if (s.lines[lineId] !== 0) return false;
  return !isDeadLine(s, lineId);
}

function isDeadLine(s: GameState, lineId: number): boolean {
  const [a, b] = lineBoxes(s.n, lineId);
  const aLive = a >= 0 && s.boxes[a] !== DEAD;
  const bLive = b >= 0 && s.boxes[b] !== DEAD;
  return !aLive && !bLive;
}

/** Every empty, playable line. Used by the client to render tap targets. */
export function legalMoves(s: GameState): number[] {
  const out: number[] = [];
  for (let id = 0; id < s.lines.length; id++) {
    if (canPlace(s, id)) out.push(id);
  }
  return out;
}

function isComplete(s: GameState, box: number): boolean {
  const n = s.n;
  const [t, b, l, r] = boxLineIds(n, boxRow(n, box), boxCol(n, box));
  return (
    s.lines[t] !== 0 && s.lines[b] !== 0 && s.lines[l] !== 0 && s.lines[r] !== 0
  );
}

// ------------------------------------------------------------ turn moving ---

/**
 * Advance `turnPtr` to the next player who isn't parked.
 * Sets `paused` if nobody is available.
 */
function advanceTurn(s: GameState): void {
  // An armed Wildcard that never fired is refunded rather than lost. Reaching
  // here still armed means the turn ended without a placement — a timeout or a
  // park — so the player never got to use what they paid 10 boxes for.
  //
  // applyMove always clears `armed` before advancing (it either fires, or the
  // player claimed a box and keeps the turn), so this cannot double-refund.
  if (s.armed) {
    s.charges[currentPlayer(s)]++;
    s.armed = false;
  }

  const len = s.turnOrder.length;
  for (let step = 1; step <= len; step++) {
    const ptr = (s.turnPtr + step) % len;
    if (!s.benched[s.turnOrder[ptr]]) {
      if (ptr <= s.turnPtr) s.rotations++;
      s.turnPtr = ptr;
      s.paused = false;
      s.continuation = false;
      s.armed = false;
      return;
    }
  }
  // Everyone is parked. Hold position; the server stops the clock and waits.
  s.paused = true;
  s.continuation = false;
  s.armed = false;
}

/** Called when a parked player taps back in and the match was paused. */
export function resume(s: GameState): boolean {
  if (!s.paused) return false;
  const len = s.turnOrder.length;
  for (let step = 0; step < len; step++) {
    const ptr = (s.turnPtr + step) % len;
    if (!s.benched[s.turnOrder[ptr]]) {
      s.turnPtr = ptr;
      s.paused = false;
      s.continuation = false;
      return true;
    }
  }
  return false;
}

// --------------------------------------------------------- shrinking board ---

/** Box ids on the perimeter of the current playable area, still alive. */
export function ringBoxes(s: GameState): number[] {
  const { r0, c0, r1, c1 } = s.bounds;
  if (r0 > r1 || c0 > c1) return [];

  const out: number[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const onEdge = r === r0 || r === r1 || c === c0 || c === c1;
      if (!onEdge) continue;
      const id = boxId(s.n, r, c);
      if (s.boxes[id] !== DEAD) out.push(id);
    }
  }
  return out;
}

/**
 * True while the outer ring is one rotation from collapsing. The UI must pulse
 * these boxes red — collapsing without warning is unfair and the whole
 * mechanic depends on players being able to react.
 */
export function isShrinkWarning(s: GameState): boolean {
  return (
    s.phase === "playing" &&
    s.collapseAtRotation !== null &&
    s.rotations >= s.collapseAtRotation - 1
  );
}

/** Arm the shrinking board once enough of the board is committed. */
function maybeArmShrink(s: GameState): void {
  if (s.mode !== "twist" || s.collapseAtRotation !== null) return;
  const fraction = s.linesPlaced / lineCount(s.n);
  if (fraction < shrinkArmFraction(playerCount(s))) return;
  // +1 so the first collapse is preceded by a full rotation of warning.
  s.collapseAtRotation = s.rotations + 1;
}

/** Collapse the outer ring if this rotation is the one. */
function maybeCollapse(s: GameState): ShrinkOutcome | null {
  if (s.mode !== "twist" || s.collapseAtRotation === null) return null;
  if (s.phase !== "playing") return null;
  if (s.rotations < s.collapseAtRotation) return null;

  const ring = ringBoxes(s);
  const removedBoxes: number[] = [];
  const harvested: Array<{ box: number; owner: number }> = [];

  for (const box of ring) {
    const owner = s.boxes[box];
    if (owner >= 0) {
      // Already earned. The point stands and the tile flies to its owner now
      // instead of at the end.
      s.harvested[owner]++;
      harvested.push({ box, owner });
    } else if (owner === UNCLAIMED) {
      // Never claimed by anyone, and now never can be.
      s.boxesRemaining--;
    }
    // SPENT tiles were already burned to buy a Wildcard; they count for nobody
    // either way, so they just disappear.
    s.boxes[box] = DEAD;
    removedBoxes.push(box);
  }

  s.bounds = {
    r0: s.bounds.r0 + 1,
    c0: s.bounds.c0 + 1,
    r1: s.bounds.r1 - 1,
    c1: s.bounds.c1 - 1,
  };

  // Clear placed lines that no longer border anything live, so the board
  // visibly contracts rather than leaving a fringe behind.
  const removedLines: number[] = [];
  for (let id = 0; id < s.lines.length; id++) {
    if (s.lines[id] === 0) continue;
    if (!isDeadLine(s, id)) continue;
    s.lines[id] = 0;
    s.linesPlaced--;
    removedLines.push(id);
  }

  s.collapseAtRotation = s.rotations + SHRINK_INTERVAL_ROTATIONS;

  return { removedBoxes, harvested, removedLines, bounds: { ...s.bounds } };
}

/** Arm, then collapse if due. Called after every turn advance. */
function checkShrink(s: GameState): ShrinkOutcome | null {
  maybeArmShrink(s);
  return maybeCollapse(s);
}

// ------------------------------------------------------------------ moves ---

export function applyMove(
  s: GameState,
  playerIndex: number,
  lineId: number,
): Result<MoveOutcome> {
  if (s.phase !== "playing") return reject("game-over");
  if (s.paused) return reject("paused");
  if (playerIndex !== currentPlayer(s)) return reject("not-your-turn");
  if (!isValidLineId(s.n, lineId)) return reject("bad-line");
  if (s.lines[lineId] !== 0) return reject("line-taken");
  if (isDeadLine(s, lineId)) return reject("dead-line");

  s.lines[lineId] = playerIndex + 1;
  s.linesPlaced++;
  s.turnSeq++;
  s.missed[playerIndex] = 0;

  // A single line can complete the box on either side of it.
  const claimed: number[] = [];
  const [boxA, boxB] = lineBoxes(s.n, lineId);
  for (const box of [boxA, boxB]) {
    if (box < 0) continue;
    if (s.boxes[box] !== UNCLAIMED) continue;
    if (!isComplete(s, box)) continue;
    s.boxes[box] = playerIndex;
    s.scores[playerIndex]++;
    s.boxesRemaining--;
    claimed.push(box);
  }

  let again = claimed.length > 0;
  let wildcardFired = false;

  // The Wildcard fires exactly when the turn would otherwise end, so arming it
  // is never wasted on a move that already earned a continuation.
  if (!again && s.armed) {
    s.armed = false;
    wildcardFired = true;
    again = true;
  }

  let shrink: ShrinkOutcome | null = null;
  if (s.boxesRemaining > 0) {
    if (again) {
      // A claim earns the short clock. A Wildcard rescue does not — you didn't
      // claim anything, so you may genuinely need the think time.
      s.continuation = claimed.length > 0;
    } else {
      advanceTurn(s);
      // Only a turn advance moves the rotation count, so this is the only place
      // a collapse can become due.
      shrink = checkShrink(s);
    }
  }

  // A collapse can destroy the last unclaimed boxes, so test after shrinking.
  const gameOver = s.boxesRemaining === 0;
  if (gameOver) {
    s.phase = "over";
    s.winners = computeWinners(s);
  }

  return {
    ok: true,
    value: {
      playerIndex,
      lineId,
      claimed,
      again,
      wildcardFired,
      nextPlayerIndex: gameOver ? -1 : currentPlayer(s),
      continuation: s.continuation,
      nextTurnSeconds: turnSecondsFor(s),
      gameOver,
      winners: s.winners.slice(),
      shrink,
    },
  };
}

export interface SkipOutcome {
  playerIndex: number;
  benched: boolean;
  nextPlayerIndex: number;
  nextTurnSeconds: number;
  paused: boolean;
  shrink: ShrinkOutcome | null;
  gameOver: boolean;
  winners: number[];
}

/** Shot clock expired. Never removes the player — parks them at the threshold. */
export function skipTurn(s: GameState, playerIndex: number): Result<SkipOutcome> {
  if (s.phase !== "playing") return reject("game-over");
  if (playerIndex !== currentPlayer(s)) return reject("not-your-turn");

  s.missed[playerIndex]++;
  s.turnSeq++;
  const benched = s.missed[playerIndex] >= MISSED_TURNS_TO_BENCH;
  if (benched) s.benched[playerIndex] = 1;

  advanceTurn(s);
  const shrink = checkShrink(s);

  // Nobody moving still burns rotations, so a timeout can collapse the ring
  // that ends the game.
  const gameOver = s.boxesRemaining === 0;
  if (gameOver) {
    s.phase = "over";
    s.winners = computeWinners(s);
  }

  return {
    ok: true,
    value: {
      playerIndex,
      benched,
      nextPlayerIndex: s.paused || gameOver ? -1 : currentPlayer(s),
      nextTurnSeconds: turnSecondsFor(s),
      paused: s.paused,
      shrink,
      gameOver,
      winners: s.winners.slice(),
    },
  };
}

// ---------------------------------------------------------------- benching ---

/** Park a player (disconnect grace expired). Score and charges are kept. */
export function bench(s: GameState, playerIndex: number): void {
  if (s.benched[playerIndex]) return;
  s.benched[playerIndex] = 1;
  if (s.phase === "playing" && currentPlayer(s) === playerIndex) advanceTurn(s);
}

/** They tapped back in. Active from the next rotation. */
export function unbench(s: GameState, playerIndex: number): void {
  if (!s.benched[playerIndex]) return;
  s.benched[playerIndex] = 0;
  s.missed[playerIndex] = 0;
  if (s.paused) resume(s);
}

// ---------------------------------------------------------------- wildcard ---

export interface BuyOutcome {
  playerIndex: number;
  cost: number;
  /** Boxes burned to pay, furthest from centre first. */
  burned: number[];
  charges: number;
  score: number;
}

/**
 * Buy a Wildcard for `WILDCARD_COST` points.
 *
 * Paying BURNS that many of your claimed boxes rather than just decrementing a
 * counter. This keeps `score === boxes you visibly own` true, which the entire
 * endgame flight animation depends on.
 */
export function buyWildcard(
  s: GameState,
  playerIndex: number,
): Result<BuyOutcome> {
  if (s.mode !== "twist") return reject("wrong-mode");
  if (s.phase !== "playing") return reject("game-over");
  if (playerIndex !== currentPlayer(s)) return reject("not-your-turn");
  if (s.charges[playerIndex] >= MAX_WILDCARD_CHARGES) return reject("charges-full");
  if (s.scores[playerIndex] < WILDCARD_COST) return reject("cannot-afford");

  const burned = ownedBoxesFurthestFirst(s, playerIndex).slice(0, WILDCARD_COST);
  for (const box of burned) {
    s.boxes[box] = SPENT;
    s.scores[playerIndex]--;
  }
  s.charges[playerIndex]++;

  return {
    ok: true,
    value: {
      playerIndex,
      cost: WILDCARD_COST,
      burned,
      charges: s.charges[playerIndex],
      score: s.scores[playerIndex],
    },
  };
}

/**
 * Spend a charge to arm the Wildcard for this turn. It fires automatically on
 * the first placement that would otherwise end the turn.
 */
export function armWildcard(s: GameState, playerIndex: number): Result<number> {
  if (s.mode !== "twist") return reject("wrong-mode");
  if (s.phase !== "playing") return reject("game-over");
  if (playerIndex !== currentPlayer(s)) return reject("not-your-turn");
  if (s.armed) return reject("already-armed");
  if (s.charges[playerIndex] <= 0) return reject("no-charges");

  s.charges[playerIndex]--;
  s.armed = true;
  return { ok: true, value: s.charges[playerIndex] };
}

/** Boxes owned by a player, ordered by distance from board centre, descending. */
function ownedBoxesFurthestFirst(s: GameState, playerIndex: number): number[] {
  const n = s.n;
  const mid = (n - 1) / 2;
  const owned: number[] = [];
  for (let box = 0; box < s.boxes.length; box++) {
    if (s.boxes[box] === playerIndex) owned.push(box);
  }
  const dist = (box: number) => {
    const dr = boxRow(n, box) - mid;
    const dc = boxCol(n, box) - mid;
    return dr * dr + dc * dc;
  };
  // Tie-break on id so the result is deterministic across client and server.
  return owned.sort((a, b) => dist(b) - dist(a) || a - b);
}

// ------------------------------------------------------------------ ending ---

/** Highest score wins. Ties share the victory — there is no tiebreaker round. */
export function computeWinners(s: GameState): number[] {
  let best = -Infinity;
  for (let p = 0; p < s.scores.length; p++) {
    if (s.scores[p] > best) best = s.scores[p];
  }
  const winners: number[] = [];
  for (let p = 0; p < s.scores.length; p++) {
    if (s.scores[p] === best) winners.push(p);
  }
  return winners;
}
