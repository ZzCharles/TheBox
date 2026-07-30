/**
 * Hot-seat play on one device. No networking — this exists to prove the board,
 * the input, and the pacing before M3 puts a server behind them.
 *
 * The shot clock here is LOCAL and throwaway. M3 replaces it with an absolute
 * deadline broadcast by the Durable Object; it lives here now only so the
 * 12s/6s split can be felt on a real phone.
 */

import {
  gridSizeFor,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  WARN_AT_SECONDS_REMAINING,
} from "../../shared/constants.ts";
import {
  applyMove,
  canPlace,
  createGame,
  currentPlayer,
  skipTurn,
  turnSecondsFor,
} from "../../shared/rules.ts";
import { exposeDebug } from "../devtools.ts";
import { attachPointer } from "../input/pointer.ts";
import {
  createBoardRenderer,
  type BoardView,
  type PlayerView,
} from "../render/boardRenderer.ts";
import { CONFIRM_TAP_FROM_GRID } from "../render/layout.ts";
import { createStage, type Stage } from "../render/stage.ts";
import { createScoreboard, type Scoreboard } from "./scoreboard.ts";

const INITIALS = "ABCDEFGH";
const CLOCK_TICK_MS = 50;

/** Returns a disposer, so the router can tear the game down on navigation. */
export function mountHotseat(root: HTMLElement): () => void {
  let active: (() => void) | null = null;
  const setActive = (fn: (() => void) | null) => {
    active = fn;
  };
  renderSetup(root, setActive);
  return () => {
    active?.();
    active = null;
  };
}

type SetActive = (fn: (() => void) | null) => void;

// ------------------------------------------------------------------ setup ---

function renderSetup(root: HTMLElement, setActive: SetActive) {
  setActive(null);
  root.innerHTML = `
    <main class="setup">
      <h1>BOX</h1>
      <p class="tag">hot seat &middot; one device</p>

      <section>
        <h2>Players</h2>
        <div class="chips" id="counts"></div>
      </section>

      <section>
        <h2>Mode</h2>
        <div class="chips">
          <button class="chip selected" disabled>Simple</button>
          <button class="chip" disabled title="Arrives in M5">Twist &middot; soon</button>
        </div>
      </section>

      <button class="primary" id="play">Play</button>
      <p class="hint" id="hint"></p>
      <button class="linkish" id="back">Play online instead</button>
    </main>
  `;

  root.querySelector<HTMLElement>("#back")!.addEventListener("click", () => {
    location.hash = "#/";
  });

  const counts = root.querySelector<HTMLElement>("#counts")!;
  const hint = root.querySelector<HTMLElement>("#hint")!;
  let selected = 4;

  for (let p = MIN_PLAYERS; p <= MAX_PLAYERS; p++) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = String(p);
    chip.addEventListener("click", () => {
      selected = p;
      counts.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      updateHint();
    });
    counts.appendChild(chip);
  }

  function updateHint() {
    const n = gridSizeFor(selected);
    hint.textContent = `${n}×${n} board · ${n * n} boxes · ${2 * n * (n + 1)} lines`;
  }

  counts.children[selected - MIN_PLAYERS]?.classList.add("selected");
  updateHint();

  root.querySelector<HTMLElement>("#play")!.addEventListener("click", () => {
    startGame(root, selected, setActive);
  });
}

// ------------------------------------------------------------------- game ---

function startGame(root: HTMLElement, playerCount: number, setActive: SetActive) {
  const n = gridSizeFor(playerCount);
  const players: PlayerView[] = Array.from({ length: playerCount }, (_, i) => ({
    name: `Player ${i + 1}`,
    initial: INITIALS[i]!,
    color: PLAYER_COLORS[i]!,
  }));

  let state = createGame({ n, mode: "simple", playerCount });

  root.innerHTML = `
    <div class="game">
      <div id="scoreboard"></div>
      <div class="board-wrap"><div class="board" id="board"></div></div>
      <div class="pill" id="pill"></div>
      <div class="toast" id="toast"></div>
      <div class="overlay" id="overlay" hidden></div>
    </div>
  `;

  const boardHost = root.querySelector<HTMLElement>("#board")!;
  const pill = root.querySelector<HTMLElement>("#pill")!;
  const toastEl = root.querySelector<HTMLElement>("#toast")!;
  const overlay = root.querySelector<HTMLElement>("#overlay")!;

  const scoreboard: Scoreboard = createScoreboard(
    root.querySelector<HTMLElement>("#scoreboard")!,
    players,
  );

  const renderer = createBoardRenderer(
    boardHost.clientWidth || 320,
    boardHost.clientHeight || 320,
    n,
  );

  let ghost: number | null = null;
  const view: BoardView = {
    state,
    players,
    ghost: null,
    ghostColor: players[0]!.color,
  };

  function syncView() {
    view.state = state;
    view.ghost = ghost;
    view.ghostColor = players[currentPlayer(state)]?.color ?? players[0]!.color;
  }

  const stage: Stage = createStage(
    boardHost,
    (ctx, now) => {
      syncView();
      return renderer.draw(ctx, now, view);
    },
    (s) => renderer.resize(s.width, s.height, state.n),
  );

  if (import.meta.env.DEV) {
    // Lets a headless/hidden tab render a frame — requestAnimationFrame does
    // not run while document.visibilityState is "hidden".
    exposeDebug({
      state: () => state,
      layout: () => renderer.layout,
      drawNow: () => {
        syncView();
        renderer.draw(stage.ctx, performance.now(), view);
      },
    });
  }

  // ----------------------------------------------------------- shot clock ---

  let turnStartedAt = performance.now();
  let turnMs = turnSecondsFor(state) * 1000;
  let warned = false;

  function beginTurn() {
    turnStartedAt = performance.now();
    turnMs = turnSecondsFor(state) * 1000;
    warned = false;
  }

  function secondsLeft(now: number) {
    return Math.max(0, (turnMs - (now - turnStartedAt)) / 1000);
  }

  const clock = window.setInterval(() => {
    if (state.phase === "over") return;
    const now = performance.now();
    const left = secondsLeft(now);

    if (!warned && left <= WARN_AT_SECONDS_REMAINING) {
      warned = true;
      // Feature-detected: iOS Safari has no Vibration API, so the pill and the
      // amber ring have to carry the warning on their own.
      navigator.vibrate?.(40);
      showPill(`${WARN_AT_SECONDS_REMAINING}s`);
    }

    if (left <= 0) {
      const result = skipTurn(state, currentPlayer(state));
      if (result.ok) {
        toast(result.value.benched ? "Parked — tap to return" : "Time");
        beginTurn();
      }
    }

    refreshScoreboard(now);
  }, CLOCK_TICK_MS);

  function refreshScoreboard(now: number) {
    scoreboard.update({
      scores: state.scores,
      benched: state.benched,
      current: currentPlayer(state),
      clockFraction: turnMs > 0 ? Math.max(0, (turnMs - (now - turnStartedAt)) / turnMs) : 0,
      secondsLeft: secondsLeft(now),
      paused: state.paused,
      over: state.phase === "over",
      winners: state.winners,
    });
  }

  // ---------------------------------------------------------------- input ---

  const detach = attachPointer(boardHost, {
    getLayout: () => renderer.layout,
    isLegal: (lineId) => canPlace(state, lineId),
    canAct: () => state.phase === "playing" && !state.paused,
    confirmTap: n >= CONFIRM_TAP_FROM_GRID,
    onGhost(lineId) {
      ghost = lineId;
      stage.requestFrame();
    },
    onAmbiguous() {
      toast("Too close to call — aim a little");
    },
    onCommit(lineId) {
      const player = currentPlayer(state);
      const result = applyMove(state, player, lineId);
      if (!result.ok) {
        toast(result.reason.replace(/-/g, " "));
        return;
      }

      const now = performance.now();
      ghost = null;
      renderer.animateLine(lineId, now);
      for (const box of result.value.claimed) renderer.animateBox(box, now);
      stage.requestFrame();

      beginTurn();
      refreshScoreboard(now);

      if (result.value.gameOver) finish();
    },
  });

  // ------------------------------------------------------------- feedback ---

  let pillTimer = 0;
  function showPill(text: string) {
    pill.textContent = text;
    pill.classList.add("show");
    window.clearTimeout(pillTimer);
    pillTimer = window.setTimeout(() => pill.classList.remove("show"), 700);
  }

  let toastTimer = 0;
  function toast(text: string) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 1400);
  }

  function finish() {
    window.clearInterval(clock);
    const names = state.winners.map((w) => players[w]!.name).join(" & ");
    const top = state.scores[state.winners[0] ?? 0] ?? 0;

    overlay.hidden = false;
    overlay.innerHTML = `
      <div class="result">
        <p class="label">${state.winners.length > 1 ? "Draw" : "Winner"}</p>
        <h2>${names}</h2>
        <p class="score-line">${top} boxes</p>
        <button class="primary" id="again">Play again</button>
      </div>
    `;
    overlay.querySelector<HTMLElement>("#again")!.addEventListener("click", () => {
      teardown();
      renderSetup(root, setActive);
    });

    refreshScoreboard(performance.now());
  }

  function teardown() {
    window.clearInterval(clock);
    window.clearTimeout(pillTimer);
    window.clearTimeout(toastTimer);
    detach();
    stage.destroy();
    scoreboard.destroy();
  }

  setActive(teardown);
  beginTurn();
  refreshScoreboard(performance.now());
  stage.requestFrame();
}
