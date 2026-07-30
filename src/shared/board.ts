/**
 * Board index math. Pure, no I/O, no DOM.
 *
 * An `n x n` grid of boxes sits on `(n+1) x (n+1)` dots.
 *
 *   horizontal lines  H[r][c]   r in [0, n]      c in [0, n-1]   -> n(n+1)
 *   vertical   lines  V[r][c]   r in [0, n-1]    c in [0, n]     -> n(n+1)
 *   total lines                                                  -> 2n(n+1)
 *
 * `lineId` is a flat index: horizontals occupy [0, n(n+1)), verticals follow.
 *
 * THIS FILE IS THE ONLY PLACE THAT KNOWS THAT ENCODING. Everything else passes
 * ids around. If you find yourself doing `r * n + c` elsewhere, stop.
 */

/** Number of lines on an `n x n` board. */
export function lineCount(n: number): number {
  return 2 * n * (n + 1);
}

/** Number of horizontal lines — also the offset at which verticals begin. */
export function hCount(n: number): number {
  return n * (n + 1);
}

export function boxCount(n: number): number {
  return n * n;
}

export function dotCount(n: number): number {
  return (n + 1) * (n + 1);
}

// ------------------------------------------------------------------ boxes ---

export function boxId(n: number, row: number, col: number): number {
  return row * n + col;
}

export function boxRow(n: number, id: number): number {
  return Math.floor(id / n);
}

export function boxCol(n: number, id: number): number {
  return id % n;
}

/**
 * The four lines bounding a box, in order: top, bottom, left, right.
 */
export function boxLineIds(
  n: number,
  row: number,
  col: number,
): [number, number, number, number] {
  return [
    hLineId(n, row, col), // top
    hLineId(n, row + 1, col), // bottom
    vLineId(n, row, col), // left
    vLineId(n, row, col + 1), // right
  ];
}

// ------------------------------------------------------------------ lines ---

export function hLineId(n: number, row: number, col: number): number {
  return row * n + col;
}

export function vLineId(n: number, row: number, col: number): number {
  return hCount(n) + row * (n + 1) + col;
}

export function isHorizontal(n: number, lineId: number): boolean {
  return lineId < hCount(n);
}

/**
 * The box ids a line borders: two for interior lines, one on the board edge.
 *
 * Written to avoid allocating in the common path — callers get a fixed pair
 * where `-1` means "no box on that side".
 */
export function lineBoxes(n: number, lineId: number): [number, number] {
  const h = hCount(n);
  if (lineId < h) {
    const row = Math.floor(lineId / n);
    const col = lineId % n;
    return [
      row > 0 ? boxId(n, row - 1, col) : -1, // above
      row < n ? boxId(n, row, col) : -1, // below
    ];
  }
  const k = lineId - h;
  const row = Math.floor(k / (n + 1));
  const col = k % (n + 1);
  return [
    col > 0 ? boxId(n, row, col - 1) : -1, // left
    col < n ? boxId(n, row, col) : -1, // right
  ];
}

/**
 * A line's two dot endpoints, in dot-grid coordinates. Rendering and hit
 * testing scale these by cell size; the rules engine never needs them.
 */
export function lineEndpoints(
  n: number,
  lineId: number,
): { r0: number; c0: number; r1: number; c1: number } {
  const h = hCount(n);
  if (lineId < h) {
    const row = Math.floor(lineId / n);
    const col = lineId % n;
    return { r0: row, c0: col, r1: row, c1: col + 1 };
  }
  const k = lineId - h;
  const row = Math.floor(k / (n + 1));
  const col = k % (n + 1);
  return { r0: row, c0: col, r1: row + 1, c1: col };
}

export function isValidLineId(n: number, lineId: number): boolean {
  return Number.isInteger(lineId) && lineId >= 0 && lineId < lineCount(n);
}
