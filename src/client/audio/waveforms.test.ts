import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderSfx, SFX_NAMES, SFX_SECONDS } from "./waveforms.ts";

/**
 * These are the only tests in the client, and they exist because sound is the
 * one part of the game you cannot see. A waveform that clips, starts on a
 * non-zero sample, or renders silence looks exactly like a working one in
 * devtools — you find out on a phone, in a room, with other people listening.
 */
describe("sfx waveforms", () => {
  for (const name of SFX_NAMES) {
    describe(name, () => {
      const buffer = renderSfx(name, 48_000);

      it("is the length the table says it is", () => {
        assert.equal(buffer.length, Math.round(SFX_SECONDS[name] * 48_000));
      });

      it("never clips and is never silent", () => {
        let peak = 0;
        for (const s of buffer) {
          assert.ok(Number.isFinite(s), `${name} produced ${s}`);
          peak = Math.max(peak, Math.abs(s));
        }
        assert.ok(peak <= 1, `${name} peaks at ${peak}, which clips`);
        assert.ok(peak > 0.1, `${name} peaks at ${peak} — effectively silence`);
      });

      it("starts and ends on silence, so it cannot click", () => {
        assert.ok(Math.abs(buffer[0]!) < 1e-9);
        assert.ok(Math.abs(buffer[buffer.length - 1]!) < 1e-9);
      });

      it("renders identically every time", () => {
        assert.deepEqual(renderSfx(name, 48_000), buffer);
      });

      it("holds its length at 44.1k too", () => {
        // Chrome hands out 48k, Safari often 44.1k, and a buffer built at the
        // wrong rate plays back at the wrong pitch and duration.
        assert.equal(renderSfx(name, 44_100).length, Math.round(SFX_SECONDS[name] * 44_100));
      });
    });
  }

  it("keeps the sounds you hear constantly quieter than the ones you don't", () => {
    // tick fires on every line and blip interrupts you mid-thought; the fanfare
    // happens once. Loudness order is a design decision, so it gets a test.
    const peak = (name: (typeof SFX_NAMES)[number]) =>
      renderSfx(name, 48_000).reduce((m, s) => Math.max(m, Math.abs(s)), 0);

    assert.ok(peak("blip") < peak("tick"));
    assert.ok(peak("tick") < peak("click"));
    assert.ok(peak("click") < peak("fanfare"));
  });
});
