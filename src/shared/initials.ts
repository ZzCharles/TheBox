/**
 * Turning player names into the single letters shown inside claimed boxes.
 *
 * Pure, and shared so the server and every client derive the same letters from
 * the same roster — an initial that differs between screens would be worse than
 * no initial at all.
 */

/** Letters and digits from a name, uppercased, in order. */
function usableChars(name: string): string[] {
  return [...name.toUpperCase()].filter((c) => /[A-Z0-9]/.test(c));
}

const FALLBACK_POOL = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];

/**
 * One distinct letter per player, in roster order.
 *
 * A player gets the first letter of their name. If that is already taken, they
 * fall through to their SECOND letter, then their third, and so on — so Ada and
 * Alan become A and L rather than A and a meaningless B.
 *
 * Earlier players keep their first initial; only the later clashing name moves.
 * That matters because someone who has been in the lobby a while should not have
 * their letter changed by a newcomer.
 */
export function assignInitials(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    for (const c of usableChars(name)) {
      if (!taken.has(c)) {
        taken.add(c);
        return c;
      }
    }
    // Every letter of their name is spoken for (e.g. "Bob" after "B" and "O"
    // are gone). Fall back to any unused character so the board stays readable.
    for (const c of FALLBACK_POOL) {
      if (!taken.has(c)) {
        taken.add(c);
        return c;
      }
    }
    return "?";
  });
}
