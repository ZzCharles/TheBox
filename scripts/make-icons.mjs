/**
 * Generate the PWA icon set from the Tiki mark. Run: `npm run icons`.
 *
 * **Procedural, not a drawn asset**, for the same reason §13's sounds are
 * synthesised rather than sampled: the mark is defined by numbers that already
 * live in the codebase, so deriving the icon from them means the icon cannot
 * drift from the logo on the landing screen. Retuning it is editing a constant,
 * not opening an editor, and there is no binary source file to lose.
 *
 * **No dependencies.** Node's own `zlib` is all a PNG needs — the encoder is at
 * the foot of this file and is about forty lines. Adding `sharp` to a project
 * whose entire dependency list is six packages, to draw one circle and one
 * rounded rectangle, is not a trade worth making.
 *
 * THE MARK (from `.tiki .mk` in base.css, in em where 1em is the font size):
 *   dot   0.19em across, at the top — a real game dot, warm and glowing
 *   gap   0.09em
 *   stem  0.135em wide, 0.52em tall, fully rounded — a real drawn line
 *   total 0.80em
 *
 * That shape IS the game: a dot and a line. It needs no further idea.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

// --- palette, from §11 and base.css --------------------------------------

const INK = [0x0b, 0x0d, 0x12];
const RISE = [0x13, 0x17, 0x22];
const DOT = [0xff, 0xc2, 0x4b];
const GLOW = [0xff, 0xb0, 0x20];

/** Supersampling factor. 4 means 16 samples a pixel, which is plenty for curves. */
const SS = 4;

/**
 * Mark height as a fraction of the icon.
 *
 * ⚠️ **The maskable one is smaller on purpose.** A maskable icon may be cropped
 * to any shape the launcher likes, and only the central 80% circle is
 * guaranteed to survive. 0.50 keeps the whole mark — including its glow — well
 * inside that, where 0.62 puts the dot's halo near the edge of the safe zone
 * and a circular mask would clip the light off the top of it.
 */
const MARK_FRACTION = { normal: 0.62, maskable: 0.5 };

// --- the icon ------------------------------------------------------------

/** Squared-distance parameter of an elliptical gradient ray, 0 at the centre. */
function ellipseT(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return Math.sqrt(dx * dx + dy * dy);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Colour at one sample point, as [r, g, b] in 0–255.
 *
 * Layered exactly like the real page: the cool blue rise, the warm lamp wash
 * over it (§11 — this is what stops the dark reading as a cold screen instead
 * of a lit surface), then the mark and its glow on top.
 */
function sample(x, y, size, markFraction) {
  // 1. The ground: radial-gradient(150% 90% at 50% 0%, --rise, --ink 58%)
  const t = ellipseT(x, y, size / 2, 0, size * 1.5, size * 0.9);
  const k = clamp01(t / 0.58);
  let r = lerp(RISE[0], INK[0], k);
  let g = lerp(RISE[1], INK[1], k);
  let b = lerp(RISE[2], INK[2], k);

  // 2. The warm lamp: radial-gradient(120% 62% at 50% -10%, glow 5.5%, transparent 60%)
  const wt = ellipseT(x, y, size / 2, -0.1 * size, size * 1.2, size * 0.62);
  const wa = 0.055 * (1 - clamp01(wt / 0.6));
  r = lerp(r, GLOW[0], wa);
  g = lerp(g, GLOW[1], wa);
  b = lerp(b, GLOW[2], wa);

  // 3. Mark geometry. One em is derived from the height the mark should occupy,
  //    so every proportion below stays exactly the CSS one.
  const em = (size * markFraction) / 0.8;
  const dotD = 0.19 * em;
  const gap = 0.09 * em;
  const stemW = 0.135 * em;
  const stemH = 0.52 * em;
  const total = dotD + gap + stemH;

  const cx = size / 2;
  const top = (size - total) / 2;
  const dotCy = top + dotD / 2;
  const dotR = dotD / 2;
  const stemTop = top + dotD + gap;
  const stemBottom = stemTop + stemH;
  // Fully rounded ends: the CSS radius (0.07em) exceeds half the width, and the
  // browser clamps it. Round caps are also what the game draws its lines with.
  const stemR = stemW / 2;

  /*
   * 4. The glow, before the solids, so the shapes sit ON their own light.
   *
   * ⚠️ **NOT a literal transcription of the CSS box-shadows**, and the first
   * attempt was. `.tiki .mk` glows with `0 0 .34em .08em` at 75% and 30%
   * stacked, which is a subtle halo at text size and a floodlight at 512px:
   * the two layers saturated to full alpha across most of the icon, and — the
   * part that actually broke it — the light filled the 0.09em GAP between the
   * dot and the stem, welding them into one blob. The gap is the whole mark.
   * Lose it and this is a thermometer, not a dotted i.
   *
   * So the spreads are roughly a third of the CSS ones and the alphas about
   * two thirds, and the layers combine as coverage rather than by addition.
   */
  const dDot = Math.hypot(x - cx, y - dotCy);
  const dotGlow = union(
    0.5 * falloff(dDot, dotR + 0.008 * em, 0.055 * em),
    0.22 * falloff(dDot, dotR + 0.02 * em, 0.15 * em),
  );

  // The stem's own halo, dimmer than the dot's — the dot is the light source.
  const dStem = roundedRectDistance(x, y, cx, stemTop, stemBottom, stemR);
  const stemGlowA = 0.26 * falloff(dStem, 0, 0.055 * em);

  const a = clamp01(union(dotGlow, stemGlowA));
  r = lerp(r, GLOW[0], a);
  g = lerp(g, GLOW[1], a);
  b = lerp(b, GLOW[2], a);

  // 5. The solids. Binary here — the antialiasing comes from supersampling,
  //    which is why SS exists rather than a per-shape coverage calculation.
  if (dDot <= dotR || dStem <= 0) {
    r = DOT[0];
    g = DOT[1];
    b = DOT[2];
  }

  return [r, g, b];
}

/**
 * Combine two coverages the way overlapping light actually behaves: neither
 * can push the result past full. Adding them instead is what blew the first
 * render out to a solid sheet of amber.
 */
function union(a, b) {
  return 1 - (1 - a) * (1 - b);
}

/** 1 at the shape edge, decaying to 0 over `spread`. Mimics a box-shadow blur. */
function falloff(distance, radius, spread) {
  if (spread <= 0) return 0;
  const d = (distance - radius) / spread;
  if (d <= 0) return 1;
  if (d >= 1) return 0;
  // Smoothstep — a linear ramp reads as a hard ring rather than a glow.
  return 1 - d * d * (3 - 2 * d);
}

/**
 * Signed distance to a vertical capsule (the stem): negative inside, and the
 * true distance outside, which is what makes the glow around it even.
 */
function roundedRectDistance(x, y, cx, top, bottom, radius) {
  const centreTop = top + radius;
  const centreBottom = bottom - radius;
  const cy = Math.max(centreTop, Math.min(centreBottom, y));
  return Math.hypot(x - cx, y - cy) - radius;
}

/** Render one icon to a raw RGBA buffer. */
function render(size, markFraction) {
  const px = Buffer.alloc(size * size * 4);
  const step = 1 / SS;
  const offset = step / 2;

  for (let py = 0; py < size; py++) {
    for (let pxx = 0; pxx < size; pxx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(
            pxx + offset + sx * step,
            py + offset + sy * step,
            size,
            markFraction,
          );
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = SS * SS;
      const i = (py * size + pxx) * 4;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
      // Fully opaque throughout. A maskable icon MUST fill its canvas, and iOS
      // composites an apple-touch-icon onto white — a transparent corner there
      // becomes a white corner on a very dark icon.
      px[i + 3] = 255;
    }
  }
  return px;
}

// --- PNG ------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crcBuf = Buffer.concat([Buffer.from(type, "ascii"), data]);
  out.writeUInt32BE(crc32(crcBuf), data.length + 8);
  return out;
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte per scanline. Filter 0 (None) throughout: the image is
  // mostly smooth gradient, which deflate handles well enough that per-line
  // filter selection would add code for a few hundred bytes.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- go -------------------------------------------------------------------

const TARGETS = [
  { file: "icon-192.png", size: 192, mark: MARK_FRACTION.normal },
  { file: "icon-512.png", size: 512, mark: MARK_FRACTION.normal },
  { file: "icon-maskable-512.png", size: 512, mark: MARK_FRACTION.maskable },
  { file: "apple-touch-icon.png", size: 180, mark: MARK_FRACTION.normal },
];

mkdirSync(OUT, { recursive: true });
for (const { file, size, mark } of TARGETS) {
  const png = encodePng(render(size, mark), size);
  writeFileSync(join(OUT, file), png);
  console.log(`${file.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
