/**
 * The Tiki wordmark.
 *
 * The first `i` IS the logo: its dot is a real game dot — round, warm, glowing
 * — and its stem is a real drawn line. The second `i` keeps its ordinary
 * rectangular type dot, and that contrast is what makes the first one read as
 * deliberate rather than as a broken glyph.
 *
 * Title case, not caps, because the whole mark depends on a lowercase dotted i.
 *
 * @param assemble Play the load-in, where the dot drops and the stem then draws
 *                 down from it with the game's own line-placing easing. Pass
 *                 false anywhere a performance would be inappropriate — an
 *                 error screen, for instance.
 */
export function wordmark(assemble = true): string {
  return (
    `<span class="tiki${assemble ? " assemble" : ""}" role="img" aria-label="Tiki">` +
    `T<span class="mk" aria-hidden="true"><s></s><b></b></span>ki</span>`
  );
}
