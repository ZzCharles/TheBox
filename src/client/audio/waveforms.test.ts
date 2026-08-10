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
    assert.ok(peak("click") < peak("crack"));
    assert.ok(peak("crack") < peak("fanfare"));
  });

  /*
   * The two sounds the 2026-08-10 playtest asked for by name. Length, clipping
   * and endpoints are already covered above and say nothing about CHARACTER —
   * an impact and a stroke of the same length pass every one of those tests
   * identically, and character is the entire point of the rework.
   */
  it("draws tick rather than striking it", () => {
    // A pencil stroke has an attack: the point bites, then travels. An impact
    // is loudest at the very first sample. That difference is the whole
    // complaint ("should sound like drawing a line on paper"), and reverting to
    // a decay-from-zero envelope would pass every other test in this file.
    const sr = 48_000;
    const buffer = renderSfx("tick", sr);

    let peakAt = 0;
    let peak = 0;
    for (let i = 0; i < buffer.length; i++) {
      const s = Math.abs(buffer[i]!);
      if (s > peak) {
        peak = s;
        peakAt = i;
      }
    }
    assert.ok(
      peakAt / sr > 0.003,
      `tick peaks at ${((peakAt / sr) * 1000).toFixed(1)}ms — that is a strike, not a stroke`,
    );

    // And it keeps travelling: the middle of the sound still carries real level
    // rather than being tail.
    const third = Math.floor(buffer.length / 3);
    const rms = (from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += buffer[i]! * buffer[i]!;
      return Math.sqrt(sum / (to - from));
    };
    assert.ok(rms(third, 2 * third) > rms(0, third) * 0.15, "tick has no body, only an onset");
  });

  it("keeps the grain in tick, which is what stops it being a hiss", () => {
    /*
     * Paper has tooth, and the tooth here is built from sparse IMPULSES — one
     * per fibre giving way. Without them this is filtered white noise, which is
     * a hiss.
     *
     * Measured as the average level change between neighbouring 1ms windows.
     * The overall decay is smooth and cancels out, so only the grain moves this
     * number. Three renders when this was written:
     *
     *   0.435  impulse grains          — shipped, chosen from three candidates
     *   0.224  smooth 110Hz modulation — BUILT AND REJECTED: "still doesnt
     *                                    sound like paper". 110Hz is a wobble.
     *   0.117  no modulation at all    — plain filtered noise
     *
     * The threshold sits above the rejected version on purpose. A test that
     * only caught the third case would have passed the sound that failed.
     */
    const sr = 48_000;
    const buffer = renderSfx("tick", sr);
    const win = Math.round(0.001 * sr);
    const levels: number[] = [];
    for (let i = Math.round(0.005 * sr); i + win < Math.round(0.04 * sr); i += win) {
      let sum = 0;
      for (let j = i; j < i + win; j++) sum += buffer[j]! * buffer[j]!;
      levels.push(Math.sqrt(sum / win));
    }

    let jitter = 0;
    for (let i = 1; i < levels.length; i++) {
      jitter += Math.abs(Math.log((levels[i]! + 1e-12) / (levels[i - 1]! + 1e-12)));
    }
    jitter /= levels.length - 1;

    assert.ok(jitter > 0.32, `tick's grain is gone (${jitter.toFixed(3)}) — it is a hiss again`);
  });

  it("keeps click metallic rather than wooden", () => {
    /*
     * The brief was "like when you press a padlock", and the original failed it
     * by having a SINE for a body — a tone, where a padlock is metal. Metal is
     * bright and inharmonic.
     *
     * Zero crossings per second is a coarse brightness proxy, but it separates
     * these cleanly: 5156 for the metallic take that shipped, 1511 for the
     * wooden block it replaced. Drop a low sine back in as the body and this
     * falls straight through the threshold.
     */
    const sr = 48_000;
    const buffer = renderSfx("click", sr);

    let crossings = 0;
    for (let i = 1; i < buffer.length; i++) {
      if (buffer[i]! >= 0 !== buffer[i - 1]! >= 0) crossings++;
    }
    const rate = crossings / (buffer.length / sr);

    assert.ok(rate > 3000, `click has gone woody (${Math.round(rate)}Hz zero crossings)`);
  });

  it("puts click's energy at the front, because that is what crisp is", () => {
    // "A genuinely satisfying click", asked for after the woody version. Wood
    // rings; a mechanism does not. If the body's decay creeps back up, this is
    // the test that notices.
    const sr = 48_000;
    const buffer = renderSfx("click", sr);
    const rms = (from: number, to: number) => {
      let sum = 0;
      const end = Math.min(to, buffer.length);
      for (let i = from; i < end; i++) sum += buffer[i]! * buffer[i]!;
      return Math.sqrt(sum / (end - from));
    };

    const front = rms(0, Math.round(0.01 * sr));
    const rest = rms(Math.round(0.01 * sr), buffer.length);
    assert.ok(front > rest * 3, `click rings on (${front.toFixed(3)} vs ${rest.toFixed(3)})`);
  });

  it("gives crack a tail, because the fracture is supposed to travel", () => {
    // The aftershocks at 58/104/157/206ms are what make this a crack spreading
    // along the box boundaries rather than a single thump (§12.3 step 2). They
    // are quiet by design and easy to lose while tuning the rip on top of them,
    // and losing them is inaudible in a waveform view — hence a test.
    const sr = 48_000;
    const buffer = renderSfx("crack", sr);
    const at = (seconds: number) => Math.round(seconds * sr);

    let head = 0;
    let tail = 0;
    for (let i = 0; i < buffer.length; i++) {
      const s = Math.abs(buffer[i]!);
      if (i < at(0.04)) head = Math.max(head, s);
      else if (i >= at(0.05) && i <= at(0.22)) tail = Math.max(tail, s);
    }

    assert.ok(tail > head * 0.05, `crack's aftershocks are inaudible (${tail} vs ${head})`);
    // And they are still aftershocks — a tail louder than the break would read
    // as four separate sounds instead of one event.
    assert.ok(tail < head, `crack's tail (${tail}) outweighs the break itself (${head})`);
  });
});
