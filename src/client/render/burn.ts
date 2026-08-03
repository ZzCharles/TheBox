/**
 * The Twist burn — the outer ring catching fire and cooling to ash.
 *
 * Values come from `design/tiki-board.html` → `Copy values` (2026-08-02), and
 * the handover's §6 is the prose version of the same thing.
 *
 * ## The one thing to understand before changing anything here
 *
 * **This is decoration painted over a collapse that has ALREADY happened.**
 *
 * The rules engine collapses a ring instantly, inside `applyMove`: the boxes
 * are `DEAD`, the orphaned lines are cleared and `bounds` has contracted before
 * a single frame is drawn. That is not a limitation to work around — it is the
 * invariant that animations never gate state, and it is what lets a player who
 * reconnects mid-burn simply see the finished board.
 *
 * So the fire runs *backwards* from how it looks. It knows which squares just
 * died, and for the ~2.9s of the sequence it draws them as though they were
 * still alive, then burns them down to the ash the state has said they are all
 * along. Nothing here is ever consulted about what is legal, whose turn it is,
 * or what anything scores. Play continues over the top of it, which is correct:
 * the ring is dead, and nobody can move there anyway.
 *
 * ## Order of events
 *
 *   0ms      the ring is already dead in `state`; the fuse lights
 *   0-1400   WARNING. Doomed dots pulse faster and faster, and the top-left
 *            corner dot heats toward white and swells — that is what tells
 *            players *where* it starts, a beat before it starts.
 *   1400+    IGNITION at the top-left square, running BOTH ways around the ring
 *            at 42ms a tile, the two arms meeting at the opposite corner.
 *   per tile flash 130ms white-hot, then cool 420ms through ember into ash.
 *   per dot  dies with the first adjacent tile to catch.
 *
 * **The board never moves.** No zoom, no re-centre, no resize. Burned tiles
 * stay exactly where they were, which is what lets players keep counting their
 * squares while the edge of the world is on fire.
 */

import { boxCol, boxId, boxRow } from "../../shared/board.ts";
import { FIRE } from "../../shared/constants.ts";
import { dotX, dotY, type Layout } from "./layout.ts";

/** Tuned in the prototype; see the header. Times in ms. */
export const BURN = {
  /** The fuse. Long enough to look where it points before it goes up. */
  warnMs: 1400,
  /** Per tile, as the front travels around the ring. */
  spreadMs: 42,
  flashMs: 130,
  coolMs: 420,
  /** Flame stops spawning partway through the cool — embers outlive the fire. */
  emitWindow: 0.55,
  /** Flame particles per 100ms per lit tile. */
  density: 5,
  flameLifeMs: 420,
  sparksPerTile: 4,
  smokePerTile: 1,
  /**
   * Hard ceiling on live particles. The fire is a FRONT, not a bonfire — only
   * ~18 tiles are alight at any moment whatever the ring size, so a Grand board
   * peaks around 380 and never reaches this. It exists so that a pathological
   * case degrades by thinning the flame rather than by dropping frames.
   */
  cap: 460,
} as const;

export const STAGE_NONE = 0;
/** Dead in `state`, but the fire has not reached it — still drawn as it was. */
export const STAGE_PENDING = 1;
export const STAGE_BURNING = 2;
/** Cooled. The renderer's ordinary ash path takes over. */
export const STAGE_ASH = 3;

const TAU = Math.PI * 2;
const FLAME = 0;
const EMBER = 1;
const SMOKE = 2;

interface Tile {
  box: number;
  /** Absolute time this tile catches. */
  at: number;
  /** Fractional particle debt, so a low density still emits smoothly. */
  acc: number;
  sparked: boolean;
  smoked: boolean;
}

interface Particle {
  kind: number;
  /** Spawn position. Current position is derived from age, never mutated. */
  x: number;
  y: number;
  /** Tile centre, which flame particles converge toward as they rise. */
  cx: number;
  vx: number;
  vy: number;
  r: number;
  t0: number;
  life: number;
  seed: number;
}

export interface Burn {
  /** True while a fire is scheduled or running. */
  readonly active: boolean;
  /**
   * Light the fuse over the squares a collapse just removed — a `ShrinkOutcome`
   * split into its `removedBoxes` (the whole ring, claimed or not) and its
   * `harvested` (the ones that were genuinely someone's when it went).
   *
   * The harvested list is not a convenience: by the time this is called, the
   * state has already overwritten `boxes[id]` with `DEAD`, and `formerOwner`
   * cannot tell "Ada owned this" from "Ada spent this on a Wildcard" — both
   * write it. Without the list a traded square would spend the warning phase
   * pretending to be a live one, and Wildcards are paid for with edge squares,
   * so it is the ring this fire burns.
   */
  ignite(
    boxes: number[],
    harvested: ReadonlyArray<{ box: number; owner: number }>,
    layout: Layout,
    now: number,
  ): void;
  /** Owner index if this square was live when the ring went, else -1. */
  wasOwnedBy(box: number): number;
  /** Drop everything, e.g. after a resync onto a board that has moved on. */
  reset(): void;
  /** Rebuild size-dependent sprites. Call on resize. */
  resize(layout: Layout): void;
  /** Advance particles and spawn new ones. Returns true while anything lives. */
  update(now: number, dtMs: number, layout: Layout): boolean;

  /** How this square should be drawn this frame. */
  stageOf(box: number, now: number): number;
  /** True if this dot belongs to the ring and the burn is drawing it. */
  ownsDot(row: number, col: number): boolean;
  /** 0 outside the warning phase, else 0→1 across the fuse. */
  warnProgress(now: number): number;

  drawTiles(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    now: number,
    inset: number,
    size: number,
    radius: number,
  ): void;
  /** Alpha for a burning square's grey letter, 0 while it is still too hot. */
  letterAlpha(box: number, now: number): number;
  drawDots(ctx: CanvasRenderingContext2D, layout: Layout, now: number): void;
  /** Additive, and therefore last: everything else is already underneath. */
  drawFlame(ctx: CanvasRenderingContext2D, now: number, layout: Layout): void;
}

export function createBurn(): Burn {
  /** Schedule, ordered from the ignition corner outward in both directions. */
  let tiles: Tile[] = [];
  const tileByBox = new Map<number, Tile>();
  /** Dot key `row * 1000 + col` → the time it dies. */
  const dotDeath = new Map<number, number>();
  /** Box → the player who owned it when the ring went. */
  const ownerAtDeath = new Map<number, number>();
  let t0 = 0;
  let igniteAt = 0;
  let endsAt = 0;
  /** The corner the fire starts from, so the fuse can point at it. */
  let cornerRow = 0;
  let cornerCol = 0;

  /*
   * Preallocated. §10.3: no allocation inside the RAF loop — these are filled
   * in place and recycled by swapping references, never by creating objects.
   */
  const pool: Particle[] = Array.from({ length: BURN.cap }, () => ({
    kind: 0,
    x: 0,
    y: 0,
    cx: 0,
    vx: 0,
    vy: 0,
    r: 0,
    t0: 0,
    life: 0,
    seed: 0,
  }));
  let live = 0;

  /** Built lazily: a Simple-mode game must never pay for the fire. */
  let flameSprites: HTMLCanvasElement[] | null = null;
  let smokeSprite: HTMLCanvasElement | null = null;
  let emberGlow: HTMLCanvasElement | null = null;
  let emberGlowSize = 0;

  function ensureSprites(layout: Layout) {
    if (flameSprites === null) {
      flameSprites = FIRE.flameRamp.map((c) => softSprite(c, 1, 0.42, 0.45));
      smokeSprite = softSprite(FIRE.smoke, 0.55, 0, 0.45);
    }
    // The glow scales with the dots, so it is rebuilt whenever they are. Same
    // stops as the live dot sprite in the renderer — one dot vocabulary.
    const want = Math.max(8, Math.ceil(layout.dotRadius * 4.4 * 2));
    if (emberGlow === null || emberGlowSize !== want) {
      emberGlowSize = want;
      emberGlow = softSprite(FIRE.doomedGlow, 0.55, 0.16, 0.35, want);
    }
  }

  function spawn(
    kind: number,
    x: number,
    y: number,
    cx: number,
    vx: number,
    vy: number,
    r: number,
    now: number,
    life: number,
  ) {
    if (live >= BURN.cap) return;
    const p = pool[live++]!;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.cx = cx;
    p.vx = vx;
    p.vy = vy;
    p.r = r;
    p.t0 = now;
    p.life = life;
    p.seed = Math.random() * TAU;
  }

  /** Swap-remove: the tail takes the dead slot, and no object is discarded. */
  function kill(i: number) {
    live--;
    const tmp = pool[i]!;
    pool[i] = pool[live]!;
    pool[live] = tmp;
  }

  return {
    get active() {
      return tiles.length > 0;
    },

    ignite(boxes, harvested, layout, now) {
      if (boxes.length === 0) return;
      ensureSprites(layout);
      ownerAtDeath.clear();
      for (const h of harvested) ownerAtDeath.set(h.box, h.owner);

      const n = layout.n;
      const present = new Set(boxes);
      let r0 = Infinity;
      let c0 = Infinity;
      let r1 = -Infinity;
      let c1 = -Infinity;
      for (const box of boxes) {
        const r = boxRow(n, box);
        const c = boxCol(n, box);
        if (r < r0) r0 = r;
        if (r > r1) r1 = r;
        if (c < c0) c0 = c;
        if (c > c1) c1 = c;
      }

      /*
       * Walk the ring clockwise from the top-left. `boxes` arrives as an
       * unordered set, and the order is the entire effect: a fire that starts
       * everywhere at once is an explosion, not a burn.
       */
      const ordered: number[] = [];
      const push = (r: number, c: number) => {
        const id = boxId(n, r, c);
        if (present.has(id)) ordered.push(id);
      };
      for (let c = c0; c <= c1; c++) push(r0, c);
      for (let r = r0 + 1; r <= r1; r++) push(r, c1);
      for (let c = c1 - 1; c >= c0; c--) push(r1, c);
      for (let r = r1 - 1; r > r0; r--) push(r, c0);
      // Anything the walk missed (a ring one square thick collapses to a line,
      // and a malformed set should still burn rather than sit there).
      for (const box of boxes) if (!ordered.includes(box)) ordered.push(box);

      t0 = now;
      igniteAt = now + BURN.warnMs;
      cornerRow = r0;
      cornerCol = c0;

      tiles = [];
      tileByBox.clear();
      dotDeath.clear();

      const count = ordered.length;
      for (let i = 0; i < count; i++) {
        const box = ordered[i]!;
        // Both ways around at once, meeting at the far corner.
        const at = igniteAt + Math.min(i, count - i) * BURN.spreadMs;
        const tile: Tile = { box, at, acc: 0, sparked: false, smoked: false };
        tiles.push(tile);
        tileByBox.set(box, tile);

        /*
         * A dot dies with the first adjacent tile to catch — but only the OUTER
         * dots die. The inner ones border the surviving board and have to stay
         * lit, or the new edge would come up dead.
         */
        const r = boxRow(n, box);
        const c = boxCol(n, box);
        for (const [dr, dc] of [
          [r, c],
          [r + 1, c],
          [r, c + 1],
          [r + 1, c + 1],
        ] as const) {
          if (dr !== r0 && dr !== r1 + 1 && dc !== c0 && dc !== c1 + 1) continue;
          const key = dr * 1000 + dc;
          const prev = dotDeath.get(key);
          if (prev === undefined || at < prev) dotDeath.set(key, at);
        }
      }

      endsAt = Math.max(...tiles.map((t) => t.at)) + BURN.flashMs + BURN.coolMs;
    },

    wasOwnedBy(box) {
      return ownerAtDeath.get(box) ?? -1;
    },

    reset() {
      tiles = [];
      tileByBox.clear();
      dotDeath.clear();
      ownerAtDeath.clear();
      live = 0;
    },

    resize(layout) {
      if (flameSprites !== null) ensureSprites(layout);
    },

    update(now, dtMs, layout) {
      if (tiles.length > 0 && now > endsAt) {
        // The fire is out. Particles are allowed to outlive it, so the schedule
        // clears but the pool drains on its own.
        tiles = [];
        tileByBox.clear();
        dotDeath.clear();
      }

      if (tiles.length > 0) {
        const cell = layout.cell;
        const inner = cell * 0.75;
        // Everything scales off the gap, so a Grand board's smaller fire is the
        // same fire seen from further away.
        const k = cell / 40;
        const window = BURN.flashMs + BURN.coolMs * BURN.emitWindow;

        for (const tile of tiles) {
          const age = now - tile.at;
          if (age < 0 || age > window) continue;

          const r = boxRow(layout.n, tile.box);
          const c = boxCol(layout.n, tile.box);
          const cx = dotX(layout, c) + cell / 2;
          const cy = dotY(layout, r) + cell / 2;

          if (!tile.sparked) {
            tile.sparked = true;
            for (let i = 0; i < BURN.sparksPerTile; i++) {
              spawn(
                EMBER,
                cx + (Math.random() - 0.5) * inner * 0.7,
                cy + (Math.random() - 0.5) * inner * 0.4,
                cx,
                (Math.random() - 0.5) * 0.03 * k,
                -(0.055 + Math.random() * 0.075) * k,
                cell * 0.045,
                now,
                520 + Math.random() * 420,
              );
            }
          }
          if (!tile.smoked && age >= BURN.flashMs) {
            tile.smoked = true;
            for (let i = 0; i < BURN.smokePerTile; i++) {
              spawn(
                SMOKE,
                cx + (Math.random() - 0.5) * inner * 0.6,
                cy,
                cx,
                (Math.random() - 0.5) * 0.008 * k,
                -(0.014 + Math.random() * 0.012) * k,
                cell * 0.16,
                now,
                1100 + Math.random() * 700,
              );
            }
          }

          // Flame output falls away as the tile cools rather than stopping dead.
          const heat =
            age < BURN.flashMs
              ? 1
              : 1 - (age - BURN.flashMs) / (BURN.coolMs * BURN.emitWindow);
          tile.acc += (dtMs * BURN.density * heat) / 100;
          while (tile.acc >= 1) {
            tile.acc--;
            spawn(
              FLAME,
              cx + (Math.random() - 0.5) * inner * 0.78,
              cy + inner * 0.3,
              cx,
              (Math.random() - 0.5) * 0.01 * k,
              -(0.042 + Math.random() * 0.058) * k,
              cell * 0.15 * (0.6 + Math.random() * 0.75),
              now,
              BURN.flameLifeMs * (0.75 + Math.random() * 0.55),
            );
          }
        }
      }

      for (let i = live - 1; i >= 0; i--) {
        if (now - pool[i]!.t0 > pool[i]!.life) kill(i);
      }
      return tiles.length > 0 || live > 0;
    },

    stageOf(box, now) {
      const tile = tileByBox.get(box);
      if (tile === undefined) return STAGE_NONE;
      const age = now - tile.at;
      if (age < 0) return STAGE_PENDING;
      if (age > BURN.flashMs + BURN.coolMs) return STAGE_ASH;
      return STAGE_BURNING;
    },

    ownsDot(row, col) {
      return dotDeath.has(row * 1000 + col);
    },

    warnProgress(now) {
      if (tiles.length === 0 || now >= igniteAt) return 0;
      return clamp01((now - t0) / BURN.warnMs);
    },

    drawTiles(ctx, layout, now, inset, size, radius) {
      if (tiles.length === 0) return;
      const half = size / 2;

      for (const tile of tiles) {
        const age = now - tile.at;
        if (age < 0 || age > BURN.flashMs + BURN.coolMs) continue;

        const r = boxRow(layout.n, tile.box);
        const c = boxCol(layout.n, tile.box);
        const x = dotX(layout, c) + inset;
        const y = dotY(layout, r) + inset;

        let fill: string;
        let edge: string;
        let glow: number;
        if (age < BURN.flashMs) {
          const p = age / BURN.flashMs;
          fill = rgb(mix(FIRE.tileFlash, FIRE.tileHot, p));
          edge = fill;
          glow = 1 - p * 0.4;
        } else {
          const p = clamp01((age - BURN.flashMs) / BURN.coolMs);
          // Hot → ember happens twice as fast as ember → ash, and the ash leg
          // is squared, so a tile lingers red and then goes out quickly.
          fill = rgb(mix(mix(FIRE.tileHot, FIRE.tileEmber, Math.min(p * 2, 1)), FIRE.tileAsh, p * p));
          edge = rgba(mix(FIRE.tileEmber, FIRE.tileEdgeAsh, p), 0.9 - 0.2 * p);
          glow = (1 - p) * 0.55;
        }

        // Heat thrown onto the table around the tile. Drawn before the tile so
        // the square itself stays crisp on top of it.
        if (glow > 0.02) {
          const cx = x + half;
          const cy = y + half;
          const reach = size * 1.15;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
          g.addColorStop(0, `rgba(255,140,40,${0.5 * glow})`);
          g.addColorStop(1, "rgba(255,120,30,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, reach, 0, TAU);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.roundRect(x, y, size, size, radius);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = edge;
        ctx.stroke();
      }
    },

    letterAlpha(box, now) {
      const tile = tileByBox.get(box);
      if (tile === undefined) return 1;
      const age = now - tile.at;
      // Nothing is legible while the square is white-hot; the letter fades back
      // in as it cools, because the point it stands for was banked long ago.
      if (age < BURN.flashMs) return 0;
      return clamp01((age - BURN.flashMs) / BURN.coolMs);
    },

    drawDots(ctx, layout, now) {
      if (tiles.length === 0 || emberGlow === null) return;
      const warn = this.warnProgress(now);
      const radius = layout.dotRadius;

      for (const [key, death] of dotDeath) {
        const row = Math.floor(key / 1000);
        const col = key % 1000;
        const x = dotX(layout, col);
        const y = dotY(layout, row);
        const age = now - death;

        if (age < 0) {
          /*
           * Still doomed rather than dying. The fuse: as the warning runs out
           * the pulse tightens from ~100ms to ~30ms, which reads as a fizzing
           * line rather than as a slow throb.
           */
          let alpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin((now * TAU) / 1300));
          if (warn > 0) {
            const fizz = 0.5 + 0.5 * Math.sin(now / (30 + 70 * (1 - warn)));
            alpha = Math.min(1, 0.6 + 0.4 * fizz + warn * 0.3);
          }
          // The corner it starts from heats toward white and swells, so players
          // know WHERE before they know when.
          const isCorner = warn > 0 && row === cornerRow && col === cornerCol;
          if (isCorner) {
            emberDot(
              ctx,
              emberGlow,
              x,
              y,
              radius * (1 + 0.35 * warn),
              rgb(mix([255, 112, 68], FIRE.tileFlash, warn)),
              1,
              1 + 0.5 * warn,
            );
          } else {
            emberDot(ctx, emberGlow, x, y, radius, FIRE.doomedDot, alpha, 1);
          }
          continue;
        }

        if (age < BURN.flashMs) {
          emberDot(ctx, emberGlow, x, y, radius * 1.15, "#FFF4D6", 1, 1.3);
        } else {
          const p = clamp01((age - BURN.flashMs) / BURN.coolMs);
          emberDot(
            ctx,
            emberGlow,
            x,
            y,
            radius * (1.15 - 0.43 * p),
            rgb(mix(FIRE.tileEmber, FIRE.deadDot, p)),
            1,
            1 - p,
          );
        }
      }
    },

    drawFlame(ctx, now, layout) {
      if (live === 0 || flameSprites === null || smokeSprite === null) return;
      const cell = layout.cell;

      // Smoke first and in normal composite: it is the only thing here that
      // takes light away rather than adding it, so it must sit behind.
      for (let i = 0; i < live; i++) {
        const q = pool[i]!;
        if (q.kind !== SMOKE) continue;
        const age = now - q.t0;
        const p = age / q.life;
        const r = q.r * (1 + p * 2.1);
        const x = q.x + q.vx * age + Math.sin(age * 0.0022 + q.seed) * cell * 0.22 * p;
        const y = q.y + q.vy * age;
        ctx.globalAlpha = Math.sin(p * Math.PI) * 0.3;
        ctx.drawImage(smokeSprite, x - r, y - r, r * 2, r * 2);
      }

      // Flame and embers ADD their light together, which is the whole reason
      // overlapping particles look like fire rather than like stacked stickers.
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < live; i++) {
        const q = pool[i]!;
        if (q.kind === SMOKE) continue;
        const age = now - q.t0;
        const p = age / q.life;
        let x = q.x + q.vx * age;
        const y = q.y + q.vy * age;
        let r: number;
        let alpha: number;
        let sprite: HTMLCanvasElement;

        if (q.kind === FLAME) {
          // Converging on the tile centre as it rises is what gives the flame a
          // tapered tip instead of a rising column.
          x += (q.cx - q.x) * 0.55 * p + Math.sin(age * 0.0068 + q.seed) * cell * 0.11 * p;
          r = q.r * (1 - p * 0.72);
          alpha = (1 - p) * (1 - p) * 0.92;
          sprite = flameSprites[Math.min(5, (p * 6) | 0)]!;
        } else {
          x += Math.sin(age * 0.0045 + q.seed) * cell * 0.06;
          r = q.r * (1 - p * 0.5);
          alpha = (1 - p) * 0.95;
          // Embers start one stop cooler than flame and never reach white.
          sprite = flameSprites[Math.min(5, 1 + ((p * 4) | 0))]!;
        }

        if (r < 0.3) continue;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    },
  };
}

// ---------------------------------------------------------------- helpers ---

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function mix(a: readonly number[], b: readonly number[], p: number): number[] {
  return [
    a[0]! + (b[0]! - a[0]!) * p,
    a[1]! + (b[1]! - a[1]!) * p,
    a[2]! + (b[2]! - a[2]!) * p,
  ];
}

const rgb = (c: number[]) => `rgb(${c[0]! | 0},${c[1]! | 0},${c[2]! | 0})`;
const rgba = (c: number[], a: number) => `rgba(${c[0]! | 0},${c[1]! | 0},${c[2]! | 0},${a})`;

/**
 * One dot of fire: a scaled blit of the shared ember glow with the core drawn
 * straight on top.
 *
 * The core is an arc rather than a sprite because its colour changes every
 * frame as the dot cools, and there are at most ~4n of them. The GLOW is the
 * expensive part, so that stays a prerendered sprite and only its size and
 * alpha vary — building a radial gradient per dot per frame is the one thing
 * the design pass was explicit about never doing.
 */
function emberDot(
  ctx: CanvasRenderingContext2D,
  glow: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  core: string,
  alpha: number,
  glowScale: number,
) {
  ctx.globalAlpha = alpha;
  if (glowScale > 0.01) {
    const size = radius * 4.4 * glowScale;
    ctx.drawImage(glow, x - size / 2, y - size / 2, size, size);
  }
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, radius), 0, TAU);
  ctx.fillStyle = core;
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * A soft radial blob, prerendered once and stamped many times.
 *
 * `mid` is the alpha at the `knee` fraction of the radius, and it is the number
 * that decides whether the result reads as a soft glow or as a hard bead. The
 * whole particle system is this one function's output, stamped a few hundred
 * times a frame with `lighter` composition.
 */
function softSprite(
  color: string | readonly number[],
  peak: number,
  mid: number,
  knee: number,
  size = 48,
): HTMLCanvasElement {
  const channels = typeof color === "string" ? channelsOf(color) : color.join(",");

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const half = size / 2;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, `rgba(${channels},${peak})`);
  if (mid > 0) g.addColorStop(knee, `rgba(${channels},${mid})`);
  g.addColorStop(1, `rgba(${channels},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/** `rgb(a,b,c)` / `rgba(a,b,c,d)` / `#RRGGBB` → the bare `"a,b,c"`. */
function channelsOf(color: string): string {
  if (color.startsWith("#")) {
    const n = Number.parseInt(color.slice(1), 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  const inner = color.slice(color.indexOf("(") + 1, color.lastIndexOf(")"));
  const parts = inner.split(",");
  return `${parts[0]!.trim()},${parts[1]!.trim()},${parts[2]!.trim()}`;
}
