/**
 * Draws the board: dots, lines, claimed boxes, and their animations.
 *
 * Everything is redrawn each frame rather than kept in dirty regions. At 10x10
 * that is ~450 primitives, which Canvas 2D eats for breakfast, and combined
 * with the stage's on-demand loop it costs nothing while idle.
 *
 * Two things keep it fast on mid-range phones, and both are load-bearing at
 * Grand size:
 *   - every dot appearance is prerendered once into a sprite and blitted,
 *     instead of building a radial gradient per dot per frame;
 *   - lines are batched into ONE path per player and stroked twice, halo then
 *     core, so the stroke count is ~16 a frame instead of ~450.
 */

import { boxCol, boxRow } from "../../shared/board.ts";
import {
  COLOR_DEAD,
  COLOR_DIM,
  COLOR_DOT,
  COLOR_GLOW,
  FIRE,
  SPENT_TILE,
} from "../../shared/constants.ts";
import { DEAD, SPENT, UNCLAIMED, type GameState } from "../../shared/rules.ts";
import {
  boxRect,
  computeLayout,
  dotX,
  dotY,
  lineSegment,
  type Layout,
} from "./layout.ts";
import { Animator, easeOutCubic } from "./tween.ts";

/**
 * Board painting values, tuned in `design/tiki-board.html`.
 *
 * Every size here is a FRACTION OF THE DOT GAP, never a pixel. That is the
 * whole trick behind a 12x12 board working on a phone: at a ~28px gap any fixed
 * pixel value turns the board into a solid mesh, while as fractions a Grand
 * board simply looks like a Small board seen from further away.
 */
const PAINT = {
  dot: {
    radius: 0.084,
    /** The one pixel floor in here — below this a dot stops reading as a dot. */
    minPx: 2,
    glow: 3.4,
    deadScale: 0.72,
    litScale: 1.28,
    litGlow: 1.2,
  },
  line: {
    width: 0.076,
    halo: 2.4,
    haloAlpha: 0.26,
    coreAlpha: 0.95,
    ghostAlpha: 0.28,
  },
  box: {
    inset: 0.125,
    radius: 0.095,
    fillTop: 0.237,
    fillBottom: 0.133,
    edgeAlpha: 0.53,
    /*
     * By label length. Most players get one letter, but a room of Sarahs and
     * Smiths grows them to two or three, and a three-letter label set at the
     * one-letter size runs straight out of its box.
     */
    initialByLength: [0.45, 0.32, 0.25],
    initialAlpha: 0.88,
    /** Letters sit high in their box optically; nudge them back down. */
    opticalNudge: 0.015,
  },
  ash: {
    /** Grey and quiet: still countable, never mistaken for a live square. */
    initialAlpha: 0.56,
  },
  doomed: {
    periodMs: 1200,
    base: 0.55,
    swing: 0.45,
  },
} as const;

/** Claim pulse: grow to 1.06 by this point, then settle back to 1. */
const CLAIM_PEAK = 0.42;
/** The initial only starts fading in once the square has mostly arrived. */
const CLAIM_INITIAL_FROM = 0.45;

export const LINE_DRAW_MS = 240;
export const BOX_CLAIM_MS = 160;

const MAX_DPR = 2;
const TAU = Math.PI * 2;

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
   * Boxes about to be destroyed by the shrinking board. Their dots cool to
   * ember and breathe for a full rotation before collapsing; empty when no
   * collapse is pending.
   */
  doomed: number[];
  /**
   * The squares a Wildcard would cost you right now, outlined in the metal they
   * would become. Empty unless you could actually buy one this instant — the
   * price is only worth showing while it is payable.
   */
  costPreview: number[];
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
  let dots = makeDotSprites(layout);
  let viewW = width;
  let viewH = height;
  /** Last font handed to the context, so identical sets are skipped. */
  let lastFont = "";

  /**
   * Dead things don't glow — everything alive on this board emits light, so the
   * absence of it is how death reads. A dot outside the live area shrinks and
   * goes flat, and it stays exactly where it always was: the board never moves,
   * which is what lets players keep counting their squares after a collapse.
   */
  function drawDots(ctx: CanvasRenderingContext2D, now: number, view: BoardView) {
    const { r0, c0, r1, c1 } = view.state.bounds;
    const hasLiveArea = r0 <= r1 && c0 <= c1;
    const ringDoomed = view.doomed.length > 0;
    const beat = 0.5 + 0.5 * Math.sin((now * TAU) / PAINT.doomed.periodMs);
    const doomedAlpha = PAINT.doomed.base + PAINT.doomed.swing * beat;

    for (let r = 0; r <= layout.n; r++) {
      for (let c = 0; c <= layout.n; c++) {
        const x = dotX(layout, c);
        const y = dotY(layout, r);
        const inside =
          hasLiveArea && r >= r0 && r <= r1 + 1 && c >= c0 && c <= c1 + 1;

        if (!inside) {
          blit(ctx, dots.dead, x, y);
          continue;
        }
        const onRing =
          ringDoomed && (r === r0 || r === r1 + 1 || c === c0 || c === c1 + 1);
        if (onRing) {
          ctx.globalAlpha = doomedAlpha;
          blit(ctx, dots.doomed, x, y);
          ctx.globalAlpha = 1;
        } else {
          blit(ctx, dots.live, x, y);
        }
      }
    }

    /*
     * The finger-lit pair. This matters more than anything else on the board:
     * when a thumb covers a quarter of it, the two white dots are what resolve
     * WHICH two dots you are about to connect.
     */
    if (view.ghost !== null) {
      const { x0, y0, x1, y1 } = lineSegment(layout, view.ghost);
      blit(ctx, dots.lit, x0, y0);
      blit(ctx, dots.lit, x1, y1);
    }
  }

  function drawBoxes(
    ctx: CanvasRenderingContext2D,
    now: number,
    { state, players }: BoardView,
  ) {
    const cell = layout.cell;
    const inset = cell * PAINT.box.inset;
    const size = cell - inset * 2;
    const radius = cell * PAINT.box.radius;

    // One gradient per player, reused across their squares by translating the
    // context — a gradient is defined in canvas space, so the alternative is
    // building one per square per frame.
    const gradients = players.map((p) => {
      const g = ctx.createLinearGradient(0, 0, 0, cell);
      g.addColorStop(0, withAlpha(p.color, PAINT.box.fillTop));
      g.addColorStop(1, withAlpha(p.color, PAINT.box.fillBottom));
      return g;
    });

    const owned: number[][] = players.map(() => []);
    /* Taken by the fire. Stays exactly where it was — the board never moves. */
    const ash: number[] = [];
    /* Traded for a Wildcard. Reads as metal, not damage. */
    const spent: number[] = [];
    const pulsing: number[] = [];

    for (let box = 0; box < state.boxes.length; box++) {
      const owner = state.boxes[box];
      if (owner === UNCLAIMED) continue;
      if (anim.has(`box:${box}`)) {
        pulsing.push(box);
        continue;
      }
      if (owner === DEAD) ash.push(box);
      else if (owner === SPENT) spent.push(box);
      else owned[owner]!.push(box);
    }

    const tile = (box: number) => {
      const { x, y } = boxRect(layout, boxRow(layout.n, box), boxCol(layout.n, box));
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.roundRect(inset, inset, size, size, radius);
    };

    // Ash: a shallow recess, darker than the table, with no light of its own.
    ctx.lineWidth = 1;
    for (const box of ash) {
      tile(box);
      ctx.fillStyle = FIRE.ashFill;
      ctx.fill();
      ctx.strokeStyle = FIRE.ashEdge;
      ctx.stroke();
      ctx.restore();
    }

    /*
     * Spent: a machined block. Lit from above like the primary button, with a
     * bright top bevel ash never has, so a trade never reads as fire damage.
     */
    if (spent.length > 0) {
      const metal = ctx.createLinearGradient(0, 0, 0, cell);
      metal.addColorStop(0, SPENT_TILE.top);
      metal.addColorStop(1, SPENT_TILE.bottom);
      for (const box of spent) {
        tile(box);
        ctx.fillStyle = metal;
        ctx.fill();
        ctx.strokeStyle = SPENT_TILE.edge;
        ctx.stroke();
        // The sheen: one bright pass along the top inner edge only.
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = SPENT_TILE.sheen;
        ctx.beginPath();
        ctx.moveTo(inset + radius, inset + 1);
        ctx.lineTo(inset + size - radius, inset + 1);
        ctx.stroke();
        ctx.restore();
        ctx.restore();
      }
    }

    ctx.lineWidth = 1;
    for (let p = 0; p < owned.length; p++) {
      const boxes = owned[p]!;
      if (boxes.length === 0) continue;
      const color = players[p]!.color;
      for (const box of boxes) {
        tile(box);
        ctx.fillStyle = gradients[p]!;
        ctx.fill();
        ctx.strokeStyle = withAlpha(color, PAINT.box.edgeAlpha);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Initials after all fills, so the font is set as few times as possible.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let box = 0; box < state.boxes.length; box++) {
      const owner = state.boxes[box];
      if (owner === UNCLAIMED || anim.has(`box:${box}`)) continue;

      /*
       * ASH keeps its letter; SPENT does not. Opposite meanings: a square the
       * fire took still counts for its owner, so it stays countable in grey. A
       * square spent on a Wildcard was paid away and counts for nobody — a
       * letter there would claim a point that is gone.
       */
      if (owner === SPENT) continue;
      if (owner === DEAD) {
        const was = state.formerOwner[box] ?? -1;
        const player = players[was];
        if (player) {
          drawInitial(ctx, box, player.initial, COLOR_DIM, PAINT.ash.initialAlpha);
        }
        continue;
      }
      drawInitial(
        ctx,
        box,
        players[owner]!.initial,
        players[owner]!.color,
        PAINT.box.initialAlpha,
      );
    }

    /*
     * Pulsing squares scale about their own centre, so each needs its own
     * transform and can't join a batch. There are never many at once — a single
     * line claims at most two.
     */
    for (const box of pulsing) {
      const owner = state.boxes[box];
      const t = anim.rawValue(`box:${box}`, now);
      const grown = t < CLAIM_PEAK;
      const scale = grown
        ? 0.85 + 0.21 * (t / CLAIM_PEAK)
        : 1.06 - 0.06 * easeOutCubic((t - CLAIM_PEAK) / (1 - CLAIM_PEAK));
      const fade = grown ? t / CLAIM_PEAK : 1;
      const { x, y, w, h } = boxRect(layout, boxRow(layout.n, box), boxCol(layout.n, box));
      const cx = x + w / 2;
      const cy = y + h / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);

      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.roundRect(inset, inset, size, size, radius);
      ctx.globalAlpha = fade;
      if (owner === SPENT) {
        ctx.fillStyle = FIRE.ashFill;
        ctx.fill();
        ctx.strokeStyle = FIRE.ashEdge;
      } else {
        const color = players[owner]!.color;
        ctx.fillStyle = withAlpha(color, PAINT.box.fillTop);
        ctx.fill();
        ctx.strokeStyle = withAlpha(color, PAINT.box.edgeAlpha);
      }
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      if (owner !== SPENT) {
        const p = (t - CLAIM_INITIAL_FROM) / (1 - CLAIM_INITIAL_FROM);
        const player = players[owner]!;
        drawInitial(
          ctx,
          box,
          player.initial,
          player.color,
          PAINT.box.initialAlpha * Math.min(1, Math.max(0, p)),
        );
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawInitial(
    ctx: CanvasRenderingContext2D,
    box: number,
    label: string,
    color: string,
    alpha: number,
  ) {
    if (alpha <= 0) return;
    const { x, y, w, h } = boxRect(layout, boxRow(layout.n, box), boxCol(layout.n, box));

    // Parsing a font string is not free, so only touch it when it changes —
    // in practice once or twice for a whole board.
    const font = initialFont(layout.cell, label.length);
    if (font !== lastFont) {
      ctx.font = font;
      lastFont = font;
    }

    // `alpha` is the FINAL opacity, not a multiplier — live letters and ash
    // letters have different targets and each caller states its own.
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillText(label, x + w / 2, y + h / 2 + layout.cell * PAINT.box.opticalNudge);
    ctx.globalAlpha = 1;
  }

  /**
   * Lines run dot centre to dot centre and are painted UNDER the dots, so each
   * dot sits on top like a rivet: squares close cleanly and the dots still read
   * as separate objects.
   */
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
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p];
      if (!path) continue;
      ctx.strokeStyle = players[p]!.color;
      ctx.lineWidth = layout.lineWidth * PAINT.line.halo;
      ctx.globalAlpha = PAINT.line.haloAlpha;
      ctx.stroke(path);
      ctx.lineWidth = layout.lineWidth;
      ctx.globalAlpha = PAINT.line.coreAlpha;
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The price of a Wildcard, before you pay it. Ten squares silently turning
   * grey looks arbitrary; showing which ten makes the rule explain itself.
   */
  function drawCostPreview(ctx: CanvasRenderingContext2D, view: BoardView) {
    if (view.costPreview.length === 0) return;
    const cell = layout.cell;
    const inset = cell * PAINT.box.inset;
    const size = cell - inset * 2;
    const radius = cell * PAINT.box.radius;

    ctx.save();
    ctx.strokeStyle = SPENT_TILE.edge;
    ctx.lineWidth = 1;
    ctx.setLineDash([cell * 0.08, cell * 0.06]);
    for (const box of view.costPreview) {
      const { x, y } = boxRect(layout, boxRow(layout.n, box), boxCol(layout.n, box));
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.roundRect(inset, inset, size, size, radius);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawGhost(ctx: CanvasRenderingContext2D, view: BoardView) {
    if (view.ghost === null) return;
    const { x0, y0, x1, y1 } = lineSegment(layout, view.ghost);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = layout.lineWidth;
    ctx.strokeStyle = view.ghostColor;
    ctx.globalAlpha = PAINT.line.ghostAlpha;
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
      dots = makeDotSprites(layout);
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
      drawCostPreview(ctx, view);
      drawLines(ctx, now, view);
      drawGhost(ctx, view);
      drawDots(ctx, now, view);

      // The doomed breath is time-driven rather than tween-driven, so it has to
      // keep asking for frames on its own.
      return anim.update(now) || view.doomed.length > 0;
    },
  };
}

// --------------------------------------------------------------- sprites ---

interface Sprite {
  canvas: HTMLCanvasElement;
  cssSize: number;
}

interface DotSprites {
  live: Sprite;
  dead: Sprite;
  doomed: Sprite;
  lit: Sprite;
}

function makeDotSprites(layout: Layout): DotSprites {
  const r = layout.dotRadius;
  return {
    live: makeDot(r, COLOR_DOT, rgbOf(COLOR_GLOW), PAINT.dot.glow),
    doomed: makeDot(r, FIRE.doomedDot, "255,80,40", PAINT.dot.glow),
    dead: makeDot(r * PAINT.dot.deadScale, COLOR_DEAD, null, 0),
    lit: makeDot(
      r * PAINT.dot.litScale,
      "#FFFFFF",
      "255,255,255",
      PAINT.dot.glow * PAINT.dot.litGlow,
    ),
  };
}

/**
 * Prerender one dot appearance — core plus glow — so the hot loop is
 * `drawImage`. Building a radial gradient per dot per frame will not hold 60fps
 * across the 169 dots of a Grand board.
 */
function makeDot(
  radius: number,
  core: string,
  glowRGB: string | null,
  glowScale: number,
): Sprite {
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const extent = glowRGB === null ? radius : radius * glowScale;
  const cssSize = Math.max(1, Math.ceil(extent * 2));

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cssSize * dpr);
  canvas.height = Math.ceil(cssSize * dpr);

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const c = cssSize / 2;
  if (glowRGB !== null) {
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, extent);
    gradient.addColorStop(0, `rgba(${glowRGB},0.55)`);
    gradient.addColorStop(0.35, `rgba(${glowRGB},0.16)`);
    gradient.addColorStop(1, `rgba(${glowRGB},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, cssSize, cssSize);
  }

  ctx.beginPath();
  ctx.arc(c, c, radius, 0, TAU);
  ctx.fillStyle = core;
  ctx.fill();

  return { canvas, cssSize };
}

function initialFont(cell: number, length: number): string {
  const sizes = PAINT.box.initialByLength;
  const scale = sizes[Math.min(Math.max(length, 1), sizes.length) - 1]!;
  return `800 ${Math.round(cell * scale)}px "Archivo", ui-sans-serif, system-ui, sans-serif`;
}

function blit(ctx: CanvasRenderingContext2D, sprite: Sprite, x: number, y: number) {
  const half = sprite.cssSize / 2;
  ctx.drawImage(sprite.canvas, x - half, y - half, sprite.cssSize, sprite.cssSize);
}

// ----------------------------------------------------------------- colour ---

/** `#RRGGBB` plus an alpha, for fills that need to be translucent. */
function withAlpha(hex: string, alpha: number): string {
  return `rgba(${rgbOf(hex)},${alpha})`;
}

function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
