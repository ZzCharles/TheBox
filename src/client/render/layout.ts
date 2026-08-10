/**
 * Board <-> screen mapping and hit testing.
 *
 * PURE — no canvas, no DOM, no globals. That is deliberate: hit testing is the
 * single most fiddly thing in a touch game, and keeping it here means it can be
 * unit tested instead of poked at with a finger.
 *
 * Two coordinate spaces:
 *   - DOT space:    dots sit at integer (row, col), 0..n inclusive.
 *   - SCREEN space: CSS pixels relative to the canvas element.
 */

import { hCount, lineCount } from "../../shared/board.ts";

export interface Layout {
  n: number;
  /** CSS pixels per cell. */
  cell: number;
  /** Screen position of dot (0, 0). */
  originX: number;
  originY: number;
  dotRadius: number;
  lineWidth: number;
}

/** Fraction of a cell within which a tap counts as hitting a line. */
export const TAP_TOLERANCE = 0.45;
/** Fraction of a cell within which a press counts as grabbing a dot. */
export const DOT_GRAB_TOLERANCE = 0.4;
/**
 * If the two nearest lines are within this relative distance of each other the
 * tap is ambiguous, and we ask the player to aim rather than guessing wrong.
 */
export const AMBIGUITY_RATIO = 0.15;

/**
 * Confirm-tap is on by default from this grid size up — **Large and Grand only**
 * (revised 2026-08-10, was 10 and therefore Medium too).
 *
 * A playtester on Medium reported "multiplayer tap isn't responsive, have to double tap"
 * and played several games without ever working out the second tap was deliberate. On a
 * 10x10 board the cells are still big enough to hit accurately, so the insurance was
 * costing more than the mistakes it prevented. Large and Grand are where cells get small
 * enough that a misplaced line is the bigger risk.
 */
export const CONFIRM_TAP_FROM_GRID = 12;

/**
 * Fit an n x n board into a viewport, leaving a half-cell of breathing room on
 * every side so edge dots and their glow are never clipped.
 */
export function computeLayout(
  n: number,
  viewportWidth: number,
  viewportHeight: number,
): Layout {
  const padCells = 1; // half a cell each side
  const cell = Math.min(
    viewportWidth / (n + padCells),
    viewportHeight / (n + padCells),
  );
  const extent = cell * n;

  return {
    n,
    cell,
    originX: (viewportWidth - extent) / 2,
    originY: (viewportHeight - extent) / 2,
    /*
     * Fractions of the gap, not pixels. A pixel value that looks right on a
     * 6x6 board makes a 12x12 board a solid mesh; as fractions, Grand just
     * looks like Small seen from further away. The 2px floor on the dot is the
     * single exception — below that a dot stops reading as a dot at all.
     */
    dotRadius: Math.max(2, cell * 0.084),
    lineWidth: cell * 0.076,
  };
}

// ------------------------------------------------------- dot space -> screen ---

export function dotX(l: Layout, col: number): number {
  return l.originX + col * l.cell;
}

export function dotY(l: Layout, row: number): number {
  return l.originY + row * l.cell;
}

/** Screen-space endpoints of a line, ready to stroke. */
export function lineSegment(
  l: Layout,
  lineId: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const h = hCount(l.n);
  if (lineId < h) {
    const row = Math.floor(lineId / l.n);
    const col = lineId % l.n;
    return {
      x0: dotX(l, col),
      y0: dotY(l, row),
      x1: dotX(l, col + 1),
      y1: dotY(l, row),
    };
  }
  const k = lineId - h;
  const row = Math.floor(k / (l.n + 1));
  const col = k % (l.n + 1);
  return {
    x0: dotX(l, col),
    y0: dotY(l, row),
    x1: dotX(l, col),
    y1: dotY(l, row + 1),
  };
}

/** Screen-space rectangle of a box. */
export function boxRect(
  l: Layout,
  row: number,
  col: number,
): { x: number; y: number; w: number; h: number } {
  return { x: dotX(l, col), y: dotY(l, row), w: l.cell, h: l.cell };
}

// ------------------------------------------------------- screen -> dot space ---

function toDotSpace(l: Layout, x: number, y: number): { fx: number; fy: number } {
  return { fx: (x - l.originX) / l.cell, fy: (y - l.originY) / l.cell };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface LineHit {
  lineId: number;
  /** Distance from the tap to the nearest point ON the line, in cells. */
  distance: number;
  /**
   * True when a second line was nearly as close. The caller should prompt the
   * player to aim rather than committing to a coin flip.
   */
  ambiguous: boolean;
}

/**
 * Nearest line to a screen point, or null if nothing is within tolerance.
 *
 * Generates exactly two candidates — the closest horizontal and the closest
 * vertical — and compares them. O(1), and it cannot miss a nearer line, because
 * every point's nearest line of each orientation is determined by rounding.
 *
 * Distance is measured to the nearest point ON the segment, NOT to its
 * midpoint. That difference matters: a tap right next to a dot sits ~0.05 cells
 * from two lines but ~0.45 from both of their midpoints, so a midpoint metric
 * silently swallows taps near every intersection on the board.
 *
 * `isLegal` lets the caller exclude occupied or dead lines; if the closest
 * candidate is illegal the other one is still considered.
 */
export function nearestLine(
  l: Layout,
  x: number,
  y: number,
  isLegal: (lineId: number) => boolean = () => true,
): LineHit | null {
  const { fx, fy } = toDotSpace(l, x, y);
  const n = l.n;

  // Horizontal: runs along row `hRow`, spanning cols [hCol, hCol + 1].
  const hRow = clamp(Math.round(fy), 0, n);
  const hCol = clamp(Math.floor(fx), 0, n - 1);
  const hId = hRow * n + hCol;
  const hDist = Math.hypot(fx - clamp(fx, hCol, hCol + 1), fy - hRow);

  // Vertical: runs down col `vCol`, spanning rows [vRow, vRow + 1].
  const vCol = clamp(Math.round(fx), 0, n);
  const vRow = clamp(Math.floor(fy), 0, n - 1);
  const vId = hCount(n) + vRow * (n + 1) + vCol;
  const vDist = Math.hypot(fx - vCol, fy - clamp(fy, vRow, vRow + 1));

  const candidates: Array<{ id: number; dist: number }> = [
    { id: hId, dist: hDist },
    { id: vId, dist: vDist },
  ].sort((a, b) => a.dist - b.dist);

  const [best, other] = candidates;
  if (best === undefined || other === undefined) return null;

  const pick = isLegal(best.id) ? best : isLegal(other.id) ? other : null;
  if (pick === null || pick.dist > TAP_TOLERANCE) return null;

  // Only genuinely ambiguous if the runner-up is both close AND playable.
  const rival = pick === best ? other : best;
  const ambiguous =
    isLegal(rival.id) &&
    rival.dist <= TAP_TOLERANCE &&
    Math.abs(rival.dist - pick.dist) / Math.max(rival.dist, pick.dist, 1e-6) <
      AMBIGUITY_RATIO;

  return { lineId: pick.id, distance: pick.dist, ambiguous };
}

export interface DotHit {
  row: number;
  col: number;
  distance: number;
}

/** Nearest dot to a screen point, for the drag-from-dot gesture. */
export function nearestDot(l: Layout, x: number, y: number): DotHit | null {
  const { fx, fy } = toDotSpace(l, x, y);
  const row = clamp(Math.round(fy), 0, l.n);
  const col = clamp(Math.round(fx), 0, l.n);
  const distance = Math.hypot(fx - col, fy - row);
  return distance <= DOT_GRAB_TOLERANCE ? { row, col, distance } : null;
}

/**
 * The line joining two dots, or null if they are not orthogonally adjacent.
 * Used to resolve a drag gesture into a move.
 */
export function lineBetweenDots(
  n: number,
  a: { row: number; col: number },
  b: { row: number; col: number },
): number | null {
  const dr = b.row - a.row;
  const dc = b.col - a.col;

  if (dr === 0 && Math.abs(dc) === 1) {
    return a.row * n + Math.min(a.col, b.col);
  }
  if (dc === 0 && Math.abs(dr) === 1) {
    return hCount(n) + Math.min(a.row, b.row) * (n + 1) + a.col;
  }
  return null;
}

/** Sanity guard for renderers consuming ids from elsewhere. */
export function isDrawableLine(l: Layout, lineId: number): boolean {
  return lineId >= 0 && lineId < lineCount(l.n);
}
