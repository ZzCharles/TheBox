/**
 * The endgame shatter — the board breaks and every claimed square flies home.
 *
 * ## The one thing to understand before changing anything here
 *
 * **This runs on its own canvas, stretched over the WHOLE game screen.**
 *
 * Every other animation in this game lives inside the board (`burn.ts`,
 * the claim pulse, the roll-in), so the board canvas was enough. This one does
 * not: a square has to leave the board, cross the shop row and the scoreboard
 * gutter, and land on a DOM panel that canvas knows nothing about. There is no
 * way to do that from inside `.board-wrap` — it would clip at the first edge.
 *
 * So the overlay canvas is absolutely positioned over the entire `.game`
 * element, `pointer-events: none`, and the flight is computed in ITS
 * coordinates. `boardOffset` is the translation from board space into overlay
 * space, sampled at ignition and again on resize; everything else here works in
 * overlay pixels. Because it is absolutely positioned it occupies no row and
 * costs the layout nothing, which is what §10.0's fixed-row invariant requires
 * — the same trick the flame badge plays.
 *
 * ## It never gates state, same as the fire
 *
 * By the time this starts the game is already over: `state.phase === "over"`,
 * the scores are final, and the server has moved the room to `results`. The
 * sequence is decoration over a finished game, so a player who reconnects
 * halfway through simply gets the results overlay with no animation, and a
 * rematch landing mid-flight just resets it. Nothing here is ever consulted
 * about what anything scores.
 *
 * ## What flies, and what does not
 *
 * This is the part that is easy to get subtly wrong, and §17 is the reason:
 *
 *   scores[p] === (boxes on the board owned by p) + harvested[p]
 *
 * A square harvested by a collapsing ring **already flew to the scoreboard**,
 * conceptually — it was banked rounds ago and its point is in `harvested`. If
 * it flew again the counter would overshoot the final score by exactly the
 * number of tiles the fire ever took. So:
 *
 * | Square | Endgame |
 * |---|---|
 * | Owned, on the board | Flies to its owner's panel. `clack`. +1. |
 * | Ash (owned, then burned) | Dissolves quietly. Its point is in `harvested`. |
 * | Spent on a Wildcard | Crumbles straight down. Counts for nobody. |
 * | Never claimed | Dissolves quietly. |
 *
 * and the count-up starts each player at `harvested[p]` rather than at zero, so
 * the last piece to land is the one that makes the counter read the real score.
 *
 * ## Order of events
 *
 *   0ms       HOLD. Everything stops, the background dims, silence.
 *   600ms     CRACK. Fracture lines race along the box boundaries. `crack`.
 *   850ms     FLIGHT. Pieces launch, nearest the centre first, one every
 *             `stagger` ms; each flies a quadratic bezier to its owner's panel.
 *   per land  `clack`, a 4px panel bump, +1 on the counter.
 *   then      VICTORY, back in DOM: the winner's panel swells, a gold ring
 *             sweeps it, confetti. `fanfare`.
 */

import { boxCol, boxRow } from "../../shared/board.ts";
import { COLOR_DIM, FIRE, SPENT_TILE } from "../../shared/constants.ts";
import { SPENT } from "../../shared/rules.ts";
import { boxRect, type Layout } from "./layout.ts";

/**
 * Times in ms. The three that matter are `holdMs`, `flightWindowMs` and
 * `pieceMs`; the rest is texture.
 */
export const SHATTER = {
  /** Everything stops. The silence is doing as much work as the sound. */
  holdMs: 600,
  /** Fracture lines trace the box boundaries, bright then gone. */
  crackMs: 250,

  /**
   * How long the LAUNCHES are spread over. Per §12.3 the stagger is
   * `clamp(flightWindowMs / pieces, staggerMin, staggerMax)`, which is what
   * bounds the sequence: a 64-box board launches over ~1.9s and a 196-box
   * board over the full 2.4s, rather than Grand taking three times as long as
   * Small for the same beat.
   */
  flightWindowMs: 2400,
  staggerMin: 8,
  staggerMax: 30,
  /** One piece's own travel, launch to landing. */
  pieceMs: 560,

  /** Scale and spin a piece has arrived at when it lands. */
  landScale: 0.3,
  maxSpinDeg: 20,
  /** How far the flight bows off the straight line, as a fraction of its length. */
  arc: 0.22,

  /** Ghosts behind a moving piece. Recomputed from the curve, never stored. */
  trail: 3,
  trailStepMs: 42,

  /** A spent square crumbling straight down. */
  crumbleMs: 700,
  /** A dead or never-claimed square fading out where it sits. */
  dissolveMs: 520,

  /**
   * Step 6, and the reason the result overlay is not shown the instant the last
   * piece lands: the overlay is a full-screen blurred scrim, so raising it
   * immediately would bury the crown and the confetti underneath it. The
   * celebration gets this long on the visible scoreboard, then the rematch
   * screen arrives over the top of it.
   */
  victoryMs: 900,

  /**
   * Hard ceiling on live debris particles. Crumble and dissolve both emit, and
   * a Grand board can retire ~200 squares at once; past this the effect thins
   * rather than dropping frames.
   */
  cap: 420,
} as const;

export const PHASE_IDLE = 0;
export const PHASE_HOLD = 1;
export const PHASE_CRACK = 2;
export const PHASE_FLIGHT = 3;
export const PHASE_DONE = 4;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ================================================================== planning ===

/**
 * Which square does what, and when — with no canvas, no clock and no DOM.
 *
 * PURE, and split out for the same reason `rules.ts` and `waveforms.ts` are:
 * the part with the interesting logic is the part worth testing, and the
 * interesting logic here is not the bezier. It is the partition. Getting a
 * square into the wrong bucket does not look like a rendering bug — it looks
 * like a player finishing on the wrong score, which is the one thing the whole
 * sequence exists to announce, and it would be found by someone counting their
 * own squares in a real game rather than by anyone reading this file.
 *
 * All times are milliseconds from the START of the flight phase, so a test can
 * assert the shape of the sequence without owning a clock.
 */
export interface ShatterPlan {
  flyers: ReadonlyArray<{ box: number; owner: number; at: number }>;
  retiring: ReadonlyArray<{ box: number; crumbles: boolean; at: number }>;
  staggerMs: number;
  /** Flight start → the last thing coming to rest. */
  flightMs: number;
}

export function planShatter(boxes: ArrayLike<number>, n: number): ShatterPlan {
  const centre = (n - 1) / 2;
  const distance = (box: number) =>
    Math.hypot(boxRow(n, box) - centre, boxCol(n, box) - centre);

  const flying: Array<{ box: number; owner: number; d: number }> = [];
  const staying: Array<{ box: number; crumbles: boolean; d: number }> = [];

  for (let box = 0; box < boxes.length; box++) {
    const owner = boxes[box]!;
    if (owner >= 0) {
      flying.push({ box, owner, d: distance(box) });
    } else {
      /*
       * Everything that is not a live owned square stays where it is, and only
       * a Wildcard square FALLS. See the table in the file header — the reason
       * ash does not fly is §17: its point was banked into `harvested` when the
       * ring burned, so flying it now would count it twice.
       */
      staying.push({ box, crumbles: owner === SPENT, d: distance(box) });
    }
  }

  flying.sort((a, b) => a.d - b.d || a.box - b.box);
  staying.sort((a, b) => a.d - b.d || a.box - b.box);

  const staggerMs = Math.min(
    SHATTER.staggerMax,
    Math.max(SHATTER.staggerMin, SHATTER.flightWindowMs / Math.max(1, flying.length)),
  );

  const flyers = flying.map((f, i) => ({ box: f.box, owner: f.owner, at: i * staggerMs }));
  const retiring = staying.map((s, i) => ({
    box: s.box,
    crumbles: s.crumbles,
    at: i * staggerMs,
  }));

  const lastLand = flyers.length > 0 ? flyers[flyers.length - 1]!.at + SHATTER.pieceMs : 0;
  const lastRest =
    retiring.length > 0
      ? retiring[retiring.length - 1]!.at +
        Math.max(SHATTER.crumbleMs, SHATTER.dissolveMs)
      : 0;

  return { flyers, retiring, staggerMs, flightMs: Math.max(lastLand, lastRest) };
}

interface Piece {
  box: number;
  owner: number;
  /** Absolute time this piece leaves the board. */
  at: number;
  /** Start centre, in overlay pixels. */
  x0: number;
  y0: number;
  /** Bezier control point. */
  cx: number;
  cy: number;
  /** Target: the centre of the owner's avatar. */
  tx: number;
  ty: number;
  spin: number;
  landed: boolean;
}

/** A square that is not going anywhere — it crumbles or fades where it sits. */
interface Retiring {
  box: number;
  at: number;
  /** True for a Wildcard square: it falls. Otherwise it just dissolves. */
  crumbles: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  t0: number;
  life: number;
  /** Packed 'r,g,b' so the draw loop allocates no strings. */
  tint: string;
}

export interface ShatterTarget {
  /** Avatar centre for this player, in overlay pixels. */
  x: number;
  y: number;
}

export interface ShatterInput {
  /** `state.boxes`: owner index, or one of UNCLAIMED / SPENT / DEAD. */
  boxes: ArrayLike<number>;
  /** `state.formerOwner`, for telling ash apart from a never-claimed square. */
  formerOwner: ArrayLike<number>;
  /** Fill colour per player index. */
  colors: readonly string[];
  /** Letter per player index. */
  initials: readonly string[];
}

export interface Shatter {
  readonly active: boolean;
  readonly phase: number;
  /** Boxes the BOARD renderer must stop drawing, because this owns them now. */
  readonly hidden: ReadonlySet<number>;

  /**
   * Break the board.
   *
   * @param targets Avatar centre per player index, in overlay pixels. Measured
   *   from the live DOM by the caller, because only it knows where the
   *   scoreboard ended up.
   * @param boardOffset Board space → overlay space. The board canvas is a child
   *   of `.board-wrap`; the overlay covers all of `.game`.
   */
  begin(
    input: ShatterInput,
    layout: Layout,
    targets: readonly ShatterTarget[],
    boardOffset: { x: number; y: number },
    now: number,
  ): void;

  /** Re-measure after a resize. Cheap, and safe to call mid-flight. */
  remeasure(
    layout: Layout,
    targets: readonly ShatterTarget[],
    boardOffset: { x: number; y: number },
  ): void;

  /** Drop everything — a resync, a rematch, or leaving the screen. */
  reset(): void;

  /**
   * Advance one frame. Returns true while anything is still moving.
   *
   * Landings are reported through `onLand` rather than polled, because each one
   * has to fire a `clack`, bump a DOM panel and step a counter — all of which
   * live outside the renderer.
   */
  update(now: number, dtMs: number, onLand: (player: number) => void): boolean;

  draw(ctx: CanvasRenderingContext2D, now: number): void;

  /** When the last piece lands, so the caller can time the victory beat. */
  readonly endsAt: number;
}

export function createShatter(): Shatter {
  const pieces: Piece[] = [];
  const retiring: Retiring[] = [];
  const particles: Particle[] = [];
  /** Recycled by swapping references; never reallocated mid-flight. */
  const pool: Particle[] = [];
  const hidden = new Set<number>();

  let input: ShatterInput | null = null;
  let layout: Layout | null = null;
  let offX = 0;
  let offY = 0;
  let startedAt = 0;
  let endsAt = 0;
  let running = false;
  /** Cell size in overlay pixels, and the tile inset/size/radius derived once. */
  let cell = 0;
  let tileInset = 0;
  let tileSize = 0;
  let tileRadius = 0;
  let crackedAt = 0;

  function flightStart(): number {
    return startedAt + SHATTER.holdMs + SHATTER.crackMs;
  }

  /** Deterministic per-box jitter, so a piece spins the same way every replay. */
  function hash(box: number): number {
    let h = (box * 0x9e3779b1) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    return h / 0xffffffff;
  }

  function centreOf(box: number, l: Layout): { x: number; y: number } {
    const { x, y } = boxRect(l, boxRow(l.n, box), boxCol(l.n, box));
    return { x: x + offX + l.cell / 2, y: y + offY + l.cell / 2 };
  }

  /**
   * The control point for one piece's curve.
   *
   * A straight line from a square to a panel is a perfectly good trajectory and
   * looks like a bug: a hundred of them converge into a starburst of overlapping
   * straight lines. Bowing each one off its chord — to whichever side it is
   * already leaning, so the fan opens outward rather than crossing itself —
   * is what turns the same motion into something that reads as thrown.
   */
  function control(x0: number, y0: number, tx: number, ty: number, seed: number): {
    cx: number;
    cy: number;
  } {
    const dx = tx - x0;
    const dy = ty - y0;
    const dist = Math.hypot(dx, dy) || 1;
    // Perpendicular to the chord, signed so pieces bow away from the target's
    // side rather than sweeping across it.
    const side = dx >= 0 ? 1 : -1;
    const bow = dist * SHATTER.arc * (0.7 + seed * 0.6) * side;
    return {
      cx: x0 + dx * 0.5 - (dy / dist) * bow,
      cy: y0 + dy * 0.5 + (dx / dist) * bow,
    };
  }

  function measure(l: Layout, targets: readonly ShatterTarget[]): void {
    cell = l.cell;
    tileInset = cell * 0.125;
    tileSize = cell - tileInset * 2;
    tileRadius = cell * 0.095;

    for (const piece of pieces) {
      const c = centreOf(piece.box, l);
      const target = targets[piece.owner];
      piece.x0 = c.x;
      piece.y0 = c.y;
      if (target) {
        piece.tx = target.x;
        piece.ty = target.y;
      }
      const ctrl = control(piece.x0, piece.y0, piece.tx, piece.ty, hash(piece.box));
      piece.cx = ctrl.cx;
      piece.cy = ctrl.cy;
    }
  }

  function spawn(x: number, y: number, vx: number, vy: number, r: number, life: number, tint: string, now: number): void {
    if (particles.length >= SHATTER.cap) return;
    const p = pool.pop();
    if (p) {
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.r = r;
      p.t0 = now;
      p.life = life;
      p.tint = tint;
      particles.push(p);
    } else {
      particles.push({ x, y, vx, vy, r, t0: now, life, tint });
    }
  }

  return {
    get active() {
      return running;
    },
    get endsAt() {
      return endsAt;
    },
    get phase() {
      if (!running) return PHASE_IDLE;
      const t = performance.now() - startedAt;
      if (t < SHATTER.holdMs) return PHASE_HOLD;
      if (t < SHATTER.holdMs + SHATTER.crackMs) return PHASE_CRACK;
      return PHASE_FLIGHT;
    },
    hidden,

    begin(nextInput, l, targets, boardOffset, now) {
      pieces.length = 0;
      retiring.length = 0;
      particles.length = 0;
      hidden.clear();

      input = nextInput;
      layout = l;
      offX = boardOffset.x;
      offY = boardOffset.y;
      startedAt = now;
      crackedAt = 0;
      running = true;

      /*
       * The plan decides WHAT and WHEN; everything below is only WHERE.
       *
       * Both lists come back ordered by distance from the centre of the board,
       * which is what makes this read as a shatter rather than as a few hundred
       * separate departures — the break starts in the middle and travels out,
       * and the squares that are not going anywhere empty outward with it.
       */
      const plan = planShatter(nextInput.boxes, l.n);
      const t0 = flightStart();

      for (const flyer of plan.flyers) {
        const seed = hash(flyer.box);
        const target = targets[flyer.owner] ?? { x: 0, y: 0 };
        const c = centreOf(flyer.box, l);
        const ctrl = control(c.x, c.y, target.x, target.y, seed);
        pieces.push({
          box: flyer.box,
          owner: flyer.owner,
          at: t0 + flyer.at,
          x0: c.x,
          y0: c.y,
          cx: ctrl.cx,
          cy: ctrl.cy,
          tx: target.x,
          ty: target.y,
          spin: (seed * 2 - 1) * SHATTER.maxSpinDeg * DEG,
          landed: false,
        });
        hidden.add(flyer.box);
      }

      for (const item of plan.retiring) {
        retiring.push({ box: item.box, at: t0 + item.at, crumbles: item.crumbles });
        hidden.add(item.box);
      }

      endsAt = t0 + plan.flightMs;
      measure(l, targets);
    },

    remeasure(l, targets, boardOffset) {
      if (!running) return;
      layout = l;
      offX = boardOffset.x;
      offY = boardOffset.y;
      measure(l, targets);
    },

    reset() {
      running = false;
      pieces.length = 0;
      retiring.length = 0;
      particles.length = 0;
      pool.length = 0;
      hidden.clear();
      input = null;
      layout = null;
      endsAt = 0;
    },

    update(now, dtMs, onLand) {
      if (!running) return false;

      // Landings. Reported once each, in launch order, so the clacks arrive in
      // the same rhythm the pieces do.
      for (const piece of pieces) {
        if (piece.landed) continue;
        if (now < piece.at + SHATTER.pieceMs) continue;
        piece.landed = true;
        onLand(piece.owner);
        // A small puff where it hit, in the player's own colour.
        const tint = input?.colors[piece.owner] ?? COLOR_DIM;
        for (let i = 0; i < 3; i++) {
          const a = hash(piece.box * 7 + i) * TAU;
          spawn(
            piece.tx,
            piece.ty,
            Math.cos(a) * 0.05,
            Math.sin(a) * 0.05 - 0.02,
            2 + hash(piece.box + i) * 2,
            260,
            tint,
            now,
          );
        }
      }

      // Crumbling squares shed a little debris as they go.
      for (const item of retiring) {
        if (!item.crumbles || !layout) continue;
        const age = now - item.at;
        if (age < 0 || age > SHATTER.crumbleMs * 0.5) continue;
        if (hash(item.box + Math.floor(age / 90)) > 0.35) continue;
        const c = centreOf(item.box, layout);
        spawn(
          c.x + (hash(item.box) - 0.5) * cell * 0.6,
          c.y,
          (hash(item.box * 3) - 0.5) * 0.02,
          0.06 + hash(item.box * 5) * 0.05,
          1 + hash(item.box * 11) * 1.5,
          SHATTER.crumbleMs * 0.6,
          SPENT_TILE.top,
          now,
        );
      }

      // Advance particles. Positions are integrated, not derived, because
      // debris has gravity and a bezier does not.
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        if (now - p.t0 >= p.life) {
          const last = particles.pop()!;
          if (i < particles.length) particles[i] = last;
          pool.push(p);
          continue;
        }
        p.x += p.vx * dtMs;
        p.y += p.vy * dtMs;
        p.vy += 0.00022 * dtMs;
      }

      if (now >= endsAt && particles.length === 0) {
        running = false;
        return false;
      }
      return true;
    },

    draw(ctx, now) {
      if (!running || !layout || !input) return;
      const t = now - startedAt;

      if (t < SHATTER.holdMs) return;

      // ------------------------------------------------------------- crack ---
      if (t < SHATTER.holdMs + SHATTER.crackMs) {
        const u = (t - SHATTER.holdMs) / SHATTER.crackMs;
        drawFractures(ctx, layout, u);
        return;
      }
      if (crackedAt === 0) crackedAt = now;

      // -------------------------------------------------------- stay-behinds ---
      for (const item of retiring) {
        const age = now - item.at;
        if (age < 0) {
          drawTileAt(ctx, item.box, 0, 0, 1, 0, 1);
          continue;
        }
        const span = item.crumbles ? SHATTER.crumbleMs : SHATTER.dissolveMs;
        if (age >= span) continue;
        const u = age / span;
        if (item.crumbles) {
          // Straight down, accelerating, fading as it goes.
          drawTileAt(ctx, item.box, 0, u * u * cell * 2.2, 1 - u * 0.25, u * 0.3, 1 - u);
        } else {
          drawTileAt(ctx, item.box, 0, 0, 1 - u * 0.1, 0, 1 - u);
        }
      }

      // ------------------------------------------------------------ flight ---
      for (const piece of pieces) {
        const age = now - piece.at;
        if (age < 0) {
          // Not launched: still sitting on the board, drawn by us because the
          // board renderer has already handed it over.
          drawTileAt(ctx, piece.box, 0, 0, 1, 0, 1);
          continue;
        }
        if (age >= SHATTER.pieceMs) continue;

        // Trailing ghosts first, so the piece itself draws on top of them.
        for (let g = SHATTER.trail; g >= 1; g--) {
          const gAge = age - g * SHATTER.trailStepMs;
          if (gAge <= 0) continue;
          drawPiece(ctx, piece, gAge / SHATTER.pieceMs, 0.16 * (1 - g / (SHATTER.trail + 1)));
        }
        drawPiece(ctx, piece, age / SHATTER.pieceMs, 1);
      }

      // ---------------------------------------------------------- particles ---
      for (const p of particles) {
        const u = (now - p.t0) / p.life;
        ctx.globalAlpha = Math.max(0, 1 - u);
        ctx.fillStyle = p.tint;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 - u * 0.4), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };

  /**
   * Fracture lines racing along the box boundaries.
   *
   * Drawn from the CENTRE outward on a radius that runs past the corners, so
   * the break travels rather than appearing everywhere at once — and jittered
   * off true, because the box boundaries are a perfect grid and a perfect grid
   * lighting up reads as a highlight, not as glass breaking.
   */
  function drawFractures(ctx: CanvasRenderingContext2D, l: Layout, u: number): void {
    const n = l.n;
    const x0 = l.originX + offX;
    const y0 = l.originY + offY;
    const midX = x0 + (n * l.cell) / 2;
    const midY = y0 + (n * l.cell) / 2;
    const reach = Math.hypot(n * l.cell, n * l.cell) / 2;
    // Front runs past the far corner by the end, so nothing is left unbroken.
    const front = u * reach * 1.15;
    // Bright on arrival, then fading — a fracture is a flash, not a drawing.
    const fade = 1 - Math.max(0, u - 0.45) / 0.55;

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = FIRE.flameRamp[1] ?? "#FFE8A8";
    ctx.shadowColor = FIRE.doomedGlow;

    for (let i = 0; i <= n; i++) {
      const at = x0 + i * l.cell;
      const atY = y0 + i * l.cell;
      for (let j = 0; j < n; j++) {
        // Horizontal segment (i, j) and vertical segment (j, i), both handled
        // in one pass so the whole grid is walked once.
        drawSeg(x0 + j * l.cell, atY, x0 + (j + 1) * l.cell, atY, i * (n + 1) + j);
        drawSeg(at, y0 + j * l.cell, at, y0 + (j + 1) * l.cell, 9973 + i * (n + 1) + j);
      }
    }
    ctx.restore();

    function drawSeg(ax: number, ay: number, bx: number, by: number, seed: number): void {
      const cxs = (ax + bx) / 2;
      const cys = (ay + by) / 2;
      if (Math.hypot(cxs - midX, cys - midY) > front) return;
      const h = hash(seed);
      // Each segment lights for a moment and then dims, offset by its own seed
      // so the whole grid never flashes in lockstep.
      const alpha = fade * (0.35 + h * 0.65);
      if (alpha <= 0.02) return;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1 + h * 1.4;
      ctx.shadowBlur = 5 * alpha;
      // The jitter: a fracture wanders, a grid line does not.
      const jx = (hash(seed * 3) - 0.5) * l.cell * 0.12;
      const jy = (hash(seed * 5) - 0.5) * l.cell * 0.12;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(cxs + jx, cys + jy, bx, by);
      ctx.stroke();
    }
  }

  /** One piece at progress `u` along its curve. */
  function drawPiece(ctx: CanvasRenderingContext2D, piece: Piece, u: number, alpha: number): void {
    if (u <= 0 || u > 1) return;
    // Ease-in: a piece is torn loose slowly and then whips away, which is what
    // makes the board look like it is breaking rather than emptying.
    const e = u * u * (3 - 2 * u);
    const inv = 1 - e;
    const x = inv * inv * piece.x0 + 2 * inv * e * piece.cx + e * e * piece.tx;
    const y = inv * inv * piece.y0 + 2 * inv * e * piece.cy + e * e * piece.ty;
    const scale = 1 - (1 - SHATTER.landScale) * e;
    // Fade out over the last stretch so a piece arrives rather than stopping.
    const fade = alpha * (u > 0.85 ? 1 - (u - 0.85) / 0.15 : 1);
    drawTileAtXY(ctx, piece.owner, x, y, scale, piece.spin * e, fade);
  }

  /** A tile still in its board position, optionally nudged and faded. */
  function drawTileAt(
    ctx: CanvasRenderingContext2D,
    box: number,
    dx: number,
    dy: number,
    scale: number,
    rot: number,
    alpha: number,
  ): void {
    if (!layout || !input) return;
    const c = centreOf(box, layout);
    drawTileAtXY(ctx, input.boxes[box]!, c.x + dx, c.y + dy, scale, rot, alpha);
  }

  /**
   * The one place a square is painted, wherever it happens to be.
   *
   * Deliberately a copy of the board renderer's tile rather than a call into
   * it: that one paints in board coordinates against a Layout, and every square
   * here has left board coordinates behind. Sharing it would mean threading a
   * transform through the renderer's hot path to serve an animation that runs
   * once a game.
   */
  function drawTileAtXY(
    ctx: CanvasRenderingContext2D,
    owner: number,
    x: number,
    y: number,
    scale: number,
    rot: number,
    alpha: number,
  ): void {
    if (!input || alpha <= 0.01) return;
    const half = tileSize / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (rot !== 0) ctx.rotate(rot);
    if (scale !== 1) ctx.scale(scale, scale);

    ctx.beginPath();
    ctx.roundRect(-half, -half, tileSize, tileSize, tileRadius);

    if (owner >= 0) {
      const color = input.colors[owner] ?? COLOR_DIM;
      ctx.fillStyle = withAlpha(color, 0.237);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = withAlpha(color, 0.53);
      ctx.stroke();

      const initial = input.initials[owner] ?? "";
      if (initial) {
        const size = tileSize * (initial.length >= 3 ? 0.25 : initial.length === 2 ? 0.32 : 0.45);
        ctx.fillStyle = withAlpha(color, 0.88);
        ctx.font = `700 ${size}px Archivo, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initial, 0, tileSize * 0.015);
      }
    } else if (owner === SPENT) {
      ctx.fillStyle = SPENT_TILE.bottom;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = SPENT_TILE.edge;
      ctx.stroke();
    } else {
      ctx.fillStyle = FIRE.ashFill;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = FIRE.ashEdge;
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** `#rrggbb` + alpha, matching the board renderer's own helper. */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
