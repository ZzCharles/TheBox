/**
 * The wire protocol. Imported by both client and server so a change that breaks
 * one cannot compile in the other.
 *
 * Every message is `{ t: <tag>, ... }`. Timestamps crossing the wire are always
 * ABSOLUTE server epoch milliseconds, never durations — see `serverNow` below.
 */

import { PROTOCOL_VERSION } from "./constants.ts";
import type { Mode } from "./rules.ts";

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
  scores: number[];
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
  | { t: "hello"; protocolVersion: number; clientId: string; name: string }
  | { t: "ready"; ready: boolean }
  | { t: "configure"; mode?: Mode; gridSize?: number }
  | { t: "start" }
  | { t: "move"; lineId: number; turnSeq: number }
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
    }
  | { t: "room"; room: RoomSnapshot; serverNow: number }
  | {
      t: "move";
      playerIndex: number;
      lineId: number;
      claimed: number[];
      scores: number[];
      again: boolean;
      gameOver: boolean;
      winners: number[];
      serverNow: number;
      turn: TurnInfo;
    }
  | {
      t: "skip";
      playerIndex: number;
      benched: boolean;
      paused: boolean;
      serverNow: number;
      turn: TurnInfo;
    }
  | { t: "pong"; t0: number; serverNow: number }
  | { t: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  | "bad-protocol"
  | "room-full"
  | "spectators-full"
  | "in-progress"
  | "not-host"
  | "not-enough-players"
  | "not-ready"
  | "rejected"
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
