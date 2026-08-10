/**
 * The online room: lobby, then networked play, sharing one WebSocket.
 *
 * The client is a renderer, not a referee. It sends intents and applies what
 * the server broadcasts. The one clever bit is that it replays each broadcast
 * move through the SAME `applyMove` the server ran — so the board, scores and
 * turn order are recomputed locally rather than trusted from the wire, and any
 * divergence is a loud bug rather than a silent drift.
 */

import { PLAYER_COLORS, WARN_AT_SECONDS_REMAINING } from "../../shared/constants.ts";
import {
  PROTOCOL_VERSION,
  type RoomSnapshot,
  type ServerMessage,
} from "../../shared/protocol.ts";
import { fromSnapshot } from "../../shared/snapshot.ts";
import {
  applyMove,
  armWildcard,
  bench,
  buyWildcard,
  canPlace,
  currentPlayer,
  isShrinkWarning,
  ringBoxes,
  roundsUntilCollapse,
  wildcardCostPreview,
  skipTurn,
  turnSecondsFor,
  type GameState,
  type ShrinkOutcome,
} from "../../shared/rules.ts";
import {
  BOARD_PRESETS,
  estimatedMinutes,
  GRAND_MIN_PLAYERS,
  gridSizeFor,
  presetAllowed,
  MAX_WILDCARD_CHARGES,
  MIN_PLAYERS,
  SHRINK_INTERVAL_ROTATIONS,
  WILDCARD_COST,
} from "../../shared/constants.ts";
import { play } from "../audio/engine.ts";
import { exposeDebug } from "../devtools.ts";
import { attachPointer } from "../input/pointer.ts";
import { clientId, motionReduced, ownerKey, prefs, storedName } from "../net/identity.ts";
import { connect, type Net, type NetStatus } from "../net/socket.ts";
import {
  createBoardRenderer,
  entranceDurationMs,
  type BoardRenderer,
  type BoardView,
  type PlayerView,
} from "../render/boardRenderer.ts";
import {
  BOARD_START_OFFSET_MS,
  playStartSequence,
  type StartSequence,
} from "./startSequence.ts";
import { CONFIRM_TAP_FROM_GRID } from "../render/layout.ts";
import { createShatter, SHATTER } from "../render/shatter.ts";
import { createStage, type Stage } from "../render/stage.ts";
import { createScoreboard, type Scoreboard } from "./scoreboard.ts";
import { wordmark } from "./wordmark.ts";

const CLOCK_TICK_MS = 50;

/**
 * How long to hold an unconfirmed line before giving up on it.
 *
 * Comfortably longer than any real round trip — the deployed site measured a
 * 28ms median — so this only ever fires when something has genuinely gone
 * wrong, and short enough that it resolves inside a 12s turn.
 */
const PENDING_TIMEOUT_MS = 2500;

/** 2πr for the r=19 collapse dial in the burn badge. */
const BURN_RING_CIRCUMFERENCE = 2 * Math.PI * 19;

/** How long the "you can afford a Wildcard" nudge stays up. */
const NUDGE_MS = 5000;

type ViewKind = "connecting" | "lobby" | "game";

export function mountRoom(root: HTMLElement, code: string): () => void {
  const me = clientId();
  let room: RoomSnapshot | null = null;
  let state: GameState | null = null;
  let status: NetStatus = "connecting";
  let view: ViewKind = "connecting";
  let disposeView: (() => void) | null = null;
  let updateView: (() => void) | null = null;

  const net: Net = connect({
    code,
    clientId: me,
    name: storedName() || "Player",
    ownerKey: ownerKey(),
    colour: prefs().colour,
    onMessage: handle,
    onStatus(next) {
      status = next;
      updateView?.();
    },
  });

  function handle(msg: ServerMessage) {
    switch (msg.t) {
      // Whether we are playing or spectating is derived from the roster in
      // these snapshots, never tracked separately — one source of truth cannot
      // disagree with itself.
      case "welcome":
      case "room":
        room = msg.room;
        // A fresh snapshot always wins over locally replayed state, and any
        // in-flight tween describes a board that may no longer exist.
        state = msg.room.game ? fromSnapshot(msg.room.game) : null;
        resetAnimations?.();
        break;

      case "move":
        applyBroadcastMove(msg);
        break;

      case "skip":
        applyBroadcastSkip(msg);
        break;

      case "wildcard":
        applyBroadcastWildcard(msg);
        break;

      case "error":
        /*
         * Retract FIRST. A pending line is a promise the server has just
         * refused to keep, and the board refuses further input while one is
         * outstanding — so until this runs, that player cannot move again.
         */
        retractPending?.();
        if (msg.code === "stale") {
          // Not the player's fault and not worth alarming language: the clock
          // beat them, or the socket blinked. Ask for the truth and move on.
          toast("Too late — that turn had passed");
          resync();
        } else {
          toast(msg.message);
        }
        if (msg.code === "bad-protocol") location.reload();
        return;

      default:
        return;
    }
    sync();
  }

  function applyBroadcastMove(msg: Extract<ServerMessage, { t: "move" }>) {
    if (!state || !room) return;

    /*
     * `auto` has to be carried through, not inferred. It is what turns this
     * replay into a MISS rather than a move — without it the local copy clears
     * the miss counter the server just advanced, and the two disagree about who
     * is one timeout away from being parked.
     */
    const result = applyMove(state, msg.playerIndex, msg.lineId, { auto: msg.auto });
    if (!result.ok) {
      // We are out of step with the server. Re-introducing ourselves returns a
      // full snapshot, which is cheaper than trying to reconcile.
      resync();
      return;
    }

    room.turnDeadline = msg.turn.turnDeadline;
    onMoveRendered?.(msg.lineId, result.value.claimed);
    if (msg.shrink) {
      onShrinkRendered?.(msg.shrink);
      announceShrink(msg.shrink);
    }
    if (msg.wildcardFired) {
      toast(`${room.players[msg.playerIndex]?.name ?? "Someone"} used a Wildcard`);
    }
    if (msg.auto) announceAutoMove(msg.playerIndex, msg.benched);

    if (import.meta.env.DEV) {
      const drift = msg.scores.some((s, i) => s !== state!.scores[i]);
      if (drift) console.warn("[box] score divergence from server", msg.scores);
    }
  }

  /**
   * Buying burns tiles off the board, so every client replays it — otherwise
   * boxes would silently turn grey with no explanation.
   */
  function applyBroadcastWildcard(msg: Extract<ServerMessage, { t: "wildcard" }>) {
    if (!state || !room) return;
    const result =
      msg.action === "bought"
        ? buyWildcard(state, msg.playerIndex)
        : armWildcard(state, msg.playerIndex);
    if (!result.ok) {
      resync();
      return;
    }
    const who = room.players[msg.playerIndex]?.name ?? "Someone";
    // Only the purchase makes a noise. Arming is announced by the badge going
    // bright, and giving one mechanic two sounds blurs what each one means.
    if (msg.action === "bought") play("thunk", { gain: 0.85 });
    toast(
      msg.action === "bought"
        ? `${who} bought a Wildcard for ${WILDCARD_COST}`
        : `${who} armed a Wildcard`,
    );
  }

  /**
   * A line appearing on its own needs explaining, or it reads as a bug.
   *
   * Says a line WAS PLACED rather than that a turn was lost, because that is the
   * rule now: there is no passing, so running out of time costs you a move of
   * the server's choosing rather than nothing at all.
   */
  function announceAutoMove(playerIndex: number, benched: boolean) {
    if (!room) return;
    const mine = room.players[playerIndex]?.id === me;
    const who = mine ? "You" : (room.players[playerIndex]?.name ?? "Someone");
    const them = mine ? "you" : "them";
    toast(
      benched
        ? `${who} ran out of time — parked, and a line was placed for ${them}`
        : `${who} ran out of time — a line was placed for ${them}`,
    );
  }

  /**
   * Say what players KEPT, not just what vanished. Claimed tiles in a
   * collapsing ring bank their points — phrasing it as pure loss made the
   * mechanic read as a punishment.
   */
  function announceShrink(shrink: { removedBoxes: number[]; harvested: unknown[] }) {
    play("whoosh");
    const kept = shrink.harvested.length;
    const lost = shrink.removedBoxes.length - kept;
    toast(
      kept > 0
        ? `Board closed in · ${kept} claimed ${kept === 1 ? "box" : "boxes"} banked · ${lost} lost`
        : `Board closed in · ${lost} unclaimed ${lost === 1 ? "square" : "squares"} gone`,
    );
  }

  /**
   * Leaving is deliberately just navigation: the seat is held by clientId, so
   * returning to the same code drops you into the same slot with your score.
   *
   * Goes home explicitly rather than calling `history.back()`, which would walk
   * into whatever room you were in before. Android's hardware back key still
   * does the normal history thing — the router handles it via `hashchange`,
   * disposing the view and closing the socket.
   */
  function leaveGame() {
    location.hash = "#/";
  }

  /**
   * Hand the room to someone else: the link if we can, the code if we can't.
   *
   * `navigator.clipboard` is SECURE-CONTEXT ONLY — undefined over plain http to
   * a LAN address, which is precisely where playtests happen. Optional chaining
   * short-circuits the ENTIRE chain, so `clipboard?.writeText(...).then(...)`
   * does not throw there; it silently evaluates to nothing. No copy, no toast,
   * a button that looks broken and a host who cannot invite anyone.
   *
   * So: feature-detect, and fall back to the code itself — which is what people
   * read across a table anyway, and why it is four characters long.
   */
  function shareInvite() {
    const sayCode = () => toast(`Room code ${code} — type it in`);
    if (!navigator.clipboard) {
      sayCode();
      return;
    }
    void navigator.clipboard
      .writeText(location.href)
      .then(() => toast("Invite link copied"))
      .catch(sayCode);
  }

  /**
   * Replay a timeout locally through the same `skipTurn` the server ran, rather
   * than asking for a fresh snapshot. Keeps bench flags and turn order in
   * lockstep with no extra round-trip.
   */
  function applyBroadcastSkip(msg: Extract<ServerMessage, { t: "skip" }>) {
    if (!state || !room) return;

    if (msg.reason === "disconnect") {
      // Parked for being gone, not for running out of clock: replay the same
      // `bench` the server ran, which leaves the miss counter and turn sequence
      // untouched.
      bench(state, msg.playerIndex);
    } else {
      const result = skipTurn(state, msg.playerIndex);
      if (!result.ok) {
        resync();
        return;
      }
    }

    if (state.turnSeq !== msg.turn.turnSeq) {
      resync();
      return;
    }
    room.turnDeadline = msg.turn.turnDeadline;
    if (msg.shrink) {
      // A collapse can land on a TIMEOUT as well as on a move — the ring goes
      // when the rotation completes, however it completed.
      onShrinkRendered?.(msg.shrink);
      announceShrink(msg.shrink);
    }
  }

  function resync() {
    net.send({
      t: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientId: me,
      name: storedName() || "Player",
      ...(ownerKey() ? { ownerKey: ownerKey() } : {}),
      ...(prefs().colour >= 0 ? { colour: prefs().colour } : {}),
    });
  }

  /** Set by the game view so board animations can fire on broadcast moves. */
  let onMoveRendered: ((lineId: number, claimed: number[]) => void) | null = null;
  /** Set by the game view; sets the collapsed ring alight. */
  let onShrinkRendered: ((shrink: ShrinkOutcome) => void) | null = null;
  /** Set by the game view; drops an unconfirmed line and re-enables input. */
  let retractPending: (() => void) | null = null;
  /** Set by the game view; drops tweens that a fresh snapshot has invalidated. */
  let resetAnimations: (() => void) | null = null;

  // ------------------------------------------------------------- view swap ---

  function sync() {
    const want: ViewKind = !room ? "connecting" : room.phase === "lobby" ? "lobby" : "game";
    if (want !== view) {
      disposeView?.();
      disposeView = null;
      updateView = null;
      onMoveRendered = null;
      onShrinkRendered = null;
      retractPending = null;
      resetAnimations = null;
      view = want;
      if (want === "connecting") mountConnecting();
      else if (want === "lobby") mountLobby();
      else mountGame();
    }
    updateView?.();
  }

  function mountConnecting() {
    root.innerHTML = `
      <main class="setup">
        <h1>${wordmark()}</h1>
        <p class="tag">room ${escapeHtml(code)}</p>
        <p class="hint" id="conn">connecting…</p>
      </main>`;
    const el = root.querySelector<HTMLElement>("#conn")!;
    updateView = () => {
      el.textContent = status === "reconnecting" ? "reconnecting…" : "connecting…";
    };
  }

  // ----------------------------------------------------------------- lobby ---

  function mountLobby() {
    root.innerHTML = `
      <main class="setup lobby">
        <button class="linkish" id="leave">‹ Leave</button>

        <!--
          One tile per character. Read aloud across a room far more often than
          it is typed, and four separate tiles are what stop "8" and "B" running
          together when someone is squinting at a phone from across a table.
        -->
        <div class="code-tiles" aria-label="Room code ${escapeHtml(code)}">
          ${[...code].map((ch) => `<span>${escapeHtml(ch)}</span>`).join("")}
        </div>
        <p class="tag">room code</p>
        <button class="chip" id="share">Copy invite link</button>

        <section>
          <h2>Players <span id="count"></span></h2>
          <ul class="roster" id="roster"></ul>
          <p class="hint" id="watching"></p>
        </section>

        <section>
          <h2>Mode</h2>
          <div class="chips" id="modes">
            <button class="chip" data-mode="simple">Simple</button>
            <button class="chip" data-mode="twist">Twist</button>
          </div>
          <p class="hint" id="mode-note"></p>
        </section>

        <section>
          <h2>Board</h2>
          <div class="chips" id="sizes">
            ${BOARD_PRESETS.map(
              (p) => `<button class="chip" data-grid="${p.grid}">${p.label}</button>`,
            ).join("")}
          </div>
        </section>

        <p class="hint" id="grid"></p>

        <!--
          Being in the room IS being ready, so there is no ready button. The
          waiting box is deliberately the same height as the Start button, so
          nothing on screen shifts at the moment the host presses it.
        -->
        <button class="primary" id="start" hidden>Start game</button>
        <div class="waiting" id="waiting" hidden><i></i><span id="waiting-text"></span></div>
        <p class="hint" id="lobby-status"></p>

        <!--
          toast() targets #toast and quietly does nothing when it is absent, so
          without this the lobby had no way to answer the share button at all —
          "Invite link copied" went nowhere on every origin. Fixed position, so
          it costs the layout nothing.
        -->
        <div class="toast" id="toast"></div>
      </main>`;

    const roster = root.querySelector<HTMLElement>("#roster")!;
    const count = root.querySelector<HTMLElement>("#count")!;
    const watching = root.querySelector<HTMLElement>("#watching")!;
    const grid = root.querySelector<HTMLElement>("#grid")!;
    const startBtn = root.querySelector<HTMLButtonElement>("#start")!;
    const waitingBox = root.querySelector<HTMLElement>("#waiting")!;
    const waitingText = root.querySelector<HTMLElement>("#waiting-text")!;
    const statusEl = root.querySelector<HTMLElement>("#lobby-status")!;

    const modes = root.querySelector<HTMLElement>("#modes")!;
    const modeNote = root.querySelector<HTMLElement>("#mode-note")!;
    const sizes = root.querySelector<HTMLElement>("#sizes")!;

    modes.addEventListener("click", (e) => {
      const mode = (e.target as HTMLElement).dataset.mode;
      if (mode === "simple" || mode === "twist") net.send({ t: "configure", mode });
    });
    sizes.addEventListener("click", (e) => {
      const grid = Number((e.target as HTMLElement).dataset.grid);
      if (grid > 0) net.send({ t: "configure", gridSize: grid });
    });
    root.querySelector<HTMLElement>("#leave")!.addEventListener("click", leaveGame);
    startBtn.addEventListener("click", () => net.send({ t: "start" }));
    root.querySelector<HTMLElement>("#share")!.addEventListener("click", shareInvite);

    updateView = () => {
      if (!room) return;
      const isHost = room.hostId === me;

      count.textContent = `${room.players.length}`;
      /*
       * Which one is me: a hollow YOU tag, next to HOST when both apply. Tags
       * rather than a highlighted row, because neither costs horizontal space —
       * which matters at eight players on a 320px phone.
       */
      roster.innerHTML = room.players
        .map(
          (p) => `
        <li class="${p.connected ? "" : "is-away"}"
            style="--player-color:${PLAYER_COLORS[p.colorIndex] ?? "#888"}">
          <span class="dot"></span>
          <span class="who">${escapeHtml(p.name)}</span>
          <span class="tags">
            ${room!.hostId === p.id ? '<span class="badge">host</span>' : ""}
            ${p.id === me ? '<span class="badge you">you</span>' : ""}
          </span>
          <span class="state">${p.connected ? "" : "away"}</span>
        </li>`,
        )
        .join("");

      watching.textContent = room.spectators.length
        ? `${room.spectators.map((s) => s.name).join(", ")} watching`
        : "";

      for (const chip of modes.querySelectorAll<HTMLButtonElement>(".chip")) {
        chip.classList.toggle("selected", chip.dataset.mode === room.config.mode);
        // Only the host can change it, but everyone sees what was picked.
        chip.disabled = !isHost;
      }
      modeNote.textContent =
        room.config.mode === "twist"
          ? `Board shrinks · spend ${WILDCARD_COST} boxes for an extra line`
          : "Classic dots and boxes";

      const n = room.config.gridSize || gridSizeFor(room.players.length);
      let gated = false;
      for (const chip of sizes.querySelectorAll<HTMLButtonElement>(".chip")) {
        const chipGrid = Number(chip.dataset.grid);
        const allowed = presetAllowed(chipGrid, room.players.length);
        chip.classList.toggle("selected", chipGrid === n);
        // Greyed, never hidden — players should see a size exists before they
        // can pick it, and the row must not change height mid-lobby.
        chip.disabled = !isHost || !allowed;
        if (!allowed) gated = true;
      }
      grid.textContent = gated
        ? `${n}×${n} · ${n * n} boxes · about ${estimatedMinutes(n)} min` +
          ` · Grand needs ${GRAND_MIN_PLAYERS} players`
        : `${n}×${n} · ${n * n} boxes · about ${estimatedMinutes(n)} min`;

      // Exactly one of these is on screen at a time, and they are the same
      // height, so the host pressing Start moves nothing for anyone else.
      const enough = room.players.length >= MIN_PLAYERS;
      startBtn.hidden = !isHost;
      startBtn.disabled = !enough;
      waitingBox.hidden = isHost;
      if (!isHost) {
        const host = room.players.find((p) => p.id === room!.hostId);
        waitingText.textContent = host
          ? `Waiting for ${host.name} to start`
          : "Waiting for the host to start";
      }
      statusEl.textContent =
        isHost && !enough ? `Need at least ${MIN_PLAYERS} players` : "";
    };

    disposeView = () => {
      /* plain DOM, replaced wholesale on the next mount */
    };
  }

  // ------------------------------------------------------------------ game ---

  function mountGame() {
    if (!room || !state) return;

    const players: PlayerView[] = room.players.map((p) => ({
      name: p.name,
      initial: p.initial,
      color: PLAYER_COLORS[p.colorIndex] ?? "#888",
    }));
    const myIndex = room.players.findIndex((p) => p.id === me);
    const n = state.n;

    const twist = state.mode === "twist";

    // LAYOUT RULE: every row outside .board-wrap keeps a constant height for the
    // whole game. Anything that appears and disappears resizes the board, which
    // reads as the screen jumping on every turn.
    root.innerHTML = `
      <div class="game">
        <header class="game-head">
          <button class="icon-btn" id="back" aria-label="Leave game">‹</button>
          <span class="now-playing" id="now-playing"></span>
          <button class="code-chip" id="code-chip" title="Tap to copy the invite link">
            ${escapeHtml(code)}
          </button>
        </header>
        <div id="scoreboard"></div>
        <div class="board-wrap">
          <div class="board" id="board"></div>
          ${
            twist
              ? `<!--
                   The collapse warning lives OVER the board, absolutely
                   positioned, because that is where the eyes already are — and
                   because a row here would resize the canvas every time it
                   appeared, which is the jitter §10.0 exists to prevent.
                   The ring drains as the collapse approaches.
                 -->
                 <div class="burn-warning" id="burn-warning" hidden aria-live="polite">
                   <svg viewBox="0 0 44 44" aria-hidden="true">
                     <circle class="bw-track" cx="22" cy="22" r="19" />
                     <circle class="bw-ring" cx="22" cy="22" r="19"
                             stroke-dasharray="119.4" stroke-dashoffset="0" />
                   </svg>
                   <span class="bw-flame" aria-hidden="true">🔥</span>
                   <span class="bw-count" id="burn-count"></span>
                 </div>`
              : ""
          }
        </div>
        ${
          twist
            ? `<div class="shop" id="shop">
                 <!--
                   The nudge is anchored to the BUY BUTTON, not to the row: the
                   row holds three items, so a row-centred tail points into the
                   gap beside the button it is talking about. It floats above
                   the row rather than sitting in it, because the shop row holds
                   ONE height for the whole game.
                 -->
                 <span class="shop-slot">
                   <div class="shop-nudge" id="shop-nudge" hidden>
                     Tap for Wildcard · one extra line
                   </div>
                   <button class="chip" id="buy"></button>
                 </span>
                 <button class="chip" id="arm"></button>
                 <span class="shrink-chip" id="shrink"></span>
               </div>`
            : ""
        }
        <div class="turn-banner" id="banner"></div>
        <div class="pill" id="pill"></div>
        <div class="toast" id="toast"></div>
        <!--
          The endgame shatter, over the WHOLE screen rather than over the board.
          A square has to fly out of .board-wrap and land on a scoreboard panel,
          which nothing inside the board canvas can do — it would clip at the
          first edge. Absolutely positioned, so like the burn warning it holds
          no row and costs the layout nothing (§10.0). See render/shatter.ts.
        -->
        <canvas class="shatter-layer" id="shatter" aria-hidden="true"></canvas>
        <div class="overlay" id="overlay" hidden></div>
      </div>`;

    root.querySelector<HTMLElement>("#back")!.addEventListener("click", leaveGame);
    root.querySelector<HTMLElement>("#code-chip")!.addEventListener("click", shareInvite);

    const boardHost = root.querySelector<HTMLElement>("#board")!;
    const banner = root.querySelector<HTMLElement>("#banner")!;
    const overlay = root.querySelector<HTMLElement>("#overlay")!;

    const scoreboard: Scoreboard = createScoreboard(
      root.querySelector<HTMLElement>("#scoreboard")!,
      players,
      // -1 for a spectator, who has no panel of their own to mark.
      room?.players.findIndex((p) => p.id === me) ?? -1,
    );
    const renderer: BoardRenderer = createBoardRenderer(
      boardHost.clientWidth || 320,
      boardHost.clientHeight || 320,
      n,
    );

    let ghost: number | null = null;
    /** Line we have sent but not yet seen echoed back. */
    let pending: number | null = null;
    let pendingTimer = 0;

    /**
     * The last line of defence, and the reason it exists.
     *
     * `isMyTurn()` refuses input while a line is pending, so an unanswered move
     * is not a lost move — it is a player who can never move again, staring at
     * a faint line nobody else can see. The server no longer fails silently and
     * perishable intents are no longer queued across a reconnect, but neither
     * of those helps against a dropped packet or a bug still unfound.
     *
     * So: if nothing comes back, give the turn up and ask for the truth. The
     * worst case becomes one lost turn instead of one lost player.
     */
    function setPending(lineId: number | null) {
      pending = lineId;
      window.clearTimeout(pendingTimer);
      if (lineId === null) return;
      pendingTimer = window.setTimeout(() => {
        if (pending === null) return;
        pending = null;
        toast("That didn't reach the table — try again");
        resync();
        stage.requestFrame();
      }, PENDING_TIMEOUT_MS);
    }

    const boardView: BoardView = {
      state,
      players,
      ghost: null,
      pending: null,
      ghostColor: players[myIndex]?.color ?? "#888",
      doomed: [],
      costPreview: [],
      hiddenBoxes: null,
    };

    function syncBoardView() {
      if (!state) return;
      boardView.state = state;
      // Kept apart on purpose: a ghost says "tap again to place this here",
      // a pending line says "placed, waiting". Folding them into one value
      // made the two indistinguishable on the board.
      boardView.ghost = ghost;
      boardView.pending = pending;
      boardView.ghostColor = players[currentPlayer(state)]?.color ?? "#888";
      // Recomputed on state change, not per frame — the pulse itself is driven
      // by the clock inside the renderer.
      boardView.doomed = isShrinkWarning(state) ? ringBoxes(state) : [];
      // Only ever your own price — showing everyone's would be unreadable.
      boardView.costPreview = costPreviewFor(state, myIndex);
      boardView.hiddenBoxes = shatter.active ? shatter.hidden : null;
    }

    /*
     * The endgame shatter (§12.3), on its own full-screen canvas.
     *
     * Driven from the BOARD's render loop rather than a second
     * `requestAnimationFrame`, because two independent loops on one screen
     * drift against each other and each keeps the other's battery drain alive.
     * The stage already coalesces frame requests and already stops when nothing
     * is animating; this just adds a second thing that can say "still moving".
     */
    const gameEl = root.querySelector<HTMLElement>(".game")!;
    const shatterCanvas = root.querySelector<HTMLCanvasElement>("#shatter")!;
    const shatterCtx = shatterCanvas.getContext("2d");
    const shatter = createShatter();
    /** Per-player counters during the flight. See `beginShatter`. */
    let flightScores: number[] | null = null;
    let crackPlayed = false;
    let lastFrameAt = 0;

    function sizeShatterLayer() {
      if (!shatterCtx) return;
      // Same DPR cap as the board: 3 costs fill rate for nothing visible.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = gameEl.getBoundingClientRect();
      shatterCanvas.width = Math.round(rect.width * dpr);
      shatterCanvas.height = Math.round(rect.height * dpr);
      shatterCanvas.style.width = `${rect.width}px`;
      shatterCanvas.style.height = `${rect.height}px`;
      shatterCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /**
     * Where the pieces are flying FROM and TO, in overlay pixels.
     *
     * Measured off the live DOM rather than computed, because the scoreboard is
     * a flex row whose panel widths depend on the player count, the longest
     * name and the font that actually loaded. Anything we derived here would be
     * a second opinion about a layout the browser has already decided.
     */
    function shatterGeometry() {
      const gameRect = gameEl.getBoundingClientRect();
      const boardRect = boardHost.getBoundingClientRect();
      const avatars = root.querySelectorAll<HTMLElement>("#scoreboard .player .avatar");
      const targets = players.map((_, index) => {
        const rect = avatars[index]?.getBoundingClientRect();
        if (!rect) return { x: gameRect.width / 2, y: 0 };
        return {
          x: rect.left + rect.width / 2 - gameRect.left,
          y: rect.top + rect.height / 2 - gameRect.top,
        };
      });
      return {
        targets,
        boardOffset: { x: boardRect.left - gameRect.left, y: boardRect.top - gameRect.top },
      };
    }

    /**
     * One frame of the whole screen, both layers.
     *
     * Named rather than inlined because `__box.drawNow()` has to be able to
     * render exactly what the render loop renders. `requestAnimationFrame`
     * never fires in a hidden tab, so hand-driving frames is the only way to
     * inspect any of this from automation — and a `drawNow` that painted the
     * board but not the shatter would report a board with holes in it as the
     * finished picture.
     */
    function renderFrame(ctx: CanvasRenderingContext2D, now: number): boolean {
      syncBoardView();
      const board = renderer.draw(ctx, now, boardView);

      let shattering = false;
      if (shatter.active && shatterCtx) {
        // Clamped: a hidden tab or a slow first frame otherwise hands the
        // particles one enormous step and teleports the debris off screen.
        const dt = lastFrameAt === 0 ? 16 : Math.min(64, now - lastFrameAt);
        if (!crackPlayed && now - shatterStartedAt >= SHATTER.holdMs) {
          crackPlayed = true;
          play("crack");
        }
        shattering = shatter.update(now, dt, onPieceLanded);
        shatterCtx.clearRect(0, 0, shatterCanvas.width, shatterCanvas.height);
        shatter.draw(shatterCtx, now);
        if (!shattering) finishShatter();
      }
      lastFrameAt = now;
      return board || shattering;
    }

    const stage: Stage = createStage(
      boardHost,
      renderFrame,
      (s) => {
        renderer.resize(s.width, s.height, n);
        if (shatter.active) {
          sizeShatterLayer();
          const { targets, boardOffset } = shatterGeometry();
          shatter.remeasure(renderer.layout, targets, boardOffset);
        }
      },
    );

    /*
     * The shatter's own little state machine.
     *
     * "done" is not the same as "played": a reduced-motion viewer, a spectator
     * who arrived after the last box, and anyone reconnecting into a finished
     * game all land on "done" without a frame being drawn. That is the point —
     * the result must never be gated on an animation (§5), so every path that
     * skips the sequence still has to arrive at the same place.
     */
    let shatterStage: "idle" | "running" | "crowning" | "done" = "idle";
    let shatterStartedAt = 0;
    let victoryTimer = 0;
    /**
     * The fanfare belongs to step 6, and step 6 is reached two different ways —
     * through the sequence, or straight past it. One flag so it plays exactly
     * once either way.
     */
    let fanfarePlayed = false;

    function playFanfare() {
      if (fanfarePlayed) return;
      fanfarePlayed = true;
      // No pitch scatter: this one is musical, and a detuned fanfare is a sour
      // fanfare.
      play("fanfare", { jitter: 0 });
    }

    function beginShatter() {
      if (shatterStage !== "idle") return;
      if (!state || !shatterCtx || motionReduced() || renderer.layout.cell <= 0) {
        shatterStage = "done";
        return;
      }
      shatterStage = "running";
      shatterStartedAt = performance.now();
      crackPlayed = false;
      lastFrameAt = 0;

      sizeShatterLayer();
      const { targets, boardOffset } = shatterGeometry();

      /*
       * Counters start at `harvested`, NOT at zero.
       *
       * A square the fire took banked its point rounds ago and is not going to
       * fly again (§17), so a count-up from zero would land short by exactly
       * the number of tiles that ever burned — and it would land short on the
       * one number the whole sequence exists to announce.
       */
      flightScores = players.map((_, index) => state!.harvested[index] ?? 0);
      for (let index = 0; index < players.length; index++) {
        scoreboard.land(index, flightScores[index] ?? 0);
      }

      shatter.begin(
        {
          boxes: state.boxes,
          formerOwner: state.formerOwner,
          colors: players.map((p) => p.color),
          initials: players.map((p) => p.initial),
        },
        renderer.layout,
        targets,
        boardOffset,
        shatterStartedAt,
      );
      gameEl.classList.add("shattering");
      stage.requestFrame();
    }

    function onPieceLanded(player: number) {
      // The engine already caps simultaneous voices at four and evicts the
      // oldest, which is exactly the ducking §12.3 asks for — forty clacks in
      // two seconds needs no special handling here.
      play("clack");
      if (!flightScores) return;
      flightScores[player] = (flightScores[player] ?? 0) + 1;
      scoreboard.land(player, flightScores[player]!);
    }

    function finishShatter() {
      if (shatterStage !== "running") return;
      shatterStage = "crowning";
      flightScores = null;
      gameEl.classList.remove("shattering");
      shatterCtx?.clearRect(0, 0, shatterCanvas.width, shatterCanvas.height);

      crownWinners();
      playFanfare();

      // The result waits out the celebration; see SHATTER.victoryMs.
      victoryTimer = window.setTimeout(() => {
        if (shatterStage !== "crowning") return;
        shatterStage = "done";
        showResult();
      }, SHATTER.victoryMs);
    }

    /**
     * Step 6: the winner's panel swells, a gold ring sweeps it, confetti goes
     * up. Deliberately AFTER the last piece lands rather than alongside it —
     * the count-up is the reveal, and celebrating over the top of it would step
     * on the moment it exists to build.
     */
    function crownWinners() {
      if (!state || motionReduced()) return;
      const panels = root.querySelectorAll<HTMLElement>("#scoreboard .player");
      for (const index of state.winners) {
        const panel = panels[index];
        if (!panel) continue;
        panel.classList.add("crowned");
        // Thrown from the panel, in the winner's own colour and the table's
        // gold, so it reads as their celebration rather than as generic party.
        const color = players[index]?.color ?? "#FFC24B";
        for (let i = 0; i < 12; i++) {
          const bit = document.createElement("span");
          bit.className = "confetti";
          const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
          const reach = 34 + Math.random() * 30;
          bit.style.setProperty("--dx", `${Math.cos(angle) * reach}px`);
          // Biased upward: confetti is thrown, not dropped.
          bit.style.setProperty("--dy", `${Math.sin(angle) * reach - 22}px`);
          bit.style.setProperty("--spin", `${Math.round((Math.random() - 0.5) * 540)}deg`);
          bit.style.background = i % 2 === 0 ? color : "#FFC24B";
          bit.style.animationDelay = `${Math.round(Math.random() * 120)}ms`;
          panel.appendChild(bit);
        }
        // The DOM does not clean itself up, and a rematch reuses these panels.
        window.setTimeout(() => {
          for (const bit of panel.querySelectorAll(".confetti")) bit.remove();
        }, 1200);
      }
    }

    /** A rematch puts a live board back; the endgame has to be rearmed for it. */
    function resetShatter() {
      shatter.reset();
      window.clearTimeout(victoryTimer);
      shatterStage = "idle";
      flightScores = null;
      crackPlayed = false;
      fanfarePlayed = false;
      gameEl.classList.remove("shattering");
      shatterCtx?.clearRect(0, 0, shatterCanvas.width, shatterCanvas.height);
      for (const panel of root.querySelectorAll<HTMLElement>("#scoreboard .player")) {
        panel.classList.remove("crowned", "landed");
        for (const bit of panel.querySelectorAll(".confetti")) bit.remove();
      }
    }

    const spectating = myIndex < 0;

    const isMyTurn = () =>
      !spectating &&
      !!state &&
      state.phase === "playing" &&
      !state.paused &&
      currentPlayer(state) === myIndex &&
      pending === null;

    const detach = attachPointer(boardHost, {
      getLayout: () => renderer.layout,
      isLegal: (lineId) => !!state && canPlace(state, lineId),
      canAct: isMyTurn,
      confirmTap: n >= CONFIRM_TAP_FROM_GRID,
      onGhost(lineId) {
        ghost = lineId;
        stage.requestFrame();
      },
      onAmbiguous() {
        toast("Too close to call — aim a little");
      },
      onCommit(lineId) {
        if (!state || !isMyTurn()) return;
        setPending(lineId);
        ghost = null;
        net.send({ t: "move", lineId, turnSeq: state.turnSeq });
        stage.requestFrame();
      },
    });

    // Animations fire when the SERVER confirms a move, not when we send one.
    onMoveRendered = (lineId, claimed) => {
      const now = performance.now();
      if (pending === lineId) setPending(null);
      renderer.animateLine(lineId, now);
      for (const box of claimed) renderer.animateBox(box, now);

      // Everyone hears every move — that is what makes it feel like one table
      // rather than four people staring at four phones.
      play("tick");
      // One line can close two boxes. Spaced by 70ms so it lands as a
      // double-take rather than as one louder click.
      claimed.forEach((_, i) => play("click", { delay: i * 0.07 }));

      stage.requestFrame();
    };

    onShrinkRendered = (shrink) => {
      renderer.animateBurn(shrink, performance.now());
      stage.requestFrame();
    };

    retractPending = () => {
      setPending(null);
      stage.requestFrame();
    };

    resetAnimations = () => {
      // After a reconnect the board may have moved on by several lines. Snap
      // every in-flight tween to its end state rather than animating history.
      renderer.reset();
      setPending(null);
      ghost = null;
      stage.requestFrame();
    };

    let warned = false;
    let warnedForSeq = -1;

    const clock = window.setInterval(() => {
      if (!room || !state) return;
      const deadline = room.turnDeadline;
      const left = deadline === null ? 0 : Math.max(0, (deadline - net.now()) / 1000);

      if (state.turnSeq !== warnedForSeq) {
        warnedForSeq = state.turnSeq;
        warned = false;
      }
      if (
        !warned &&
        deadline !== null &&
        left <= WARN_AT_SECONDS_REMAINING &&
        isMyTurn()
      ) {
        warned = true;
        // Absent on iOS Safari; the pill and amber ring carry it there.
        navigator.vibrate?.(40);
        play("blip");
        showPill(`${Math.ceil(left)}s`);
      }

      scoreboard.update({
        // While pieces are in the air the counters belong to the shatter —
        // they climb from `harvested` to the real score as each one lands, and
        // the clock tick must not overwrite them with the final total.
        scores: flightScores ?? state.scores,
        benched: state.benched,
        charges: state.charges,
        armed: state.armed,
        current: currentPlayer(state),
        clockFraction: clockFraction(left, state),
        secondsLeft: left,
        paused: state.paused,
        over: state.phase === "over",
        winners: state.winners,
      });
    }, CLOCK_TICK_MS);

    const shrinkChip = root.querySelector<HTMLElement>("#shrink");
    const burnWarning = root.querySelector<HTMLElement>("#burn-warning");
    const burnCount = root.querySelector<HTMLElement>("#burn-count");
    const burnRing = root.querySelector<SVGCircleElement>(".bw-ring");

    /**
     * Visible countdown, so a collapse is something you plan for, not a
     * surprise. Two forms on purpose, because they are read at different
     * moments:
     *
     * - the flame badge sits ON the board, where the eyes already are, and is
     *   readable at a glance mid-turn — a drained ring means "this round";
     * - the chip spells it out in words for anyone who looks down at the row.
     *
     * The badge exists because the chip alone was missed entirely in the
     * 2026-08-03 playtest: 0.7rem of dim text in a row nobody was looking at.
     */
    function updateShrinkChip() {
      if (!state) return;
      const rounds = roundsUntilCollapse(state);

      if (shrinkChip) {
        if (rounds === null) {
          shrinkChip.textContent = "";
          shrinkChip.className = "shrink-chip";
        } else {
          shrinkChip.textContent =
            rounds <= 1 ? "Board shrinks NEXT round" : `Board shrinks in ${rounds}`;
          shrinkChip.className = `shrink-chip visible${rounds <= 1 ? " imminent" : ""}`;
        }
      }

      if (!burnWarning || !burnCount || !burnRing) return;
      if (rounds === null) {
        burnWarning.hidden = true;
        return;
      }
      burnWarning.hidden = false;
      // "1" reads as a countdown; the badge going red is what says "now".
      burnCount.textContent = rounds <= 0 ? "!" : String(rounds);
      burnWarning.classList.toggle("imminent", rounds <= 1);
      burnWarning.title =
        rounds <= 1 ? "The outer ring burns next round" : `The outer ring burns in ${rounds}`;
      // Drains as it closes in: full at two rounds out, empty when it is due.
      const fraction = Math.max(0, Math.min(1, rounds / SHRINK_INTERVAL_ROTATIONS));
      burnRing.style.strokeDashoffset = String(BURN_RING_CIRCUMFERENCE * (1 - fraction));
    }

    const buyBtn = root.querySelector<HTMLButtonElement>("#buy");
    const armBtn = root.querySelector<HTMLButtonElement>("#arm");
    const nudge = root.querySelector<HTMLElement>("#shop-nudge");
    buyBtn?.addEventListener("click", () => {
      dismissNudge();
      net.send({ t: "buy" });
    });
    armBtn?.addEventListener("click", () => net.send({ t: "arm" }));

    /*
     * The Wildcard went completely unnoticed in the 2026-08-03 playtest — a
     * chip reading "Wildcard · 10" that is disabled and dim for the first ten
     * minutes of a game teaches nobody it exists.
     *
     * So the first time you can actually afford one, say so. Once per game,
     * five seconds, and never again: a prompt that keeps returning stops being
     * information and becomes nagging.
     *
     * Deliberately NOT a buy button. It appears unprompted right where a thumb
     * already is, and spending ten hard-won squares on a mis-tap is exactly the
     * kind of thing that would make someone put the game down. It points; the
     * real button, which you have to aim at, still does the spending.
     */
    let nudgeState: "unseen" | "showing" | "done" = "unseen";
    let nudgeTimer = 0;

    function dismissNudge() {
      if (nudge) nudge.hidden = true;
      buyBtn?.classList.remove("nudged");
      window.clearTimeout(nudgeTimer);
      if (nudgeState === "showing") nudgeState = "done";
    }

    function maybeNudge(affordable: boolean) {
      if (!nudge || nudgeState !== "unseen") return;
      if (!affordable) return;
      nudgeState = "showing";
      nudge.hidden = false;
      buyBtn?.classList.add("nudged");
      nudgeTimer = window.setTimeout(dismissNudge, NUDGE_MS);
    }

    nudge?.addEventListener("click", dismissNudge);

    /**
     * In twist mode the powerup row is present from the first frame and simply
     * greys out when unusable. It never leaves the layout — see the layout rule
     * above.
     */
    function updateShop() {
      if (!buyBtn || !armBtn || !state) return;

      const score = state.scores[myIndex] ?? 0;
      const charges = state.charges[myIndex] ?? 0;
      const myTurn =
        !spectating && currentPlayer(state) === myIndex && state.phase === "playing";

      buyBtn.textContent = `Wildcard · ${WILDCARD_COST}`;
      buyBtn.disabled =
        !myTurn || score < WILDCARD_COST || charges >= MAX_WILDCARD_CHARGES;

      // Only once it is genuinely payable — pointing at a button that does
      // nothing when tapped is worse than saying nothing at all.
      maybeNudge(!buyBtn.disabled);
      if (charges > 0) dismissNudge();
      buyBtn.title = spectating
        ? "You are watching this game"
        : score < WILDCARD_COST
          ? `Costs ${WILDCARD_COST} boxes — you have ${score}`
          : `Burns ${WILDCARD_COST} of your boxes for one extra line`;

      armBtn.textContent = state.armed
        ? "Armed"
        : `Extra line${charges > 0 ? ` ×${charges}` : ""}`;
      armBtn.disabled = !myTurn || charges === 0 || state.armed;
      armBtn.classList.toggle("selected", state.armed);
    }

    const nowPlaying = root.querySelector<HTMLElement>("#now-playing")!;

    updateView = () => {
      if (!room || !state) return;
      syncBoardView();
      stage.requestFrame();
      updateShop();
      updateShrinkChip();

      const active = room.players[currentPlayer(state)];
      nowPlaying.textContent =
        state.phase === "over"
          ? "Game over"
          : state.paused
            ? "Waiting for players"
            : `Now playing · ${active?.name ?? "—"}`;
      nowPlaying.style.color = active
        ? (PLAYER_COLORS[active.colorIndex] ?? "")
        : "";

      // Connection state outranks everything: if we are offline, nothing else
      // on screen is trustworthy, so say so rather than showing a stale turn.
      if (status !== "open") {
        banner.textContent = status === "reconnecting" ? "Reconnecting…" : "Connecting…";
        banner.className = "turn-banner away";
        banner.onclick = null;
      } else if (spectating) {
        banner.textContent = "Watching — you're in the next game";
        banner.className = "turn-banner spectating";
        banner.onclick = null;
      }
      // Bench state comes from the replayed game state, not the room snapshot —
      // a timeout broadcasts a `move`, so `room.players[].benched` is stale
      // until the next full room broadcast.
      else if (state.benched[myIndex] === 1) {
        banner.textContent = "You're parked — tap to return";
        banner.className = "turn-banner parked";
        banner.onclick = () => net.send({ t: "wake" });
      } else if (state.paused) {
        banner.textContent = "Waiting for players";
        banner.className = "turn-banner";
        banner.onclick = null;
      } else if (isMyTurn() || pending !== null) {
        banner.textContent = "Your turn";
        banner.className = "turn-banner mine";
        banner.onclick = null;
      } else {
        const who = room.players[currentPlayer(state)]?.name ?? "";
        banner.textContent = `${who}'s turn`;
        banner.className = "turn-banner";
        banner.onclick = null;
      }

      /*
       * The result waits for the shatter, and ONLY for the shatter.
       *
       * `beginShatter` is the thing that decides whether there is one — reduced
       * motion, a spectator arriving after the fact and a mid-sequence reconnect
       * all resolve to "done" immediately, and then this shows the overlay on
       * the same tick it always did. Once shown, `showResult` keeps being called
       * so the rematch vote count stays live.
       */
      if (room.phase === "results" && state.phase === "over") {
        beginShatter();
        if (shatterStage === "done") showResult();
      } else {
        overlay.hidden = true;
        if (shatterStage !== "idle") resetShatter();
      }
    };

    function showResult() {
      if (!room || !state) return;

      if (overlay.hidden) {
        // Guarded by `overlay.hidden`, which is what makes this fire once at
        // the end of the game rather than on every rematch-vote refresh.
        // Usually already played, at the moment the winner was crowned — this
        // covers the paths that never ran a sequence to crown anyone through.
        playFanfare();
        const names = state.winners.map((w) => room!.players[w]?.name ?? "?").join(" & ");
        const top = state.scores[state.winners[0] ?? 0] ?? 0;
        overlay.hidden = false;
        overlay.innerHTML = `
          <div class="result">
            <p class="label">${state.winners.length > 1 ? "Draw" : "Winner"}</p>
            <h2>${escapeHtml(names)}</h2>
            <p class="score-line">${top} boxes</p>
            ${
              spectating
                ? '<p class="hint">You join the next game</p>'
                : '<button class="primary" id="rematch">Rematch</button>'
            }
            <p class="hint" id="votes"></p>
          </div>`;
        overlay
          .querySelector<HTMLElement>("#rematch")
          ?.addEventListener("click", () => net.send({ t: "rematch" }));
      }

      // Rematch is a vote — everyone still connected has to agree.
      const present = room.players.filter((p) => p.connected);
      const voted = present.filter((p) => p.ready);
      const button = overlay.querySelector<HTMLButtonElement>("#rematch");
      const self = room.players.find((p) => p.id === me);
      if (button) button.textContent = self?.ready ? "Waiting…" : "Rematch";

      const votes = overlay.querySelector<HTMLElement>("#votes");
      if (votes) {
        const waiting = present.filter((p) => !p.ready).map((p) => p.name);
        votes.textContent =
          voted.length === 0
            ? ""
            : waiting.length === 0
              ? "Starting…"
              : `${voted.length}/${present.length} ready · waiting for ${waiting.join(", ")}`;
      }
    }

    /*
     * The start sequence, but ONLY for a game that is actually starting.
     *
     * `linesPlaced === 0` is the test, and it is doing real work: it keeps the
     * performance away from a spectator arriving mid-game and from anyone
     * reconnecting, both of whom mount this same view onto a board that is
     * already half played. Ceremony there would be a lie about what is
     * happening, and it would hide a live board behind a logo.
     */
    let startSeq: StartSequence | null = null;
    if (state.linesPlaced === 0 && state.phase === "playing" && !motionReduced()) {
      gameEl.classList.add("entering");
      // Armed for the future: the board stays empty until the mark has landed.
      renderer.startEntrance(performance.now() + BOARD_START_OFFSET_MS);
      startSeq = playStartSequence({
        stage: gameEl,
        boardMs: entranceDurationMs(n + 1),
        onDone() {
          startSeq = null;
          gameEl.classList.remove("entering");
          stage.requestFrame();
        },
      });
      stage.requestFrame();
    }

    if (import.meta.env.DEV) {
      exposeDebug({
        state: () => state,
        layout: () => renderer.layout,
        drawNow: () => renderFrame(stage.ctx, performance.now()),
      });
    }

    disposeView = () => {
      // Cancelling still runs the hand-off, so navigating away mid-sequence
      // cannot leave the HUD stuck invisible behind a removed overlay.
      startSeq?.cancel();
      window.clearInterval(clock);
      window.clearTimeout(pendingTimer);
      window.clearTimeout(nudgeTimer);
      detach();
      stage.destroy();
      scoreboard.destroy();
    };
  }

  sync();

  return () => {
    disposeView?.();
    net.close();
  };
}

// -------------------------------------------------------------------- utils ---

/**
 * How full the ring is drawn. Asks the rules engine for the turn length rather
 * than restating 12 and 6 — the endgame doubles them (§6.3.2), and a hardcoded
 * total would leave the ring pinned at full for the first half of the turn.
 */
function clockFraction(secondsLeft: number, state: GameState): number {
  return Math.max(0, Math.min(1, secondsLeft / turnSecondsFor(state)));
}

let toastTimer = 0;
function toast(text: string) {
  const el = document.querySelector<HTMLElement>("#toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 1600);
}

let pillTimer = 0;
function showPill(text: string) {
  const el = document.querySelector<HTMLElement>("#pill");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  window.clearTimeout(pillTimer);
  pillTimer = window.setTimeout(() => el.classList.remove("show"), 700);
}

function escapeHtml(raw: string): string {
  return raw.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/**
 * The Wildcard price, shown only while it is actually payable: your turn, in
 * twist, affordable, and you are not already holding the maximum. Outside that
 * it is noise on a board people are trying to read.
 */
function costPreviewFor(s: GameState, playerIndex: number): number[] {
  if (s.mode !== "twist" || s.phase !== "playing") return [];
  if (playerIndex < 0 || playerIndex !== currentPlayer(s)) return [];
  if (s.charges[playerIndex] >= MAX_WILDCARD_CHARGES) return [];
  if (s.scores[playerIndex] < WILDCARD_COST) return [];
  return wildcardCostPreview(s, playerIndex);
}
