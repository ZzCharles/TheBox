import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hLineId, lineCount, lineEndpoints, vLineId } from "../../shared/board.ts";
import {
  computeLayout,
  dotX,
  dotY,
  lineBetweenDots,
  lineSegment,
  nearestDot,
  nearestLine,
  TAP_TOLERANCE,
  type Layout,
} from "./layout.ts";

const L = (n: number, w = 400, h = 700) => computeLayout(n, w, h);

/** Screen-space midpoint of a line, i.e. where a player would aim. */
function midpoint(l: Layout, lineId: number) {
  const { x0, y0, x1, y1 } = lineSegment(l, lineId);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** Screen point at fractional dot-space coordinates. */
function at(l: Layout, fx: number, fy: number) {
  return { x: dotX(l, fx), y: dotY(l, fy) };
}

describe("computeLayout", () => {
  it("fits the board with a half-cell margin and centres it", () => {
    const n = 8;
    const l = computeLayout(n, 400, 700);

    // Portrait viewport: width is the constraint.
    assert.equal(l.cell, 400 / (n + 1));
    const extent = l.cell * n;
    assert.ok(Math.abs(l.originX - (400 - extent) / 2) < 1e-9);
    assert.ok(Math.abs(l.originY - (700 - extent) / 2) < 1e-9);
    assert.ok(l.originX >= l.cell / 2 - 1e-9, "half-cell margin preserved");
  });

  it("uses the short side of a landscape viewport", () => {
    const l = computeLayout(8, 900, 400);
    assert.equal(l.cell, 400 / 9);
  });

  it("keeps dots and lines visible on a cramped board", () => {
    const l = computeLayout(12, 320, 320);
    assert.ok(l.dotRadius >= 2.5);
    assert.ok(l.lineWidth >= 2.5 && l.lineWidth <= 4);
  });
});

describe("dot space to screen", () => {
  it("places dot (0,0) at the origin and steps by one cell", () => {
    const l = L(6);
    assert.equal(dotX(l, 0), l.originX);
    assert.equal(dotY(l, 0), l.originY);
    assert.ok(Math.abs(dotX(l, 3) - (l.originX + 3 * l.cell)) < 1e-9);
  });

  it("agrees with the shared board module on every line's endpoints", () => {
    const n = 5;
    const l = L(n);
    for (let id = 0; id < lineCount(n); id++) {
      const seg = lineSegment(l, id);
      const { r0, c0, r1, c1 } = lineEndpoints(n, id);
      assert.ok(Math.abs(seg.x0 - dotX(l, c0)) < 1e-9, `line ${id} x0`);
      assert.ok(Math.abs(seg.y0 - dotY(l, r0)) < 1e-9, `line ${id} y0`);
      assert.ok(Math.abs(seg.x1 - dotX(l, c1)) < 1e-9, `line ${id} x1`);
      assert.ok(Math.abs(seg.y1 - dotY(l, r1)) < 1e-9, `line ${id} y1`);
    }
  });
});

describe("nearestLine", () => {
  it("resolves a tap on any line's midpoint to that exact line", () => {
    // The strongest guarantee in the file: aim at a line, get that line — for
    // every line on every board size we support.
    for (const n of [8, 9, 10, 12]) {
      const l = L(n);
      for (let id = 0; id < lineCount(n); id++) {
        const { x, y } = midpoint(l, id);
        const hit = nearestLine(l, x, y);
        assert.equal(hit?.lineId, id, `n=${n} line ${id}`);
        assert.ok(hit!.distance < 1e-9);
        assert.equal(hit!.ambiguous, false, `n=${n} line ${id} should be clean`);
      }
    }
  });

  it("returns nothing when the tap is beyond tolerance", () => {
    const n = 8;
    const l = L(n);
    // Dead centre of a box is as far from any line as you can get.
    const x = dotX(l, 3) + l.cell / 2;
    const y = dotY(l, 3) + l.cell / 2;
    assert.equal(nearestLine(l, x, y), null);
  });

  it("flags a tap near a dot as ambiguous", () => {
    const n = 8;
    const l = L(n);
    // Just inside the corner where a horizontal and a vertical line meet: both
    // midpoints are equidistant.
    const hit = nearestLine(l, dotX(l, 4) + l.cell * 0.05, dotY(l, 4) + l.cell * 0.05);
    assert.ok(hit, "should still find a candidate");
    assert.equal(hit.ambiguous, true, "a coin flip must be reported, not guessed");
  });

  it("falls back to the runner-up when the closest line is illegal", () => {
    const n = 8;
    const l = L(n);
    // Sits 0.2 cells below H[4][3] and 0.3 cells left of V[4][4] — the
    // horizontal is nearer, but both are comfortably within tolerance.
    const p = at(l, 3.7, 4.2);
    const taken = hLineId(n, 4, 3);

    assert.equal(nearestLine(l, p.x, p.y)?.lineId, taken);

    const hit = nearestLine(l, p.x, p.y, (id) => id !== taken);
    assert.equal(hit?.lineId, vLineId(n, 4, 4), "falls through to the vertical");
  });

  it("returns nothing when every candidate is illegal", () => {
    const l = L(8);
    const { x, y } = midpoint(l, hLineId(8, 2, 2));
    assert.equal(nearestLine(l, x, y, () => false), null);
  });

  it("does not call a tap ambiguous when the rival line is unplayable", () => {
    const n = 8;
    const l = L(n);
    const corner = { x: dotX(l, 4) + l.cell * 0.05, y: dotY(l, 4) + l.cell * 0.05 };

    const both = nearestLine(l, corner.x, corner.y);
    assert.equal(both?.ambiguous, true);

    // With the rival taken there is only one real choice, so just play it.
    const rival = both!.lineId;
    const hit = nearestLine(l, corner.x, corner.y, (id) => id !== rival);
    assert.ok(hit);
    assert.equal(hit.ambiguous, false);
  });

  it("clamps taps outside the board to the nearest edge line", () => {
    const n = 8;
    const l = L(n);
    // Slightly above the top edge, over the first cell.
    const hit = nearestLine(l, dotX(l, 0) + l.cell * 0.5, dotY(l, 0) - l.cell * 0.2);
    assert.equal(hit?.lineId, hLineId(n, 0, 0));
  });

  it("never reports a hit further away than the tolerance", () => {
    const n = 8;
    const l = L(n);
    for (let i = 0; i < 400; i++) {
      const x = l.originX + ((i * 37) % 100) / 100 * l.cell * n;
      const y = l.originY + ((i * 53) % 100) / 100 * l.cell * n;
      const hit = nearestLine(l, x, y);
      if (hit) assert.ok(hit.distance <= TAP_TOLERANCE);
    }
  });
});

describe("drag from dot", () => {
  it("grabs the dot under the finger", () => {
    const l = L(8);
    const hit = nearestDot(l, dotX(l, 3) + 1, dotY(l, 5) - 1);
    assert.deepEqual({ row: hit?.row, col: hit?.col }, { row: 5, col: 3 });
  });

  it("ignores a press in open space", () => {
    const l = L(8);
    assert.equal(nearestDot(l, dotX(l, 3) + l.cell / 2, dotY(l, 5) + l.cell / 2), null);
  });

  it("resolves adjacent dot pairs to the right line, in both directions", () => {
    const n = 6;
    for (let r = 0; r <= n; r++) {
      for (let c = 0; c <= n; c++) {
        if (c < n) {
          const id = hLineId(n, r, c);
          assert.equal(lineBetweenDots(n, { row: r, col: c }, { row: r, col: c + 1 }), id);
          assert.equal(lineBetweenDots(n, { row: r, col: c + 1 }, { row: r, col: c }), id);
        }
        if (r < n) {
          const id = vLineId(n, r, c);
          assert.equal(lineBetweenDots(n, { row: r, col: c }, { row: r + 1, col: c }), id);
          assert.equal(lineBetweenDots(n, { row: r + 1, col: c }, { row: r, col: c }), id);
        }
      }
    }
  });

  it("rejects diagonal, distant and self pairs", () => {
    const n = 6;
    assert.equal(lineBetweenDots(n, { row: 1, col: 1 }, { row: 2, col: 2 }), null);
    assert.equal(lineBetweenDots(n, { row: 1, col: 1 }, { row: 1, col: 3 }), null);
    assert.equal(lineBetweenDots(n, { row: 1, col: 1 }, { row: 1, col: 1 }), null);
  });
});
