/**
 * Fail the build if a voice line names a file that is not there — **with the
 * exact case it is requested in**. Runs as part of `npm run check`.
 *
 * ⚠️ **This exists because the failure it catches is invisible.** The deployed
 * Worker serves assets case-sensitively AND answers an unknown path with the
 * SPA fallback at **status 200**, not a 404. So a file named `Nice.mp3` where
 * the code asks for `nice.mp3` fetches "successfully", returns HTML, fails to
 * decode, and goes silent for the rest of the session with nothing logged.
 * Meanwhile the developer's Windows filesystem is case-insensitive, so it works
 * perfectly in local testing and only breaks once deployed. That combination —
 * silent in production, invisible in dev — is exactly what a build check is for.
 * It happened on 2026-08-13 with six of the nine lines.
 *
 * `fs.existsSync` is NO USE here: on Windows and macOS it matches
 * case-insensitively and would happily pass the broken set. The directory has to
 * be listed and the names compared as strings.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const voiceDir = join(root, "public", "sfx", "voice");

/**
 * Read the URLs straight out of `voice.ts` rather than restating them.
 *
 * A second hand-maintained list of filenames is the same bug wearing a
 * different hat: it would drift, and the drift would be silent again.
 */
const source = await import("node:fs/promises").then((fs) =>
  fs.readFile(join(root, "src", "client", "audio", "voice.ts"), "utf8"),
);

const referenced = [...source.matchAll(/["'](\/sfx\/voice\/[^"']+)["']/g)].map((m) => m[1]);
if (referenced.length === 0) {
  console.error("check-assets: found no /sfx/voice/ paths in voice.ts — has it moved?");
  process.exit(1);
}

let present;
try {
  present = new Set(readdirSync(voiceDir));
} catch {
  present = new Set();
}

const missing = referenced.filter((url) => !present.has(url.split("/").pop()));

if (missing.length > 0) {
  console.error("\ncheck-assets: voice lines reference files that are not present:\n");
  for (const url of missing) {
    const wanted = url.split("/").pop();
    // Name the near-miss explicitly. "nice.mp3 is missing" is unhelpful when
    // Nice.mp3 is sitting right there — the whole failure is that they look
    // the same to a human and are different to the server.
    const nearMiss = [...present].find((f) => f.toLowerCase() === wanted.toLowerCase());
    console.error(
      nearMiss
        ? `  ${wanted}  — found "${nearMiss}", which differs only by case. Rename it.`
        : `  ${wanted}  — not found in public/sfx/voice/`,
    );
  }
  console.error(
    "\nThe deployed Worker is case-sensitive and answers a bad path with 200 + HTML,\n" +
      "so these would fail silently in production while working on Windows.\n",
  );
  process.exit(1);
}

console.log(`check-assets: ${referenced.length} voice files present, exact case.`);
