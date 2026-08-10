import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { STREAK_TIERS, streakTier } from "./constants.ts";

describe("streak tiers", () => {
  it("says nothing below the first rung", () => {
    for (let boxes = 0; boxes < STREAK_TIERS[0].at; boxes++) {
      assert.equal(streakTier(boxes), null, `${boxes} boxes should not call out`);
    }
  });

  it("lands on each rung exactly at its threshold", () => {
    for (const tier of STREAK_TIERS) {
      assert.equal(streakTier(tier.at)?.word, tier.word);
    }
  });

  it("takes the HIGHEST tier that fits, not the first", () => {
    // The tiers are listed ascending, so a naive "first match wins" loop would
    // call a 13-box turn "Nice" — the exact inversion worth guarding.
    const top = STREAK_TIERS[STREAK_TIERS.length - 1]!;
    assert.equal(streakTier(top.at)?.word, top.word);
    assert.equal(streakTier(top.at + 40)?.word, top.word, "nothing beats the top rung");
  });

  it("never skips a rung as the haul climbs", () => {
    // A chain climbs one box at a time, and the callout escalates with it. If
    // the ladder ever went backwards, a long chain would cool off mid-run.
    let lastAt = -1;
    for (let boxes = 0; boxes <= 40; boxes++) {
      const at = streakTier(boxes)?.at ?? -1;
      assert.ok(at >= lastAt, `tier went backwards at ${boxes} boxes`);
      lastAt = at;
    }
  });

  it("keeps the rungs in ascending order, which the lookup depends on", () => {
    for (let i = 1; i < STREAK_TIERS.length; i++) {
      assert.ok(
        STREAK_TIERS[i]!.at > STREAK_TIERS[i - 1]!.at,
        "tiers must ascend — streakTier and the CSS both assume it",
      );
    }
  });
});
