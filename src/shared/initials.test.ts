import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assignInitials } from "./initials.ts";

describe("assignInitials", () => {
  it("uses the first letter of each name", () => {
    assert.deepEqual(assignInitials(["Ada", "Brin", "Cass"]), ["A", "B", "C"]);
  });

  it("falls through to the second letter when two names start alike", () => {
    assert.deepEqual(assignInitials(["Ada", "Alan"]), ["A", "L"]);
  });

  it("keeps the earlier player's letter and moves the newcomer", () => {
    // Someone who has been in the lobby should not lose their letter to a
    // player who just arrived.
    const [first, second] = assignInitials(["Sam", "Sara"]);
    assert.equal(first, "S");
    assert.equal(second, "A");
  });

  it("walks further along the name when several names collide", () => {
    assert.deepEqual(assignInitials(["Sam", "Sara", "Sasha"]), ["S", "A", "H"]);
  });

  it("is case insensitive", () => {
    assert.deepEqual(assignInitials(["ada", "ALAN"]), ["A", "L"]);
  });

  it("ignores spaces, punctuation and emoji", () => {
    assert.deepEqual(assignInitials(["  jo-jo ", "!!!kim"]), ["J", "K"]);
    assert.deepEqual(assignInitials(["🎉party"], ), ["P"]);
  });

  it("accepts digits, so numeric names still get something", () => {
    assert.deepEqual(assignInitials(["Ada", "42"]), ["A", "4"]);
  });

  it("never repeats a letter, however awkward the roster", () => {
    const names = ["Bo", "Bo", "Bo", "Bob", "B", "O", "Ob", "Bobo"];
    const out = assignInitials(names);
    assert.equal(out.length, names.length);
    assert.equal(new Set(out).size, names.length, `duplicates in ${out.join(",")}`);
    assert.ok(out.every((c) => c.length === 1));
  });

  it("survives names with no usable characters at all", () => {
    const out = assignInitials(["Ada", "🙂", "   "]);
    assert.equal(out[0], "A");
    assert.equal(new Set(out).size, 3, "still distinct");
    assert.ok(out.every((c) => c.length === 1));
  });

  it("handles a full eight-player lobby of similar names", () => {
    const out = assignInitials([
      "Sam", "Sara", "Sasha", "Steve", "Sue", "Sid", "Sol", "Sky",
    ]);
    assert.equal(new Set(out).size, 8);
    assert.equal(out[0], "S", "the first Sam keeps S");
  });

  it("returns an empty list for an empty roster", () => {
    assert.deepEqual(assignInitials([]), []);
  });
});
