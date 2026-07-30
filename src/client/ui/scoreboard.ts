/**
 * Player panels: score, whose turn it is, and the shot clock ring.
 *
 * Plain DOM. The board is canvas because it animates; this is text and a couple
 * of rings, which the browser lays out better than we would.
 */

import { WARN_AT_SECONDS_REMAINING } from "../../shared/constants.ts";
import type { PlayerView } from "../render/boardRenderer.ts";

const RING_RADIUS = 21;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface ScoreboardState {
  scores: ArrayLike<number>;
  benched: ArrayLike<number>;
  /**
   * Wildcard charges held, per player. Shown to EVERYONE: knowing that someone
   * is holding a power is most of the tension, and a power nobody can see might
   * as well not exist.
   */
  charges: ArrayLike<number>;
  /** The current player has a Wildcard armed and ready to fire. */
  armed: boolean;
  current: number;
  /** Fraction of the turn remaining, 1 -> 0. */
  clockFraction: number;
  secondsLeft: number;
  paused: boolean;
  over: boolean;
  winners: number[];
}

export interface Scoreboard {
  update(state: ScoreboardState): void;
  destroy(): void;
}

export function createScoreboard(
  host: HTMLElement,
  players: PlayerView[],
): Scoreboard {
  host.innerHTML = "";
  host.className = "scoreboard";
  host.style.setProperty("--player-count", String(players.length));

  const panels = players.map((player, index) => {
    const panel = document.createElement("div");
    panel.className = "player";
    panel.style.setProperty("--player-color", player.color);
    panel.innerHTML = `
      <div class="avatar">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle class="ring-track" cx="24" cy="24" r="${RING_RADIUS}" />
          <circle class="ring-progress" cx="24" cy="24" r="${RING_RADIUS}"
                  stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="0" />
        </svg>
        <span class="initial">${player.initial}</span>
        <span class="wildcard-badge" hidden>✦</span>
      </div>
      <span class="score">0</span>
      <span class="name">${player.name}</span>
    `;
    host.appendChild(panel);

    return {
      panel,
      index,
      score: panel.querySelector<HTMLElement>(".score")!,
      progress: panel.querySelector<SVGCircleElement>(".ring-progress")!,
      badge: panel.querySelector<HTMLElement>(".wildcard-badge")!,
    };
  });

  return {
    update(state) {
      for (const p of panels) {
        const isActive = !state.over && !state.paused && p.index === state.current;
        const isBenched = state.benched[p.index] === 1;
        const isWinner = state.over && state.winners.includes(p.index);

        const charges = state.charges[p.index] ?? 0;
        // Arming SPENDS the charge, so `charges` alone would hide the badge at
        // the exact moment it matters most — the move it is about to fire on.
        const armedHere = isActive && state.armed;
        p.badge.hidden = charges === 0 && !armedHere;
        p.badge.textContent = charges > 1 ? `✦${charges}` : "✦";
        p.badge.classList.toggle("armed", armedHere);
        p.badge.title = armedHere
          ? "Extra line ready — fires on their next move"
          : charges > 0
            ? `Holding ${charges} extra line${charges > 1 ? "s" : ""}`
            : "";

        p.score.textContent = String(state.scores[p.index] ?? 0);
        p.panel.classList.toggle("active", isActive);
        p.panel.classList.toggle("benched", isBenched);
        p.panel.classList.toggle("winner", isWinner);
        p.panel.classList.toggle(
          "warning",
          isActive && state.secondsLeft <= WARN_AT_SECONDS_REMAINING,
        );
        p.panel.classList.toggle("critical", isActive && state.secondsLeft <= 2);

        // Ring drains clockwise from full.
        p.progress.style.strokeDashoffset = isActive
          ? String(RING_CIRCUMFERENCE * (1 - state.clockFraction))
          : String(RING_CIRCUMFERENCE);
      }
    },

    destroy() {
      host.innerHTML = "";
    },
  };
}
