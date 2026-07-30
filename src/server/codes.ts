/**
 * Room codes.
 *
 * Four characters from a deliberately reduced alphabet: no O/0, no I/1, no S/5.
 * People read these aloud and type them on phone keyboards, and a code that is
 * ambiguous out loud is worse than a code that is one character longer.
 *
 * 29^4 = ~707k codes. Collisions do not corrupt anything — a collision just
 * means two groups would share a lobby — so creation asks the Durable Object to
 * `claim()` its code and retries if it is already taken.
 */

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";
export const CODE_LENGTH = 4;

export function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) {
    out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return out;
}

/** Normalise user input: uppercase, strip anything not in the alphabet. */
export function normaliseCode(input: string): string {
  return input
    .toUpperCase()
    .split("")
    .filter((c) => CODE_ALPHABET.includes(c))
    .join("")
    .slice(0, CODE_LENGTH);
}

export function isValidCode(input: string): boolean {
  return normaliseCode(input).length === CODE_LENGTH;
}
