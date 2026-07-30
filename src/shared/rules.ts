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
  TURN_SECONDS,
  WILDCARD_COST,
} from "./constants.ts";
import {
  boxCol,
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

export interface GameState {
  mode: Mode;
  /** Box grid is n x n. */
  n: number;

  /** Per line: 0 = empty, otherwise owning player index + 1. */
  lines: Uint8Array;
  /** Per box: UNCLAIMED | SPENT | DEAD | player index. */
  boxes: Int8Array;

  scores: Int32Array;
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

  const gameOver = s.boxesRemaining === 0;
  if (gameOver) {
    s.phase = "over";
    s.winners = computeWinners(s);
  } else if (again) {
    // A claim earns the short clock. A Wildcard rescue does not — you didn't
    // claim anything, so you may genuinely need the think time.
    s.continuation = claimed.length > 0;
  } else {
    advanceTurn(s);
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
    },
  };
}

export interface SkipOutcome {
  playerIndex: number;
  benched: boolean;
  nextPlayerIndex: number;
  nextTurnSeconds: number;
  paused: boolean;
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

  return {
    ok: true,
    value: {
      playerIndex,
      benched,
      nextPlayerIndex: s.paused ? -1 : currentPlayer(s),
      nextTurnSeconds: turnSecondsFor(s),
      paused: s.paused,
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
