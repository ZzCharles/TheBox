import { Server, type Connection } from "partyserver";

import {
  ANIMATION_GRACE_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PROTOCOL_VERSION,
  gridSizeFor,
} from "../shared/constants.ts";
import {
  decode,
  encode,
  type ClientMessage,
  type ErrorCode,
  type PlayerInfo,
  type RoomConfig,
  type RoomPhase,
  type RoomSnapshot,
  type ServerMessage,
  type TurnInfo,
} from "../shared/protocol.ts";
import {
  applyMove,
  createGame,
  currentPlayer,
  skipTurn,
  turnSecondsFor,
  unbench,
  type GameState,
} from "../shared/rules.ts";
import { fromSnapshot, toSnapshot } from "../shared/snapshot.ts";
import type { GameSnapshot } from "../shared/protocol.ts";

const INITIALS = "ABCDEFGH";
const STORAGE_KEY = "room";

interface StoredPlayer {
  id: string;
  name: string;
  initial: string;
  colorIndex: number;
  connected: boolean;
  ready: boolean;
}

interface RoomState {
  claimed: boolean;
  phase: RoomPhase;
  config: RoomConfig;
  players: StoredPlayer[];
  hostId: string | null;
  game: GameSnapshot | null;
  turnDeadline: number | null;
}

interface ConnState {
  clientId: string;
}

/**
 * One Durable Object per lobby. Authoritative for everything: turn order, move
 * legality, scores, and the shot clock.
 *
 * Clients send intents and render what comes back. They never send state.
 *
 * State lives in `this.room` while awake and is mirrored to DO storage after
 * every mutation, so hibernation (or eviction) loses nothing. Every handler
 * calls `load()` first rather than trusting that `onStart` ran in this
 * incarnation.
 */
export class GameRoom extends Server<Env> {
  /** Idle lobbies cost nothing while hibernating, but keep their sockets open. */
  static override options = { hibernate: true };

  private room: RoomState | null = null;

  // ------------------------------------------------------------ lifecycle ---

  private async load(): Promise<RoomState> {
    if (this.room) return this.room;
    const stored = await this.ctx.storage.get<RoomState>(STORAGE_KEY);
    this.room = stored ?? {
      claimed: false,
      phase: "lobby",
      config: { mode: "simple", gridSize: 0 },
      players: [],
      hostId: null,
      game: null,
      turnDeadline: null,
    };
    return this.room;
  }

  private async save(): Promise<void> {
    if (this.room) await this.ctx.storage.put(STORAGE_KEY, this.room);
  }

  override async onStart() {
    await this.load();
  }

  /**
   * RPC used by room creation: returns false if this code is already in use, so
   * the caller can generate another rather than dropping a group into a
   * stranger's lobby.
   */
  async claim(): Promise<boolean> {
    const room = await this.load();
    if (room.claimed) return false;
    room.claimed = true;
    await this.save();
    return true;
  }

  /** Whether this room exists, for validating a join code before connecting. */
  async exists(): Promise<boolean> {
    return (await this.load()).claimed;
  }

  // ---------------------------------------------------------- connections ---

  override async onMessage(connection: Connection, raw: string | ArrayBuffer) {
    const msg = decode<ClientMessage>(raw);
    if (!msg) return;
    const room = await this.load();

    switch (msg.t) {
      case "hello":
        await this.onHello(connection, room, msg);
        return;
      case "ping":
        this.send(connection, { t: "pong", t0: msg.t0, serverNow: Date.now() });
        return;
      case "ready":
        await this.onReady(connection, room, msg.ready);
        return;
      case "configure":
        await this.onConfigure(connection, room, msg);
        return;
      case "start":
        await this.onStartGame(connection, room);
        return;
      case "move":
        await this.onMove(connection, room, msg.lineId, msg.turnSeq);
        return;
      case "wake":
        await this.onWake(connection, room);
        return;
      case "rematch":
        await this.onRematch(connection, room);
        return;
      default:
        this.fail(connection, "unknown-message", "Unrecognised message");
    }
  }

  override async onClose(connection: Connection) {
    const room = await this.load();
    const clientId = (connection.state as ConnState | null)?.clientId;
    if (!clientId) return;

    const player = room.players.find((p) => p.id === clientId);
    if (!player) return;
    player.connected = false;

    // Hand the host role to someone who is actually here.
    if (room.hostId === clientId) {
      room.hostId = room.players.find((p) => p.connected)?.id ?? room.hostId;
    }
    // An empty lobby that never started is not worth keeping.
    if (room.phase === "lobby" && room.players.every((p) => !p.connected)) {
      room.players = [];
      room.hostId = null;
    }

    await this.save();
    this.broadcastRoom();
  }

  private async onHello(
    connection: Connection,
    room: RoomState,
    msg: Extract<ClientMessage, { t: "hello" }>,
  ) {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      this.fail(connection, "bad-protocol", "Refresh to update the game");
      return;
    }

    const name = sanitiseName(msg.name);
    let player = room.players.find((p) => p.id === msg.clientId);

    if (!player) {
      // Joining mid-game becomes spectating in M4; for now it is refused.
      if (room.phase !== "lobby") {
        this.fail(connection, "in-progress", "That game has already started");
        return;
      }
      if (room.players.length >= MAX_PLAYERS) {
        this.fail(connection, "room-full", "That lobby is full");
        return;
      }
      player = {
        id: msg.clientId,
        name,
        initial: INITIALS[room.players.length] ?? "?",
        colorIndex: room.players.length,
        connected: true,
        ready: false,
      };
      room.players.push(player);
    } else {
      // Reconnect: keep the slot, colour and score.
      player.connected = true;
      player.name = name;
    }

    room.hostId ??= player.id;
    // Connection state is stored as a hibernation attachment, so the
    // connection -> player mapping survives the DO going to sleep.
    (connection as Connection<ConnState>).setState({ clientId: player.id });

    await this.save();
    this.send(connection, {
      t: "welcome",
      you: player.id,
      serverNow: Date.now(),
      room: this.snapshot(room),
    });
    this.broadcastRoom(connection.id);
  }

  private async onReady(connection: Connection, room: RoomState, ready: boolean) {
    const player = this.playerFor(connection, room);
    if (!player || room.phase !== "lobby") return;
    player.ready = ready;
    await this.save();
    this.broadcastRoom();
  }

  private async onConfigure(
    connection: Connection,
    room: RoomState,
    msg: Extract<ClientMessage, { t: "configure" }>,
  ) {
    const player = this.playerFor(connection, room);
    if (!player) return;
    if (room.hostId !== player.id) {
      this.fail(connection, "not-host", "Only the host can change settings");
      return;
    }
    if (room.phase !== "lobby") return;

    if (msg.mode) room.config.mode = msg.mode;
    if (typeof msg.gridSize === "number") {
      room.config.gridSize = Math.max(0, Math.min(12, Math.floor(msg.gridSize)));
    }
    await this.save();
    this.broadcastRoom();
  }

  // ----------------------------------------------------------- match flow ---

  private async onStartGame(connection: Connection, room: RoomState) {
    const player = this.playerFor(connection, room);
    if (!player) return;
    if (room.hostId !== player.id) {
      this.fail(connection, "not-host", "Only the host can start");
      return;
    }
    if (room.phase !== "lobby") return;

    const present = room.players.filter((p) => p.connected);
    if (present.length < MIN_PLAYERS) {
      this.fail(connection, "not-enough-players", `Need at least ${MIN_PLAYERS} players`);
      return;
    }
    if (!present.every((p) => p.ready)) {
      this.fail(connection, "not-ready", "Everyone needs to be ready");
      return;
    }

    // The roster locks here. Anyone who joins from now on spectates (M4).
    room.players = present;
    room.players.forEach((p, i) => {
      p.initial = INITIALS[i] ?? "?";
      p.colorIndex = i;
      p.ready = false;
    });

    const n = room.config.gridSize || gridSizeFor(room.players.length);
    const state = createGame({
      n,
      mode: room.config.mode,
      playerCount: room.players.length,
      turnOrder: shuffled(room.players.length),
    });

    room.config.gridSize = n;
    room.game = toSnapshot(state);
    room.phase = "playing";
    await this.scheduleTurn(room, state);
    await this.save();
    this.broadcastRoom();
  }

  private async onMove(
    connection: Connection,
    room: RoomState,
    lineId: number,
    turnSeq: number,
  ) {
    const player = this.playerFor(connection, room);
    if (!player || !room.game || room.phase !== "playing") return;

    const state = fromSnapshot(room.game);

    // Idempotency: a retry after a flaky connection must not place two lines.
    if (turnSeq !== state.turnSeq) return;

    const index = room.players.indexOf(player);
    const result = applyMove(state, index, lineId);
    if (!result.ok) {
      this.fail(connection, "rejected", result.reason);
      return;
    }

    const outcome = result.value;
    room.game = toSnapshot(state);
    if (outcome.gameOver) {
      room.phase = "results";
      await this.clearTurn(room);
    } else {
      await this.scheduleTurn(room, state);
    }
    await this.save();

    this.emit({
      t: "move",
      playerIndex: index,
      lineId,
      claimed: outcome.claimed,
      scores: Array.from(state.scores),
      again: outcome.again,
      gameOver: outcome.gameOver,
      winners: outcome.winners,
      serverNow: Date.now(),
      turn: this.turnInfo(room, state),
    });
  }

  private async onWake(connection: Connection, room: RoomState) {
    const player = this.playerFor(connection, room);
    if (!player || !room.game || room.phase !== "playing") return;

    const state = fromSnapshot(room.game);
    const index = room.players.indexOf(player);
    if (!state.benched[index]) return;

    unbench(state, index);
    room.game = toSnapshot(state);
    await this.scheduleTurn(room, state);
    await this.save();
    this.broadcastRoom();
  }

  private async onRematch(connection: Connection, room: RoomState) {
    const player = this.playerFor(connection, room);
    if (!player || room.hostId !== player.id || room.phase !== "results") return;

    // The lobby survives â€” same code, same people, scores cleared.
    room.phase = "lobby";
    room.game = null;
    room.players.forEach((p) => (p.ready = false));
    await this.clearTurn(room);
    await this.save();
    this.broadcastRoom();
  }

  // ------------------------------------------------------------ shot clock ---

  /**
   * The whole reason this is a Durable Object: an authoritative timer without
   * an always-on process.
   */
  private async scheduleTurn(room: RoomState, state: GameState) {
    if (state.phase !== "playing" || state.paused) {
      await this.clearTurn(room);
      return;
    }
    room.turnDeadline =
      Date.now() + turnSecondsFor(state) * 1000 + ANIMATION_GRACE_MS;
    await this.ctx.storage.setAlarm(room.turnDeadline);
  }

  private async clearTurn(room: RoomState) {
    room.turnDeadline = null;
    await this.ctx.storage.deleteAlarm();
  }

  override async onAlarm() {
    const room = await this.load();
    if (room.phase !== "playing" || !room.game || room.turnDeadline === null) return;

    // Alarms can fire early or be left over from a turn that already ended.
    // Re-arm rather than skipping someone who still has time.
    const remaining = room.turnDeadline - Date.now();
    if (remaining > 50) {
      await this.ctx.storage.setAlarm(room.turnDeadline);
      return;
    }

    const state = fromSnapshot(room.game);
    const result = skipTurn(state, currentPlayer(state));
    if (!result.ok) return;

    room.game = toSnapshot(state);
    await this.scheduleTurn(room, state);
    await this.save();

    this.emit({
      t: "skip",
      playerIndex: result.value.playerIndex,
      benched: result.value.benched,
      paused: result.value.paused,
      serverNow: Date.now(),
      turn: this.turnInfo(room, state),
    });
  }

  // ---------------------------------------------------------------- output ---

  private turnInfo(room: RoomState, state: GameState): TurnInfo {
    return {
      nextPlayerIndex:
        state.phase === "over" || state.paused ? -1 : currentPlayer(state),
      turnDeadline: room.turnDeadline,
      turnSeq: state.turnSeq,
    };
  }

  private snapshot(room: RoomState): RoomSnapshot {
    const game = room.game;
    const players: PlayerInfo[] = room.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      initial: p.initial,
      colorIndex: p.colorIndex,
      connected: p.connected,
      benched: game ? game.benched[i] === 1 : false,
      score: game ? (game.scores[i] ?? 0) : 0,
      ready: p.ready,
    }));

    return {
      code: this.name,
      phase: room.phase,
      config: room.config,
      players,
      hostId: room.hostId ?? "",
      game,
      turnDeadline: room.turnDeadline,
    };
  }

  private playerFor(connection: Connection, room: RoomState): StoredPlayer | null {
    const clientId = (connection.state as ConnState | null)?.clientId;
    if (!clientId) return null;
    return room.players.find((p) => p.id === clientId) ?? null;
  }

  private send(connection: Connection, msg: ServerMessage) {
    connection.send(encode(msg));
  }

  private emit(msg: ServerMessage) {
    super.broadcast(encode(msg));
  }

  private broadcastRoom(without?: string) {
    if (!this.room) return;
    const payload = encode({
      t: "room",
      room: this.snapshot(this.room),
      serverNow: Date.now(),
    });
    super.broadcast(payload, without ? [without] : undefined);
  }

  private fail(connection: Connection, code: ErrorCode, message: string) {
    this.send(connection, { t: "error", code, message });
  }
}

// -------------------------------------------------------------------- utils ---

function sanitiseName(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim().slice(0, 14);
  return trimmed.length > 0 ? trimmed : "Player";
}

/** Fisher-Yates over `0..n-1`, using the platform CSPRNG. */
function shuffled(n: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  const rand = new Uint32Array(n);
  crypto.getRandomValues(rand);
  for (let i = n - 1; i > 0; i--) {
    const j = rand[i]! % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
