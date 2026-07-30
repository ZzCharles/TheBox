import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hLineId } from "./board.ts";
import { applyMove, armWildcard, bench, buyWildcard, createGame, skipTurn } from "./rules.ts";
import { fromSnapshot, toSnapshot } from "./snapshot.ts";

describe("snapshot round-trip", () => {
  it("preserves a fresh game exactly", () => {
    const before = createGame({ n: 8, mode: "simple", playerCount: 4 });
    const after = fromSnapshot(toSnapshot(before));
    assert.deepEqual(after, before);
  });

  it("preserves a game in progress, including turn order and bench state", () => {
    const s = createGame({ n: 6, mode: "twist", playerCount: 5, turnOrder: [3, 1, 4, 0, 2] });

    // Make the state genuinely messy: moves, a claim, a skip, a bench, a purchase.
    const n = 6;
    assert.ok(applyMove(s, 3, hLineId(n, 0, 0)).ok);
    assert.ok(applyMove(s, 1, hLineId(n, 1, 0)).ok);
    assert.ok(skipTurn(s, 4).ok);
    bench(s, 0);

    s.scores[2] = 12;
    for (let i = 0; i < 12; i++) s.boxes[i] = 2;
    s.boxesRemaining -= 12;
    assert.ok(buyWildcard(s, 2).ok);
    assert.ok(armWildcard(s, 2).ok);

    const round = fromSnapshot(toSnapshot(s));

    assert.deepEqual(round, s);
    assert.deepEqual([...round.lines], [...s.lines]);
    assert.deepEqual([...round.boxes], [...s.boxes]);
    assert.deepEqual([...round.turnOrder], [...s.turnOrder]);
    assert.equal(round.armed, s.armed);
    assert.equal(round.turnSeq, s.turnSeq);
    assert.equal(round.paused, s.paused);
  });

  it("keeps typed-array types, not plain arrays", () => {
    const s = fromSnapshot(toSnapshot(createGame({ n: 4, mode: "simple", playerCount: 2 })));
    assert.ok(s.lines instanceof Uint8Array);
    assert.ok(s.boxes instanceof Int8Array);
    assert.ok(s.scores instanceof Int32Array);
    assert.ok(s.turnOrder instanceof Int32Array);
  });

  it("survives JSON, which is how it actually crosses the wire", () => {
    const s = createGame({ n: 5, mode: "twist", playerCount: 3 });
    assert.ok(applyMove(s, 0, hLineId(5, 2, 2)).ok);

    const round = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(s))));
    assert.deepEqual(round, s);
  });

  it("keeps a snapshot independent of the state it came from", () => {
    const s = createGame({ n: 4, mode: "simple", playerCount: 2 });
    const snap = toSnapshot(s);
    assert.ok(applyMove(s, 0, hLineId(4, 0, 0)).ok);
    assert.equal(snap.lines[hLineId(4, 0, 0)], 0, "snapshot must not alias live state");
    assert.equal(snap.turnSeq, 0);
  });
});
