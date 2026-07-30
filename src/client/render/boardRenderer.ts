/**
 * Draws the board: dots, lines, claimed boxes, and their animations.
 *
 * Everything is redrawn each frame rather than kept in dirty regions. At 10x10
 * that is ~450 primitives, which Canvas 2D eats for breakfast, and combined
 * with the stage's on-demand loop it costs nothing while idle.
 *
 * Two things keep it fast on mid-range phones:
 *   - dots are prerendered once into a sprite and blitted, instead of building
 *     a radial gradient per dot per frame;
 *   - lines and box fills are batched into ONE path per player, so `shadowBlur`
 *     is set ~8 times a frame instead of ~450.
 */

import { boxCol, boxRow } from "../../shared/board.ts";
import { COLOR_DOT, COLOR_DOT_GLOW, COLOR_SPENT } from "../../shared/constants.ts";
import { DEAD, SPENT, UNCLAIMED, type GameState } from "../../shared/rules.ts";
import {
  boxRect,
  computeLayout,
  dotX,
  dotY,
  lineSegment,
  type Layout,
} from "./layout.ts";
import { Animator, easeOutCubic, easeOutQuint, pulse } from "./tween.ts";

export const LINE_DRAW_MS = 140;
export const BOX_CLAIM_MS = 260;

const MAX_DPR = 2;

export interface PlayerView {
  name: string;
  initial: string;
  color: string;
}

export interface BoardView {
  state: GameState;
  players: PlayerView[];
  /** Line under a drag preview or awaiting a confirm tap. */
  ghost: number | null;
  /** Colour for the ghost — the current player's. */
  ghostColor: string;
  /**
   * Boxes about to be destroyed by the shrinking board. They pulse red for a
   * full rotation before collapsing; empty when no collapse is pending.
   */
  doomed: number[];
}

export interface BoardRenderer {
  readonly layout: Layout;
  resize(width: number, height: number, n: number): void;
  animateLine(lineId: number, now: number): void;
  animateBox(boxId: number, now: number): void;
  reset(): void;
  /** Returns true while animations are still running. */
  draw(ctx: CanvasRenderingContext2D, now: number, view: BoardView): boolean;
}

export function createBoardRenderer(
  width: number,
  height: number,
  n: number,
): BoardRenderer {
  const anim = new Animator();
  let layout = computeLayout(n, width, height);
  let dotSprite = makeDotSprite(layout);
  let viewW = width;
  let viewH = height;

  /**
   * Only the dots bordering live boxes are drawn, so the board visibly
   * contracts as the shrinking board eats the outer rings.
   */
  function drawDots(ctx: CanvasRenderingContext2D, { state }: BoardView) {
    const half = dotSprite.cssSize / 2;
    const { r0, c0, r1, c1 } = state.bounds;
    if (r0 > r1 || c0 > c1) return;

    for (let r = r0; r <= r1 + 1; r++) {
      for (let c = c0; c <= c1 + 1; c++) {
        ctx.drawImage(
          dotSprite.canvas,
          dotX(layout, c) - half,
          dotY(layout, r) - half,
          dotSprite.cssSize,
          dotSprite.cssSize,
        );
      }
    }
  }

  /** Red pulse over the ring that is one rotation from collapsing. */
  function drawDoomed(ctx: CanvasRenderingContext2D, now: number, view: BoardView) {
    if (view.doomed.length === 0) return;
    const beat = 0.5 + 0.5 * Math.sin(now / 260);

    ctx.save();
    ctx.fillStyle = "#F87171";
    ctx.strokeStyle = "#F87171";
    ctx.lineWidth = 1;
    for (const box of view.doomed) {
      const { x, y, w, h } = boxRect(
        layout,
        boxRow(layout.n, box),
        boxCol(layout.n, box),
      );
      ctx.globalAlpha = 0.1 + 0.22 * beat;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.25 + 0.45 * beat;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    ctx.restore();
  }

  function drawBoxes(
    ctx: CanvasRenderingContext2D,
    now: number,
    { state, players }: BoardView,
  ) {
    const fills: Array<Path2D | null> = new Array(players.length).fill(null);
    let spentPath: Path2D | null = null;
    const pulsing: number[] = [];

    for (let box = 0; box < state.boxes.length; box++) {
      const owner = state.boxes[box];
      if (owner === UNCLAIMED || owner === DEAD) continue;

      if (anim.has(`box:${box}`)) {
        pulsing.push(box);
        continue;
      }

      const { x, y, w, h } = boxRect(layout, boxRow(layout.n, box), boxCol(layout.n, box));
      if (owner === SPENT) {
        spentPath ??= new Path2D();
        spentPath.rect(x, y, w, h);
      } else {
        let path = fills[owner];
        if (!path) fills[owner] = path = new Path2D();
        path.rect(x, y, w, h);
      }
    }

    // Burned boxes: flat, dead, no glow. They should read as absent.
    if (spentPath) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLOR_SPENT;
      ctx.fill(spentPath);
    }

    for (let p = 0; p < fills.length; p++) {
      const path = fills[p];
      if (!path) continue;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = players[p]!.color;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;

    // Initials, drawn after all fills so the font is set once.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(layout.cell * 0.42)}px ui-sans-serif, system-ui, sans-serif`;
    for (let box = 0; box < state.boxes.length; box++) {
      const owner = state.boxes[box];
      if (owner < 0 || anim.has(`box:${box}`)) continue;
      drawInitial(ctx, box, owner, players, 1);
    }

    // Pulsing boxes scale about their centre, so each needs its own transform.
    for (const box of pulsing) {
      const owner = state.boxes[box];
      const t = anim.rawValue(`box:${box}`, now);
      const scale = 0.85 + 0.21 * easeOutQuint(t) + 0.06 * pulse(t);
      const { x, y, w, h } = boxRect(layout, boxRow(layout.n, box), boxCol(layout.n, box));

      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(scale, scale);
      ctx.translate(-(x + w / 2), -(y + h / 2));

      if (owner === SPENT) {
        ctx.fillStyle = COLOR_SPENT;
        ctx.fillRect(x, y, w, h);
      } else {
        const color = players[owner]!.color;
        ctx.globalAlpha = 0.16 + 0.34 * pulse(t);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        // The initial fades in over the back half of the pulse.
        drawInitial(ctx, box, owner, players, Math.max(0, (t - 0.4) / 0.6));
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawInitial(
    ctx: CanvasRenderingContext2D,
    box: number,
    owner: number,
    players: PlayerView[],
    alpha: number,
  ) {
    if (alpha <= 0) return;
    const player = players[owner];
    if (!player) return;
    const { x, y, w, h } = boxRect(layout, boxRow(layout.n, box), boxCol(layout.n, box));
    ctx.globalAlpha = 0.7 * alpha;
    ctx.fillStyle = player.color;
    ctx.fillText(player.initial, x + w / 2, y + h / 2 + layout.cell * 0.02);
    ctx.globalAlpha = 1;
  }

  function drawLines(
    ctx: CanvasRenderingContext2D,
    now: number,
    { state, players }: BoardView,
  ) {
    const paths: Array<Path2D | null> = new Array(players.length).fill(null);

    for (let id = 0; id < state.lines.length; id++) {
      const owner = state.lines[id];
      if (owner === 0) continue;
      const p = owner - 1;

      let path = paths[p];
      if (!path) paths[p] = path = new Path2D();

      const { x0, y0, x1, y1 } = lineSegment(layout, id);
      const t = anim.value(`line:${id}`, now);
      path.moveTo(x0, y0);
      path.lineTo(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }

    ctx.lineCap = "round";
    ctx.lineWidth = layout.lineWidth;
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p];
      if (!path) continue;
      const color = players[p]!.color;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = layout.lineWidth * 2.2;
      ctx.globalAlpha = 0.35;
      ctx.stroke(path);
      // Second pass at full opacity, no shadow: crisp core over a soft glow.
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawGhost(ctx: CanvasRenderingContext2D, view: BoardView) {
    if (view.ghost === null) return;
    const { x0, y0, x1, y1 } = lineSegment(layout, view.ghost);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = layout.lineWidth;
    ctx.strokeStyle = view.ghostColor;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([layout.cell * 0.12, layout.cell * 0.1]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  return {
    get layout() {
      return layout;
    },

    resize(w, h, nextN) {
      viewW = w;
      viewH = h;
      layout = computeLayout(nextN, w, h);
      dotSprite = makeDotSprite(layout);
    },

    animateLine(lineId, now) {
      anim.start(`line:${lineId}`, now, LINE_DRAW_MS, easeOutCubic);
    },

    animateBox(boxId, now) {
      anim.start(`box:${boxId}`, now, BOX_CLAIM_MS, easeOutCubic);
    },

    reset() {
      anim.clear();
    },

    draw(ctx, now, view) {
      // Cleared in CSS pixels — the context is already DPR-scaled.
      ctx.clearRect(0, 0, viewW, viewH);

      drawBoxes(ctx, now, view);
      drawDoomed(ctx, now, view);
      drawLines(ctx, now, view);
      drawGhost(ctx, view);
      drawDots(ctx, view);

      // The doomed pulse is time-driven rather than tween-driven, so it has to
      // keep asking for frames on its own.
      return anim.update(now) || view.doomed.length > 0;
    },
  };
}

/**
 * Prerender one dot — core plus glow — so the hot loop is `drawImage` rather
 * than a fresh radial gradient per dot per frame.
 */
function makeDotSprite(layout: Layout): {
  canvas: HTMLCanvasElement;
  cssSize: number;
} {
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const glow = layout.dotRadius * 2.6;
  const cssSize = Math.ceil((layout.dotRadius + glow) * 2);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cssSize * dpr);
  canvas.height = Math.ceil(cssSize * dpr);

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const c = cssSize / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, cssSize / 2);
  gradient.addColorStop(0, COLOR_DOT_GLOW);
  gradient.addColorStop(0.28, `${COLOR_DOT_GLOW}55`);
  gradient.addColorStop(1, `${COLOR_DOT_GLOW}00`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, cssSize, cssSize);

  ctx.beginPath();
  ctx.arc(c, c, layout.dotRadius, 0, Math.PI * 2);
  ctx.fillStyle = COLOR_DOT;
  ctx.fill();

  return { canvas, cssSize };
}
