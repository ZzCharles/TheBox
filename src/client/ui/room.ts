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
  canPlace,
  currentPlayer,
  skipTurn,
  type GameState,
} from "../../shared/rules.ts";
import { exposeDebug } from "../devtools.ts";
import { attachPointer } from "../input/pointer.ts";
import { clientId, storedName } from "../net/identity.ts";
import { connect, type Net, type NetStatus } from "../net/socket.ts";
import {
  createBoardRenderer,
  type BoardRenderer,
  type BoardView,
  type PlayerView,
} from "../render/boardRenderer.ts";
import { CONFIRM_TAP_FROM_GRID } from "../render/layout.ts";
import { createStage, type Stage } from "../render/stage.ts";
import { createScoreboard, type Scoreboard } from "./scoreboard.ts";

const CLOCK_TICK_MS = 50;

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

      case "error":
        toast(msg.message);
        if (msg.code === "bad-protocol") location.reload();
        return;

      default:
        return;
    }
    sync();
  }

  function applyBroadcastMove(msg: Extract<ServerMessage, { t: "move" }>) {
    if (!state || !room) return;

    const result = applyMove(state, msg.playerIndex, msg.lineId);
    if (!result.ok) {
      // We are out of step with the server. Re-introducing ourselves returns a
      // full snapshot, which is cheaper than trying to reconcile.
      resync();
      return;
    }

    room.turnDeadline = msg.turn.turnDeadline;
    onMoveRendered?.(msg.lineId, result.value.claimed);

    if (import.meta.env.DEV) {
      const drift = msg.scores.some((s, i) => s !== state!.scores[i]);
      if (drift) console.warn("[box] score divergence from server", msg.scores);
    }
  }

  /**
   * Replay a timeout locally through the same `skipTurn` the server ran, rather
   * than asking for a fresh snapshot. Keeps bench flags and turn order in
   * lockstep with no extra round-trip.
   */
  function applyBroadcastSkip(msg: Extract<ServerMessage, { t: "skip" }>) {
    if (!state || !room) return;
    const result = skipTurn(state, msg.playerIndex);
    if (!result.ok || state.turnSeq !== msg.turn.turnSeq) {
      resync();
      return;
    }
    room.turnDeadline = msg.turn.turnDeadline;
  }

  function resync() {
    net.send({
      t: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientId: me,
      name: storedName() || "Player",
    });
  }

  /** Set by the game view so board animations can fire on broadcast moves. */
  let onMoveRendered: ((lineId: number, claimed: number[]) => void) | null = null;
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
        <h1>BOX</h1>
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
        <p class="tag">room code</p>
        <h1 class="code">${escapeHtml(code)}</h1>
        <button class="chip" id="share">Copy invite link</button>

        <section>
          <h2>Players <span id="count"></span></h2>
          <ul class="roster" id="roster"></ul>
          <p class="hint" id="watching"></p>
        </section>

        <p class="hint" id="grid"></p>
        <button class="primary" id="ready">I'm ready</button>
        <button class="primary" id="start" hidden>Start game</button>
        <p class="hint" id="lobby-status"></p>
      </main>`;

    const roster = root.querySelector<HTMLElement>("#roster")!;
    const count = root.querySelector<HTMLElement>("#count")!;
    const watching = root.querySelector<HTMLElement>("#watching")!;
    const grid = root.querySelector<HTMLElement>("#grid")!;
    const readyBtn = root.querySelector<HTMLButtonElement>("#ready")!;
    const startBtn = root.querySelector<HTMLButtonElement>("#start")!;
    const statusEl = root.querySelector<HTMLElement>("#lobby-status")!;

    readyBtn.addEventListener("click", () => {
      const self = room?.players.find((p) => p.id === me);
      net.send({ t: "ready", ready: !self?.ready });
    });
    startBtn.addEventListener("click", () => net.send({ t: "start" }));
    root.querySelector<HTMLElement>("#share")!.addEventListener("click", () => {
      void navigator.clipboard
        ?.writeText(location.href)
        .then(() => toast("Invite link copied"))
        .catch(() => toast(location.href));
    });

    updateView = () => {
      if (!room) return;
      const self = room.players.find((p) => p.id === me);
      const isHost = room.hostId === me;

      count.textContent = `${room.players.length}`;
      roster.innerHTML = room.players
        .map(
          (p) => `
        <li class="${p.ready ? "is-ready" : ""} ${p.connected ? "" : "is-away"}"
            style="--player-color:${PLAYER_COLORS[p.colorIndex] ?? "#888"}">
          <span class="dot"></span>
          <span class="who">${escapeHtml(p.name)}${p.id === me ? " (you)" : ""}</span>
          ${room!.hostId === p.id ? '<span class="badge">host</span>' : ""}
          <span class="state">${p.connected ? (p.ready ? "ready" : "…") : "away"}</span>
        </li>`,
        )
        .join("");

      watching.textContent = room.spectators.length
        ? `${room.spectators.map((s) => s.name).join(", ")} watching`
        : "";

      const n = room.config.gridSize || estimateGrid(room.players.length);
      grid.textContent = `${n}×${n} board · ${n * n} boxes`;

      readyBtn.textContent = self?.ready ? "Not ready" : "I'm ready";
      readyBtn.hidden = !self;
      startBtn.hidden = !isHost;

      const everyoneReady =
        room.players.length >= 2 && room.players.every((p) => !p.connected || p.ready);
      startBtn.disabled = !everyoneReady;
      statusEl.textContent = isHost
        ? everyoneReady
          ? ""
          : "Waiting for everyone to be ready"
        : "Waiting for the host to start";
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

    root.innerHTML = `
      <div class="game">
        <div id="scoreboard"></div>
        <div class="board-wrap"><div class="board" id="board"></div></div>
        <div class="turn-banner" id="banner"></div>
        <div class="pill" id="pill"></div>
        <div class="toast" id="toast"></div>
        <div class="overlay" id="overlay" hidden></div>
      </div>`;

    const boardHost = root.querySelector<HTMLElement>("#board")!;
    const banner = root.querySelector<HTMLElement>("#banner")!;
    const overlay = root.querySelector<HTMLElement>("#overlay")!;

    const scoreboard: Scoreboard = createScoreboard(
      root.querySelector<HTMLElement>("#scoreboard")!,
      players,
    );
    const renderer: BoardRenderer = createBoardRenderer(
      boardHost.clientWidth || 320,
      boardHost.clientHeight || 320,
      n,
    );

    let ghost: number | null = null;
    /** Line we have sent but not yet seen echoed back. */
    let pending: number | null = null;

    const boardView: BoardView = {
      state,
      players,
      ghost: null,
      ghostColor: players[myIndex]?.color ?? "#888",
    };

    function syncBoardView() {
      if (!state) return;
      boardView.state = state;
      boardView.ghost = ghost ?? pending;
      boardView.ghostColor = players[currentPlayer(state)]?.color ?? "#888";
    }

    const stage: Stage = createStage(
      boardHost,
      (ctx, now) => {
        syncBoardView();
        return renderer.draw(ctx, now, boardView);
      },
      (s) => renderer.resize(s.width, s.height, n),
    );

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
        pending = lineId;
        ghost = null;
        net.send({ t: "move", lineId, turnSeq: state.turnSeq });
        stage.requestFrame();
      },
    });

    // Animations fire when the SERVER confirms a move, not when we send one.
    onMoveRendered = (lineId, claimed) => {
      const now = performance.now();
      if (pending === lineId) pending = null;
      renderer.animateLine(lineId, now);
      for (const box of claimed) renderer.animateBox(box, now);
      stage.requestFrame();
    };

    resetAnimations = () => {
      // After a reconnect the board may have moved on by several lines. Snap
      // every in-flight tween to its end state rather than animating history.
      renderer.reset();
      pending = null;
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
        showPill(`${Math.ceil(left)}s`);
      }

      scoreboard.update({
        scores: state.scores,
        benched: state.benched,
        current: currentPlayer(state),
        clockFraction: clockFraction(left, state),
        secondsLeft: left,
        paused: state.paused,
        over: state.phase === "over",
        winners: state.winners,
      });
    }, CLOCK_TICK_MS);

    updateView = () => {
      if (!room || !state) return;
      syncBoardView();
      stage.requestFrame();

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
      // a timeout only broadcasts `skip`, so `room.players[].benched` is stale
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

      if (room.phase === "results" && state.phase === "over") showResult();
      else overlay.hidden = true;
    };

    function showResult() {
      if (!room || !state) return;

      if (overlay.hidden) {
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

    if (import.meta.env.DEV) {
      exposeDebug({
        state: () => state,
        layout: () => renderer.layout,
        drawNow: () => {
          syncBoardView();
          renderer.draw(stage.ctx, performance.now(), boardView);
        },
      });
    }

    disposeView = () => {
      window.clearInterval(clock);
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

function clockFraction(secondsLeft: number, state: GameState): number {
  const total = state.continuation ? 6 : 12;
  return Math.max(0, Math.min(1, secondsLeft / total));
}

function estimateGrid(players: number): number {
  return Math.min(10, Math.max(8, Math.round(Math.sqrt(players * 7 + 42))));
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
