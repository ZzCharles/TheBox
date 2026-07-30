import { Server, type Connection } from "partyserver";

import {
  ANIMATION_GRACE_MS,
  DISCONNECT_GRACE_MS,
  MAX_PLAYERS,
  MAX_SPECTATORS,
  MIN_PLAYERS,
  PROTOCOL_VERSION,
  gridSizeFor,
} from "../shared/constants.ts";
import {
  decode,
  encode,
  type ClientMessage,
  type ErrorCode,
  type GameSnapshot,
  type PlayerInfo,
  type RoomConfig,
  type RoomPhase,
  type RoomSnapshot,
  type ServerMessage,
  type SpectatorInfo,
  type TurnInfo,
} from "../shared/protocol.ts";
import {
  applyMove,
  bench,
  createGame,
  currentPlayer,
  skipTurn,
  turnSecondsFor,
  unbench,
  type GameState,
} from "../shared/rules.ts";
import { fromSnapshot, toSnapshot } from "../shared/snapshot.ts";

const INITIALS = "ABCDEFGH";
const STORAGE_KEY = "room";
/** Alarms can fire a touch early; treat anything within this as due. */
const DUE_SLOP_MS = 50;

interface StoredPlayer {
  id: string;
  name: string;
  initial: string;
  colorIndex: number;
  connected: boolean;
  ready: boolean;
}

interface StoredSpectator {
  id: string;
  name: string;
  connected: boolean;
}

interface RoomState {
  claimed: boolean;
  phase: RoomPhase;
  config: RoomConfig;
  players: StoredPlayer[];
  spectators: StoredSpectator[];
  hostId: string | null;
  game: GameSnapshot | null;
  /** Absolute epoch ms the current turn expires. */
  turnDeadline: number | null;
  /** clientId -> absolute epoch ms at which a dropped player gets parked. */
  grace: Record<string, number>;
}

interface ConnState {
  clientId: string;
}

/**
 * One Durable Object per lobby. Authoritative for everything: turn order, move
 * legality, scores, and every deadline.
 *
 * Clients send intents and render what comes back. They never send state.
 *
 * TIMERS: a Durable Object has exactly ONE alarm, and this room needs several
 * deadlines at once (the shot clock, plus a disconnect grace period per dropped
 * player). `rearm()` sets the alarm to the earliest pending deadline and
 * `onAlarm()` processes everything that has come due. Add new timers to
 * `dueTimes()`, never by calling `setAlarm` directly.
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
      spectators: [],
      hostId: null,
      game: null,
      turnDeadline: null,
      grace: {},
    };
    // Older stored rooms may predate these fields.
    this.room.spectators ??= [];
    this.room.grace ??= {};
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

    const spectator = room.spectators.find((s) => s.id === clientId);
    if (spectator) {
      room.spectators = room.spectators.filter((s) => s.id !== clientId);
      await this.save();
      this.broadcastRoom();
      return;
    }

    const player = room.players.find((p) => p.id === clientId);
    if (!player) return;
    player.connected = false;

    if (room.phase === "playing") {
      // Don't park them straight away — a tunnel or a lock screen shouldn't
      // cost you your turn. Park them only if they're still gone after the
      // grace period.
      room.grace[clientId] = Date.now() + DISCONNECT_GRACE_MS;
    }

    if (room.hostId === clientId) {
      room.hostId = room.players.find((p) => p.connected)?.id ?? room.hostId;
    }
    // A lobby nobody is in is not worth keeping.
    if (room.phase === "lobby" && room.players.every((p) => !p.connected)) {
      room.players = [];
      room.hostId = null;
      room.grace = {};
    }

    await this.rearm(room);
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
    const player = room.players.find((p) => p.id === msg.clientId);
    const spectator = room.spectators.find((s) => s.id === msg.clientId);

    if (player) {
      // Reconnect: keep the slot, colour, score and inventory.
      player.connected = true;
      player.name = name;
      delete room.grace[player.id];
    } else if (spectator) {
      spectator.connected = true;
      spectator.name = name;
    } else if (room.phase === "lobby") {
      if (room.players.length >= MAX_PLAYERS) {
        this.fail(connection, "room-full", "That lobby is full");
        return;
      }
      room.players.push({
        id: msg.clientId,
        name,
        initial: INITIALS[room.players.length] ?? "?",
        colorIndex: room.players.length,
        connected: true,
        ready: false,
      });
    } else {
      // The match is already running: watch, and join the next one.
      if (room.spectators.length >= MAX_SPECTATORS) {
        this.fail(connection, "spectators-full", "Too many people watching");
        return;
      }
      room.spectators.push({ id: msg.clientId, name, connected: true });
    }

    room.hostId ??= room.players[0]?.id ?? null;
    // Connection state is stored as a hibernation attachment, so the
    // connection -> player mapping survives the DO going to sleep.
    (connection as Connection<ConnState>).setState({ clientId: msg.clientId });

    await this.rearm(room);
    await this.save();
    this.send(connection, {
      t: "welcome",
      you: msg.clientId,
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

    // The roster locks here. Anyone arriving from now on spectates.
    room.players = present;
    room.players.forEach((p, i) => {
      p.initial = INITIALS[i] ?? "?";
      p.colorIndex = i;
      p.ready = false;
    });
    room.grace = {};

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
    room.turnDeadline = deadlineFor(state);
    await this.rearm(room);
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
      room.turnDeadline = null;
      room.players.forEach((p) => (p.ready = false));
    } else {
      room.turnDeadline = deadlineFor(state);
    }
    await this.rearm(room);
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

    // The results screen needs the roster and rematch votes, not just the move.
    if (outcome.gameOver) this.broadcastRoom();
  }

  private async onWake(connection: Connection, room: RoomState) {
    const player = this.playerFor(connection, room);
    if (!player || !room.game || room.phase !== "playing") return;

    const state = fromSnapshot(room.game);
    const index = room.players.indexOf(player);
    if (!state.benched[index]) return;

    unbench(state, index);
    delete room.grace[player.id];
    room.game = toSnapshot(state);
    room.turnDeadline = deadlineFor(state);
    await this.rearm(room);
    await this.save();
    this.broadcastRoom();
  }

  /**
   * Rematch is a vote, not a host decision: everyone still connected has to
   * agree. The lobby survives — same code, same people — and anyone who has
   * been spectating joins the next game.
   */
  private async onRematch(connection: Connection, room: RoomState) {
    const player = this.playerFor(connection, room);
    if (!player || room.phase !== "results") return;

    player.ready = !player.ready;

    const present = room.players.filter((p) => p.connected);
    const everyoneAgrees = present.length > 0 && present.every((p) => p.ready);

    if (everyoneAgrees) {
      room.players = present;
      // Promote spectators into the next game, up to the player cap.
      for (const s of room.spectators.filter((s) => s.connected)) {
        if (room.players.length >= MAX_PLAYERS) break;
        room.players.push({
          id: s.id,
          name: s.name,
          initial: "?",
          colorIndex: room.players.length,
          connected: true,
          ready: true,
        });
      }
      room.spectators = room.spectators.filter(
        (s) => !room.players.some((p) => p.id === s.id),
      );
      room.players.forEach((p, i) => {
        p.initial = INITIALS[i] ?? "?";
        p.colorIndex = i;
      });

      room.phase = "lobby";
      room.game = null;
      room.turnDeadline = null;
      // Grid size is recomputed for the new roster size on start.
      room.config.gridSize = 0;
    }

    await this.rearm(room);
    await this.save();
    this.broadcastRoom();
  }

  // ---------------------------------------------------------------- timers ---

  /** Every pending deadline. The alarm is set to the earliest of these. */
  private dueTimes(room: RoomState): number[] {
    const times: number[] = [];
    if (room.phase === "playing" && room.turnDeadline !== null) {
      times.push(room.turnDeadline);
    }
    for (const at of Object.values(room.grace)) times.push(at);
    return times;
  }

  private async rearm(room: RoomState) {
    const times = this.dueTimes(room);
    if (times.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...times));
  }

  override async onAlarm() {
    const room = await this.load();
    const now = Date.now();
    let changed = false;

    // 1. Dropped players whose grace period has run out get parked. They keep
    //    their score and seat and can tap back in whenever they return.
    for (const [clientId, at] of Object.entries(room.grace)) {
      if (at > now + DUE_SLOP_MS) continue;
      delete room.grace[clientId];
      changed = true;

      const index = room.players.findIndex((p) => p.id === clientId);
      if (index < 0 || !room.game || room.phase !== "playing") continue;

      const state = fromSnapshot(room.game);
      if (state.benched[index]) continue;
      bench(state, index);
      room.game = toSnapshot(state);
      room.turnDeadline = deadlineFor(state);
      this.emit({
        t: "skip",
        playerIndex: index,
        benched: true,
        paused: state.paused,
        serverNow: Date.now(),
        turn: this.turnInfo(room, state),
      });
    }

    // 2. The shot clock.
    if (
      room.phase === "playing" &&
      room.game &&
      room.turnDeadline !== null &&
      room.turnDeadline <= now + DUE_SLOP_MS
    ) {
      const state = fromSnapshot(room.game);
      const result = skipTurn(state, currentPlayer(state));
      if (result.ok) {
        changed = true;
        room.game = toSnapshot(state);
        room.turnDeadline = deadlineFor(state);
        this.emit({
          t: "skip",
          playerIndex: result.value.playerIndex,
          benched: result.value.benched,
          paused: result.value.paused,
          serverNow: Date.now(),
          turn: this.turnInfo(room, state),
        });
      }
    }

    await this.rearm(room);
    if (changed) {
      await this.save();
      this.broadcastRoom();
    }
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
    const spectators: SpectatorInfo[] = room.spectators.map((s) => ({
      id: s.id,
      name: s.name,
      connected: s.connected,
    }));

    return {
      code: this.name,
      phase: room.phase,
      config: room.config,
      players,
      spectators,
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

/** Null once the game is over or every player is parked. */
function deadlineFor(state: GameState): number | null {
  if (state.phase !== "playing" || state.paused) return null;
  return Date.now() + turnSecondsFor(state) * 1000 + ANIMATION_GRACE_MS;
}

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
