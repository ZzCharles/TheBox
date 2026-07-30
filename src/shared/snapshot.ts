/**
 * Conversion between the live `GameState` (typed arrays, fast) and the
 * JSON-safe `GameSnapshot` that crosses the wire and sits in Durable Object
 * storage.
 *
 * Pure. Round-tripping must be lossless — there is a test for exactly that.
 */

import type { GameSnapshot } from "./protocol.ts";
import type { GameState } from "./rules.ts";

export function toSnapshot(s: GameState): GameSnapshot {
  return {
    n: s.n,
    mode: s.mode,
    lines: Array.from(s.lines),
    boxes: Array.from(s.boxes),
    scores: Array.from(s.scores),
    harvested: Array.from(s.harvested),
    charges: Array.from(s.charges),
    benched: Array.from(s.benched),
    missed: Array.from(s.missed),
    turnOrder: Array.from(s.turnOrder),
    turnPtr: s.turnPtr,
    paused: s.paused,
    continuation: s.continuation,
    armed: s.armed,
    linesPlaced: s.linesPlaced,
    boxesRemaining: s.boxesRemaining,
    rotations: s.rotations,
    turnSeq: s.turnSeq,
    bounds: { ...s.bounds },
    collapseAtRotation: s.collapseAtRotation,
    phase: s.phase,
    winners: [...s.winners],
  };
}

export function fromSnapshot(snap: GameSnapshot): GameState {
  return {
    n: snap.n,
    mode: snap.mode,
    lines: Uint8Array.from(snap.lines),
    boxes: Int8Array.from(snap.boxes),
    scores: Int32Array.from(snap.scores),
    harvested: Int32Array.from(snap.harvested),
    charges: Uint8Array.from(snap.charges),
    benched: Uint8Array.from(snap.benched),
    missed: Uint8Array.from(snap.missed),
    turnOrder: Int32Array.from(snap.turnOrder),
    turnPtr: snap.turnPtr,
    paused: snap.paused,
    continuation: snap.continuation,
    armed: snap.armed,
    linesPlaced: snap.linesPlaced,
    boxesRemaining: snap.boxesRemaining,
    rotations: snap.rotations,
    turnSeq: snap.turnSeq,
    bounds: { ...snap.bounds },
    collapseAtRotation: snap.collapseAtRotation,
    phase: snap.phase,
    winners: [...snap.winners],
  };
}
