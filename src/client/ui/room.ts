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
  type GameState,
} from "../../shared/rules.ts";
import {
  BOARD_PRESETS,
  estimatedMinutes,
  GRAND_MIN_PLAYERS,
  gridSizeFor,
  presetAllowed,
  MAX_WILDCARD_CHARGES,
  MIN_PLAYERS,
  WILDCARD_COST,
} from "../../shared/constants.ts";
import { exposeDebug } from "../devtools.ts";
import { attachPointer } from "../input/pointer.ts";
import { clientId, ownerKey, prefs, storedName } from "../net/identity.ts";
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
import { wordmark } from "./wordmark.ts";

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
    if (msg.shrink) announceShrink(msg.shrink);
    if (msg.wildcardFired) {
      toast(`${room.players[msg.playerIndex]?.name ?? "Someone"} used a Wildcard`);
    }

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
    toast(
      msg.action === "bought"
        ? `${who} bought a Wildcard for ${WILDCARD_COST}`
        : `${who} armed a Wildcard`,
    );
  }

  /**
   * Say what players KEPT, not just what vanished. Claimed tiles in a
   * collapsing ring bank their points — phrasing it as pure loss made the
   * mechanic read as a punishment.
   */
  function announceShrink(shrink: { removedBoxes: number[]; harvested: unknown[] }) {
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
    if (msg.shrink) announceShrink(msg.shrink);
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
    root.querySelector<HTMLElement>("#share")!.addEventListener("click", () => {
      void navigator.clipboard
        ?.writeText(location.href)
        .then(() => toast("Invite link copied"))
        .catch(() => toast(location.href));
    });

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
        <div class="board-wrap"><div class="board" id="board"></div></div>
        ${
          twist
            ? `<div class="shop" id="shop">
                 <button class="chip" id="buy"></button>
                 <button class="chip" id="arm"></button>
                 <span class="shrink-chip" id="shrink"></span>
               </div>`
            : ""
        }
        <div class="turn-banner" id="banner"></div>
        <div class="pill" id="pill"></div>
        <div class="toast" id="toast"></div>
        <div class="overlay" id="overlay" hidden></div>
      </div>`;

    root.querySelector<HTMLElement>("#back")!.addEventListener("click", leaveGame);
    root.querySelector<HTMLElement>("#code-chip")!.addEventListener("click", () => {
      // navigator.clipboard is secure-context only, so this silently does
      // nothing over plain http on a LAN. Show the code either way.
      void navigator.clipboard
        ?.writeText(location.href)
        .then(() => toast("Invite link copied"))
        .catch(() => toast(`Room code ${code}`));
      if (!navigator.clipboard) toast(`Room code ${code}`);
    });

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

    const boardView: BoardView = {
      state,
      players,
      ghost: null,
      ghostColor: players[myIndex]?.color ?? "#888",
      doomed: [],
      costPreview: [],
    };

    function syncBoardView() {
      if (!state) return;
      boardView.state = state;
      boardView.ghost = ghost ?? pending;
      boardView.ghostColor = players[currentPlayer(state)]?.color ?? "#888";
      // Recomputed on state change, not per frame — the pulse itself is driven
      // by the clock inside the renderer.
      boardView.doomed = isShrinkWarning(state) ? ringBoxes(state) : [];
      // Only ever your own price — showing everyone's would be unreadable.
      boardView.costPreview = costPreviewFor(state, myIndex);
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

    /** Visible countdown, so a collapse is something you plan for, not a surprise. */
    function updateShrinkChip() {
      if (!shrinkChip || !state) return;
      const rounds = roundsUntilCollapse(state);
      if (rounds === null) {
        shrinkChip.textContent = "";
        shrinkChip.className = "shrink-chip";
        return;
      }
      shrinkChip.textContent =
        rounds <= 1 ? "Board shrinks NEXT round" : `Board shrinks in ${rounds}`;
      shrinkChip.className = `shrink-chip visible${rounds <= 1 ? " imminent" : ""}`;
    }

    const buyBtn = root.querySelector<HTMLButtonElement>("#buy");
    const armBtn = root.querySelector<HTMLButtonElement>("#arm");
    buyBtn?.addEventListener("click", () => net.send({ t: "buy" }));
    armBtn?.addEventListener("click", () => net.send({ t: "arm" }));

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
