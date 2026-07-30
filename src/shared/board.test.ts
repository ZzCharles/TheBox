import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  boxLineIds,
  boxCol,
  boxCount,
  boxId,
  boxRow,
  dotCount,
  hCount,
  hLineId,
  isHorizontal,
  isValidLineId,
  lineBoxes,
  lineCount,
  lineEndpoints,
  vLineId,
} from "./board.ts";
import { gridSizeFor, MAX_GRID, MIN_GRID } from "./constants.ts";

describe("board geometry", () => {
  it("counts lines, boxes and dots", () => {
    for (const n of [1, 2, 8, 10, 12]) {
      assert.equal(lineCount(n), 2 * n * (n + 1));
      assert.equal(hCount(n), n * (n + 1));
      assert.equal(boxCount(n), n * n);
      assert.equal(dotCount(n), (n + 1) ** 2);
    }
    // The numbers quoted in PROJECT.md §8.1.
    assert.equal(lineCount(8), 144);
    assert.equal(lineCount(9), 180);
    assert.equal(lineCount(10), 220);
  });

  it("gives every line a unique id in range", () => {
    const n = 6;
    const seen = new Set<number>();
    for (let r = 0; r <= n; r++) {
      for (let c = 0; c < n; c++) seen.add(hLineId(n, r, c));
    }
    for (let r = 0; r < n; r++) {
      for (let c = 0; c <= n; c++) seen.add(vLineId(n, r, c));
    }
    assert.equal(seen.size, lineCount(n));
    for (const id of seen) assert.ok(isValidLineId(n, id));
  });

  it("splits ids into horizontals then verticals", () => {
    const n = 5;
    assert.ok(isHorizontal(n, hLineId(n, 0, 0)));
    assert.ok(isHorizontal(n, hLineId(n, n, n - 1)));
    assert.ok(!isHorizontal(n, vLineId(n, 0, 0)));
    assert.ok(!isHorizontal(n, vLineId(n, n - 1, n)));
  });

  it("round-trips box id and row/col", () => {
    const n = 7;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const id = boxId(n, r, c);
        assert.equal(boxRow(n, id), r);
        assert.equal(boxCol(n, id), c);
      }
    }
  });

  it("agrees between boxLineIds and lineBoxes", () => {
    const n = 5;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const box = boxId(n, r, c);
        for (const line of boxLineIds(n, r, c)) {
          const [a, b] = lineBoxes(n, line);
          assert.ok(
            a === box || b === box,
            `line ${line} should border box ${box} (r${r} c${c})`,
          );
        }
      }
    }
  });

  it("gives edge lines one box and interior lines two", () => {
    const n = 4;
    // Top edge: nothing above.
    const top = lineBoxes(n, hLineId(n, 0, 0));
    assert.equal(top[0], -1);
    assert.equal(top[1], boxId(n, 0, 0));

    // Bottom edge: nothing below.
    const bottom = lineBoxes(n, hLineId(n, n, 0));
    assert.equal(bottom[0], boxId(n, n - 1, 0));
    assert.equal(bottom[1], -1);

    // Left edge, right edge.
    assert.equal(lineBoxes(n, vLineId(n, 0, 0))[0], -1);
    assert.equal(lineBoxes(n, vLineId(n, 0, n))[1], -1);

    // Interior horizontal: box above and box below.
    const mid = lineBoxes(n, hLineId(n, 2, 1));
    assert.deepEqual(mid, [boxId(n, 1, 1), boxId(n, 2, 1)]);

    // Every line borders at least one box.
    for (let id = 0; id < lineCount(n); id++) {
      const [a, b] = lineBoxes(n, id);
      assert.ok(a >= 0 || b >= 0);
    }
  });

  it("places endpoints one dot apart in the right axis", () => {
    const n = 4;
    for (let id = 0; id < lineCount(n); id++) {
      const { r0, c0, r1, c1 } = lineEndpoints(n, id);
      if (isHorizontal(n, id)) {
        assert.equal(r0, r1);
        assert.equal(c1 - c0, 1);
      } else {
        assert.equal(c0, c1);
        assert.equal(r1 - r0, 1);
      }
      for (const v of [r0, c0, r1, c1]) {
        assert.ok(v >= 0 && v <= n);
      }
    }
  });

  it("rejects out-of-range line ids", () => {
    const n = 4;
    assert.ok(!isValidLineId(n, -1));
    assert.ok(!isValidLineId(n, lineCount(n)));
    assert.ok(!isValidLineId(n, 1.5));
    assert.ok(!isValidLineId(n, NaN));
    assert.ok(isValidLineId(n, 0));
    assert.ok(isValidLineId(n, lineCount(n) - 1));
  });
});

describe("grid sizing", () => {
  it("matches the table in PROJECT.md", () => {
    const expected: Record<number, number> = {
      2: 8,
      3: 8,
      4: 8,
      5: 9,
      6: 9,
      7: 10,
      8: 10,
    };
    for (const [players, grid] of Object.entries(expected)) {
      assert.equal(gridSizeFor(Number(players)), grid, `${players} players`);
    }
  });

  it("stays inside its bounds and never shrinks as players are added", () => {
    let prev = 0;
    for (let p = 2; p <= 8; p++) {
      const g = gridSizeFor(p);
      assert.ok(g >= MIN_GRID && g <= MAX_GRID);
      assert.ok(g >= prev);
      prev = g;
    }
  });
});
