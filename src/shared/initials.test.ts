import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assignInitials } from "./initials.ts";

describe("assignInitials", () => {
  it("uses the first letter of each name", () => {
    assert.deepEqual(assignInitials(["Ada", "Brin", "Cass"]), ["A", "B", "C"]);
  });

  it("grows everyone who clashes, rather than moving one of them", () => {
    // The rule from the design pass: Sarah + Smith -> Sa + Sm. Both keep their
    // real first letter and gain more of their own name.
    assert.deepEqual(assignInitials(["Sarah", "Smith"]), ["SA", "SM"]);
    assert.deepEqual(assignInitials(["Ada", "Alan"]), ["AD", "AL"]);
  });

  it("keeps growing until the clash is resolved, up to three", () => {
    assert.deepEqual(assignInitials(["Sam", "Sara", "Sasha"]), ["SAM", "SAR", "SAS"]);
  });

  it("leaves names that never clashed on a single letter", () => {
    // Only the clashing group grows; Bo has no reason to become "BO".
    assert.deepEqual(assignInitials(["Sam", "Sara", "Bo"]), ["SAM", "SAR", "B"]);
  });

  it("is case insensitive", () => {
    assert.deepEqual(assignInitials(["ada", "ALAN"]), ["AD", "AL"]);
  });

  it("ignores spaces, punctuation and emoji", () => {
    assert.deepEqual(assignInitials(["  jo-jo ", "!!!kim"]), ["J", "K"]);
    assert.deepEqual(assignInitials(["🎉party"]), ["P"]);
  });

  it("accepts digits, so numeric names still get something", () => {
    assert.deepEqual(assignInitials(["Ada", "42"]), ["A", "4"]);
  });

  it("never repeats a label, however awkward the roster", () => {
    const names = ["Bo", "Bo", "Bo", "Bob", "B", "O", "Ob", "Bobo"];
    const out = assignInitials(names);
    assert.equal(out.length, names.length);
    assert.equal(new Set(out).size, names.length, `duplicates in ${out.join(",")}`);
  });

  it("never exceeds three characters", () => {
    const out = assignInitials(["Alexander", "Alexandra", "Alexis", "Alessandro"]);
    assert.ok(
      out.every((label) => label.length <= 3),
      `too long: ${out.join(",")}`,
    );
    assert.equal(new Set(out).size, 4);
  });

  it("survives names with no usable characters at all", () => {
    const out = assignInitials(["Ada", "🙂", "   "]);
    assert.equal(out[0], "A");
    assert.equal(new Set(out).size, 3, "still distinct");
    assert.ok(out.every((label) => label.length >= 1));
  });

  it("handles a full eight-player lobby of similar names", () => {
    const out = assignInitials([
      "Sam", "Sara", "Sasha", "Steve", "Sue", "Sid", "Sol", "Sky",
    ]);
    assert.equal(new Set(out).size, 8);
    assert.ok(out.every((label) => label.startsWith("S")), "everyone keeps their S");
  });

  it("returns an empty list for an empty roster", () => {
    assert.deepEqual(assignInitials([]), []);
  });
});
