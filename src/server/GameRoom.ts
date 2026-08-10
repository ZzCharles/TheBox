import { Server, type Connection } from "partyserver";

import {
  ANIMATION_GRACE_MS,
  DISCONNECT_GRACE_MS,
  MAX_PLAYERS,
  MAX_SPECTATORS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  PROTOCOL_VERSION,
  gridSizeFor,
  MAX_GRID,
  presetAllowed,
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
  armWildcard,
  autoMoveLine,
  bench,
  buyWildcard,
  createGame,
  currentPlayer,
  skipTurn,
  turnSecondsFor,
  unbench,
  type BuyOutcome,
  type GameState,
} from "../shared/rules.ts";
import { assignInitials } from "../shared/initials.ts";
import { fromSnapshot, toSnapshot } from "../shared/snapshot.ts";

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
  /**
   * Colour this player asked for in Settings, or undefined. Granted by
   * `refreshRoster` if free; otherwise they quietly get the next open one.
   */
  preferredColor?: number;
  /** Proved they hold the owner key. Outranks join order for hosting. */
  isOwner: boolean;
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

  /**
   * Recompute everything derived from the roster: initials, colours, and who
   * holds the host role. Call after ANY change to players or their names.
   *
   * Initials come from names, so "Ada" and "Alan" become A and L. They are
   * derived rather than stored because a rename has to update them everywhere
   * at once.
   */
  private refreshRoster(room: RoomState) {
    const initials = assignInitials(room.players.map((p) => p.name));
    room.players.forEach((p, i) => {
      p.initial = initials[i] ?? "?";
    });

    /*
     * Colours: your favourite if it is still free, otherwise the next open one.
     * Silently — no prompt and no error, because a colour is not worth
     * interrupting anyone over, and the letter and the YOU tag both still say
     * which player is which.
     *
     * Earlier players win a contested colour, so someone already in the lobby
     * never has theirs taken by a newcomer.
     */
    const used = new Set<number>();
    for (const p of room.players) {
      const want = p.preferredColor;
      if (want !== undefined && want >= 0 && want < PLAYER_COLORS.length && !used.has(want)) {
        p.colorIndex = want;
        used.add(want);
      } else {
        p.colorIndex = -1;
      }
    }
    let next = 0;
    for (const p of room.players) {
      if (p.colorIndex >= 0) continue;
      while (used.has(next)) next++;
      p.colorIndex = next;
      used.add(next);
    }

    // The owner is host whenever they are connected, whatever the join order.
    // Otherwise the existing host keeps it while they are still here, and
    // failing that it falls to whoever is present.
    const owner = room.players.find((p) => p.isOwner && p.connected);
    if (owner) {
      room.hostId = owner.id;
      return;
    }
    const current = room.players.find((p) => p.id === room.hostId && p.connected);
    room.hostId = current?.id ?? room.players.find((p) => p.connected)?.id ?? null;
  }

  /**
   * Owner status is proved with a key held on the device, checked against a
   * Worker secret. If OWNER_KEY is unset the feature is simply off and the
   * first player to arrive hosts, as before.
   */
  private isOwnerKey(key: string | undefined): boolean {
    const expected = this.env.OWNER_KEY;
    return (
      typeof expected === "string" &&
      expected.length > 0 &&
      typeof key === "string" &&
      key === expected
    );
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
      case "configure":
        await this.onConfigure(connection, room, msg);
        return;
      case "start":
        await this.onStartGame(connection, room);
        return;
      case "move":
        await this.onMove(connection, room, msg.lineId, msg.turnSeq);
        return;
      case "buy":
        await this.onWildcard(connection, room, "bought");
        return;
      case "arm":
        await this.onWildcard(connection, room, "armed");
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
    // Hands the host role on if they were holding it.
    this.refreshRoster(room);

    if (room.phase === "playing") {
      // Don't park them straight away — a tunnel or a lock screen shouldn't
      // cost you your turn. Park them only if they're still gone after the
      // grace period.
      room.grace[clientId] = Date.now() + DISCONNECT_GRACE_MS;
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

    const owns = this.isOwnerKey(msg.ownerKey);

    if (player) {
      // Reconnect: keep the slot, score and inventory.
      player.connected = true;
      player.name = name;
      if (owns) player.isOwner = true;
      // A colour changed in Settings takes effect on the next connection —
      // still only if it happens to be free by then.
      if (typeof msg.colour === "number") player.preferredColor = msg.colour;
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
        initial: "?",
        colorIndex: room.players.length,
        connected: true,
        ready: false,
        ...(typeof msg.colour === "number" ? { preferredColor: msg.colour } : {}),
        isOwner: owns,
      });
    } else {
      // The match is already running: watch, and join the next one.
      if (room.spectators.length >= MAX_SPECTATORS) {
        this.fail(connection, "spectators-full", "Too many people watching");
        return;
      }
      room.spectators.push({ id: msg.clientId, name, connected: true });
    }

    this.refreshRoster(room);
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
      const requested = Math.max(0, Math.min(MAX_GRID, Math.floor(msg.gridSize)));
      // The lobby greys out sizes this roster can't have, but the client is
      // never the authority on that — 0 means "use the default for the roster".
      if (requested === 0 || presetAllowed(requested, room.players.length)) {
        room.config.gridSize = requested;
      } else {
        this.fail(connection, "board-too-big", "That board needs more players");
        return;
      }
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
    /*
     * No ready check. Being in the room IS being ready — a lobby of people who
     * have already opened the link and are looking at the same screen does not
     * need them each to press a button saying so. Only the host can start, and
     * the roster locks below.
     *
     * `ready` survives on the player because REMATCH voting still uses it, where
     * a per-player yes genuinely means something.
     */

    // The roster locks here. Anyone arriving from now on spectates.
    room.players = present;
    room.players.forEach((p) => (p.ready = false));
    this.refreshRoster(room);
    room.grace = {};

    /*
     * Re-check at start, not just at configure: a lobby can pick Grand with
     * four people and then two of them leave, which would otherwise start a
     * 420-move game for a pair.
     */
    const chosen = room.config.gridSize;
    const n =
      chosen && presetAllowed(chosen, room.players.length)
        ? chosen
        : gridSizeFor(room.players.length);
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
    /*
     * EVERY path out of here must say something back.
     *
     * The client holds an optimistic "pending" line from the moment it taps and
     * refuses further input until it hears about it, so a silent `return` here
     * does not drop one move — it locks that player out of the rest of the
     * game, showing them a faint line nobody else can see. That is exactly what
     * the first LAN playtest hit, and it is why these are `fail()` and not
     * `return`.
     */
    const player = this.playerFor(connection, room);
    if (!player || !room.game || room.phase !== "playing") {
      this.fail(connection, "stale", "That game is not running.");
      return;
    }

    const state = fromSnapshot(room.game);

    /*
     * Idempotency: a retry after a flaky connection must not place two lines.
     *
     * Answering with `stale` is safe for BOTH readings of a mismatched seq. If
     * the move was already applied, the client cleared its pending line when
     * the broadcast arrived and a resync is a no-op. If it never applied — the
     * shot clock expired first, or a reconnect replayed it late — the resync is
     * the only thing that will unstick them.
     */
    if (turnSeq !== state.turnSeq) {
      this.fail(connection, "stale", "Too late — the turn had already moved on.");
      return;
    }

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
      wildcardFired: outcome.wildcardFired,
      auto: false,
      benched: false,
      gameOver: outcome.gameOver,
      winners: outcome.winners,
      shrink: outcome.shrink,
      serverNow: Date.now(),
      turn: this.turnInfo(room, state),
    });

    // The results screen needs the roster and rematch votes, not just the move.
    if (outcome.gameOver) this.broadcastRoom();
  }

  /**
   * Twist mode only. Buying burns real boxes off the board, so the whole room
   * needs to see it — otherwise tiles would silently go grey mid-game.
   */
  private async onWildcard(
    connection: Connection,
    room: RoomState,
    action: "bought" | "armed",
  ) {
    const player = this.playerFor(connection, room);
    if (!player || !room.game || room.phase !== "playing") return;

    const state = fromSnapshot(room.game);
    const index = room.players.indexOf(player);
    const result =
      action === "bought" ? buyWildcard(state, index) : armWildcard(state, index);

    if (!result.ok) {
      this.fail(connection, "wildcard", result.reason);
      return;
    }

    room.game = toSnapshot(state);
    await this.save();

    this.emit({
      t: "wildcard",
      playerIndex: index,
      action,
      burned: action === "bought" ? (result.value as BuyOutcome).burned : [],
      charges: state.charges[index] ?? 0,
      scores: Array.from(state.scores),
    });
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
          isOwner: false,
        });
      }
      room.spectators = room.spectators.filter(
        (s) => !room.players.some((p) => p.id === s.id),
      );
      this.refreshRoster(room);

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
    /*
     * Whether the ROSTER moved, which is a separate question from whether the
     * game did.
     *
     * A room broadcast hands every client a fresh snapshot, and taking one
     * resets the board's in-flight tweens — right after a reconnect, wrong right
     * after an auto-move, whose line would pop into place instead of being
     * drawn. Scores, parking and turn order all ride the `move` the clients
     * replay, so the snapshot is only owed when the roster itself changes.
     */
    let roster = false;

    // 1. Dropped players whose grace period has run out get parked. They keep
    //    their score and seat and can tap back in whenever they return.
    for (const [clientId, at] of Object.entries(room.grace)) {
      if (at > now + DUE_SLOP_MS) continue;
      delete room.grace[clientId];
      changed = true;
      roster = true;

      const index = room.players.findIndex((p) => p.id === clientId);
      if (index < 0 || !room.game || room.phase !== "playing") continue;

      const state = fromSnapshot(room.game);
      if (state.benched[index]) continue;
      bench(state, index);
      room.game = toSnapshot(state);
      room.turnDeadline = deadlineFor(state);
      // `bench()` advances the turn but deliberately does not run the shrink
      // check; if that push crossed a collapse rotation, the next move or
      // timeout collapses instead. Delayed by one action, never missed.
      this.emit({
        t: "skip",
        playerIndex: index,
        reason: "disconnect",
        benched: true,
        paused: state.paused,
        gameOver: false,
        winners: [],
        shrink: null,
        serverNow: Date.now(),
        turn: this.turnInfo(room, state),
      });
    }

    // 2. The shot clock. A timeout PLACES A LINE — there is no passing in this
    //    game, and letting the clock end a turn for free is a way to decline to
    //    lose (§6.3.1).
    if (
      room.phase === "playing" &&
      room.game &&
      room.turnDeadline !== null &&
      room.turnDeadline <= now + DUE_SLOP_MS
    ) {
      const state = fromSnapshot(room.game);
      const index = currentPlayer(state);
      const line = autoMoveLine(state);

      /*
       * Broadcast as a `move`, not a `skip`. Every client already replays `move`
       * through the same `applyMove` this ran, so the auto-move needs no new
       * path on the wire — just `auto: true`, which tells them to charge it as a
       * miss and to say who ran out of time.
       *
       * `skipTurn` survives only as the fallback for a board with no legal move
       * left, which should be unreachable while the game is running.
       */
      const result = line === null ? null : applyMove(state, index, line, { auto: true });

      if (result?.ok) {
        changed = true;
        const outcome = result.value;
        room.game = toSnapshot(state);
        // A timeout can collapse the ring that ends the game.
        if (outcome.gameOver) {
          // The results screen is built from the roster and the rematch votes,
          // so this one does need the snapshot.
          roster = true;
          room.phase = "results";
          room.turnDeadline = null;
          room.players.forEach((p) => (p.ready = false));
        } else {
          room.turnDeadline = deadlineFor(state);
        }
        this.emit({
          t: "move",
          playerIndex: index,
          lineId: outcome.lineId,
          claimed: outcome.claimed,
          scores: Array.from(state.scores),
          again: outcome.again,
          wildcardFired: outcome.wildcardFired,
          auto: true,
          benched: outcome.benched,
          gameOver: outcome.gameOver,
          winners: outcome.winners,
          shrink: outcome.shrink,
          serverNow: Date.now(),
          turn: this.turnInfo(room, state),
        });
      } else {
        const skipped = skipTurn(state, index);
        if (skipped.ok) {
          changed = true;
          roster = true;
          room.game = toSnapshot(state);
          if (skipped.value.gameOver) {
            room.phase = "results";
            room.turnDeadline = null;
            room.players.forEach((p) => (p.ready = false));
          } else {
            room.turnDeadline = deadlineFor(state);
          }
          this.emit({
            t: "skip",
            playerIndex: skipped.value.playerIndex,
            reason: "timeout",
            benched: skipped.value.benched,
            paused: skipped.value.paused,
            gameOver: skipped.value.gameOver,
            winners: skipped.value.winners,
            shrink: skipped.value.shrink,
            serverNow: Date.now(),
            turn: this.turnInfo(room, state),
          });
        }
      }
    }

    await this.rearm(room);
    if (changed) {
      await this.save();
      if (roster) this.broadcastRoom();
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
