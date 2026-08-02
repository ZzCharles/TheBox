/**
 * Turning player names into the short labels shown inside claimed boxes.
 *
 * Pure, and shared so the server and every client derive the same letters from
 * the same roster — a label that differs between screens would be worse than no
 * label at all.
 */

/** Letters and digits from a name, uppercased, in order. */
function usableChars(name: string): string[] {
  return [...name.toUpperCase()].filter((c) => /[A-Z0-9]/.test(c));
}

const FALLBACK_POOL = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];

/**
 * Nobody needs four characters to tell two people apart, and a four-character
 * label does not fit in a box on a Grand board.
 */
const MAX_LETTERS = 3;

/**
 * One letter per player where possible, in roster order.
 *
 * If two people in the room share a first letter, **everyone who clashes grows
 * a letter** until they are all different — `Sarah` + `Smith` become `Sa` + `Sm`
 * rather than one of them keeping `S` and the other jumping to an unrelated
 * letter. Growing together is legible; jumping is not. `Alan` after `Ada` used
 * to become `L`, which nobody could connect back to a name.
 *
 * Note this deliberately reverses the older "earlier players keep their letter"
 * rule: a newcomer whose name clashes now does change the incumbent's label,
 * from `S` to `Sa`. It is the same first letter with more of the same name after
 * it, so it still reads as theirs, and the roster locks when the game starts —
 * so it can only ever happen in the lobby.
 *
 * Colour is the primary identifier; the letter is a shortcut.
 */
export function assignInitials(names: string[]): string[] {
  const chars = names.map(usableChars);
  const out = chars.map((c) => c.slice(0, 1).join(""));

  for (let length = 1; length < MAX_LETTERS; length++) {
    const seen = new Map<string, number>();
    for (const label of out) seen.set(label, (seen.get(label) ?? 0) + 1);
    if (![...seen.values()].some((n) => n > 1)) break;

    for (let i = 0; i < out.length; i++) {
      if ((seen.get(out[i]!) ?? 0) > 1) {
        out[i] = chars[i]!.slice(0, length + 1).join("");
      }
    }
  }

  /*
   * Two people called the exact same thing still collide at the cap, as does
   * anyone whose name has no usable characters at all. Fall back to any unused
   * character rather than putting the same label on two players' boxes.
   */
  const taken = new Set<string>();
  for (let i = 0; i < out.length; i++) {
    const label = out[i]!;
    if (label !== "" && !taken.has(label)) {
      taken.add(label);
      continue;
    }
    const free = FALLBACK_POOL.find((c) => !taken.has(c)) ?? "?";
    out[i] = free;
    taken.add(free);
  }

  return out;
}
