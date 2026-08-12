/**
 * The wire protocol. Imported by both client and server so a change that breaks
 * one cannot compile in the other.
 *
 * Every message is `{ t: <tag>, ... }`. Timestamps crossing the wire are always
 * ABSOLUTE server epoch milliseconds, never durations — see `serverNow` below.
 */

import { PROTOCOL_VERSION } from "./constants.ts";
import type { Bounds, Mode, ShrinkOutcome } from "./rules.ts";

export { PROTOCOL_VERSION };

export type RoomPhase = "lobby" | "playing" | "results";

export interface PlayerInfo {
  /** Stable per-device id, persisted in localStorage. Survives reconnects. */
  id: string;
  name: string;
  initial: string;
  colorIndex: number;
  connected: boolean;
  benched: boolean;
  score: number;
  ready: boolean;
}

export interface SpectatorInfo {
  id: string;
  name: string;
  connected: boolean;
}

export interface RoomConfig {
  mode: Mode;
  gridSize: number;
}

/**
 * The full game state, in JSON-safe form.
 *
 * Plain number arrays rather than base64'd typed arrays: a 10x10 board is
 * ~320 numbers, and this is only sent on join and reconnect. Readable in
 * devtools beats ~600 bytes saved on a once-per-session message.
 */
export interface GameSnapshot {
  n: number;
  mode: Mode;
  lines: number[];
  boxes: number[];
  /** Prior owner of each spent box, or -1. Keeps the ash tile's grey letter. */
  formerOwner: number[];
  scores: number[];
  harvested: number[];
  charges: number[];
  benched: number[];
  missed: number[];
  turnOrder: number[];
  turnPtr: number;
  paused: boolean;
  continuation: boolean;
  armed: boolean;
  linesPlaced: number;
  boxesRemaining: number;
  rotations: number;
  turnSeq: number;
  bounds: Bounds;
  collapseAtRotation: number | null;
  phase: "playing" | "over";
  winners: number[];
}

export interface RoomSnapshot {
  code: string;
  phase: RoomPhase;
  config: RoomConfig;
  players: PlayerInfo[];
  /** Watching, not playing. Promoted to players on the next rematch. */
  spectators: SpectatorInfo[];
  hostId: string;
  game: GameSnapshot | null;
  /** Absolute epoch ms when the current turn expires. */
  turnDeadline: number | null;
}

// -------------------------------------------------------- client -> server ---

export type ClientMessage =
  | {
      t: "hello";
      protocolVersion: number;
      clientId: string;
      name: string;
      /**
       * Proves this device belongs to the owner, who always hosts. Held in
       * localStorage after being entered once; checked against a Worker secret.
       */
      ownerKey?: string;
      /**
       * Preferred player colour, as an index into `PLAYER_COLORS`. Granted if it
       * is free at join time; otherwise the player quietly gets the next open
       * one. No prompt, no error — a colour is not worth interrupting someone
       * over. Omitted or -1 means no preference.
       */
      colour?: number;
    }
  | { t: "configure"; mode?: Mode; gridSize?: number }
  | { t: "start" }
  | { t: "move"; lineId: number; turnSeq: number }
  /** Twist mode: spend points on a Wildcard charge. */
  | { t: "buy" }
  /** Twist mode: arm a held charge for this turn. */
  | { t: "arm" }
  | { t: "rematch" }
  | { t: "wake" }
  | { t: "ping"; t0: number };

// -------------------------------------------------------- server -> client ---

export interface TurnInfo {
  nextPlayerIndex: number;
  /** Absolute epoch ms. Null when the game is over or the room is paused. */
  turnDeadline: number | null;
  turnSeq: number;
}

export type ServerMessage =
  | {
      t: "welcome";
      you: string;
      /** Server clock at send time, so the client can estimate its offset. */
      serverNow: number;
      room: RoomSnapshot;
      /**
       * Whether the `ownerKey` sent with `hello` was actually accepted.
       *
       * ⚠️ **The client cannot work this out for itself, and used to pretend it
       * could.** Settings saved whatever string was typed and immediately
       * announced "This device hosts every room" — for any string, including a
       * wrong one. The SERVER was never fooled (`isOwnerKey` compares against
       * the Worker secret and a wrong key grants nothing), but the person
       * typing it was: they were told they were the owner and were not.
       *
       * `false` here means either no key was sent, or the one sent was wrong.
       * The client tells the two apart by whether it holds a key at all.
       */
      ownerAccepted: boolean;
    }
  | { t: "room"; room: RoomSnapshot; serverNow: number }
  | {
      t: "move";
      playerIndex: number;
      lineId: number;
      claimed: number[];
      scores: number[];
      again: boolean;
      wildcardFired: boolean;
      /**
       * The shot clock expired and the server placed this line for them
       * (§6.3.1). A timeout is a `move` and not a `skip` on purpose: the client
       * already replays `move` through the same `applyMove` the server ran, so
       * an auto-move needs no new replay path — only this flag, so the client
       * can replay it as a miss and say what happened.
       */
      auto: boolean;
      /** The auto-move above was the miss that parked them. */
      benched: boolean;
      gameOver: boolean;
      winners: number[];
      /** Non-null when this move's turn advance collapsed the outer ring. */
      shrink: ShrinkOutcome | null;
      serverNow: number;
      turn: TurnInfo;
    }
  | {
      t: "skip";
      playerIndex: number;
      /**
       * Which path parked them. `timeout` replays as `skipTurn` (advances the
       * miss counter and the turn sequence); `disconnect` replays as `bench`
       * (does neither). Explicit, because inferring it from the sequence number
       * is fragile.
       *
       * `timeout` is now the rare one: an expired clock normally arrives as a
       * `move` with `auto` set, and only a board with no legal move left — which
       * should not be reachable while the game is running — falls back to here.
       */
      reason: "timeout" | "disconnect";
      benched: boolean;
      paused: boolean;
      gameOver: boolean;
      winners: number[];
      shrink: ShrinkOutcome | null;
      serverNow: number;
      turn: TurnInfo;
    }
  | {
      t: "wildcard";
      playerIndex: number;
      action: "bought" | "armed";
      /** Boxes burned to pay. Empty when arming. */
      burned: number[];
      charges: number;
      scores: number[];
    }
  | { t: "pong"; t0: number; serverNow: number }
  | { t: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  /**
   * The move arrived describing a turn that has already ended — the shot clock
   * beat you to it, or the socket dropped and reconnected around it.
   *
   * This MUST be answered rather than dropped. The client is holding a pending
   * line and refusing further input until it hears something back, so silence
   * here locks that player out of the rest of the game.
   */
  | "stale"
  | "bad-protocol"
  | "room-full"
  | "spectators-full"
  | "in-progress"
  | "not-host"
  | "not-enough-players"
  | "board-too-big"
  | "not-ready"
  | "rejected"
  | "wildcard"
  | "unknown-message";

// ------------------------------------------------------------------ helpers ---

export function encode(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg);
}

/** Parse without trusting the input. Returns null on anything malformed. */
export function decode<T extends { t: string }>(raw: unknown): T | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { t?: unknown }).t === "string"
    ) {
      return parsed as T;
    }
    return null;
  } catch {
    return null;
  }
}
