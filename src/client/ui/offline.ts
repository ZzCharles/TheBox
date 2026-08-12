/**
 * "You're offline" — the screen a cold start with no signal gets instead of the
 * browser's error page (§14).
 *
 * **It is not a dead end, and that is the whole design.** Tiki is a multiplayer
 * Durable Object, so no amount of precaching lets you play with friends without
 * a connection — but **hot seat needs no network at all**, and offering it here
 * turns "come back later" into "play right now, on this phone". That mode
 * already exists and already works offline; this screen just points at it.
 *
 * The rules go on it too, per §14. Someone staring at an offline screen is the
 * one person with nothing else to read, and Dots and Boxes has exactly four
 * rules worth stating.
 *
 * ⚠️ **This is a COLD-START screen.** It must never take over a live match — a
 * socket dropping mid-game keeps the board on screen behind "Reconnecting…"
 * (§7), which recovers state this screen would throw away. `routeNeedsNetwork`
 * in `pwa.ts` is where that boundary is drawn.
 */

import { wordmark } from "./wordmark.ts";

export function mountOffline(root: HTMLElement): () => void {
  root.innerHTML = `
    <main class="setup offline">
      <h1>${wordmark(false)}</h1>
      <p class="tag">you're offline</p>

      <p class="hint">
        Tiki needs a connection to play with friends — the game lives on a
        server so nobody can cheat the clock. You'll come straight back here
        when you're online again.
      </p>

      <button class="primary" id="hotseat">Play on one device</button>
      <p class="hint">This works with no connection at all.</p>

      <section class="rules-card">
        <h2>How to play</h2>
        <ol class="rules">
          <li>On your turn, draw <b>one line</b> between two dots.</li>
          <li>Close the <b>fourth side</b> of a box and it's yours.</li>
          <li>Claim a box and you <b>go again</b> — chains are the whole game.</li>
          <li>When the board is full, <b>most boxes wins</b>.</li>
        </ol>
      </section>

      <button class="linkish subtle" id="retry">Try again</button>
    </main>`;

  const goHotseat = () => {
    location.hash = "#/hotseat";
  };
  // `route()` re-runs on hashchange and lands on the real screen if the network
  // came back; if it did not, it lands right back here, which is the honest
  // answer to "try again".
  const retry = () => {
    if (location.hash === "#/" || location.hash === "") {
      location.reload();
      return;
    }
    location.hash = "#/";
  };

  const hotseatBtn = root.querySelector<HTMLElement>("#hotseat")!;
  const retryBtn = root.querySelector<HTMLElement>("#retry")!;
  hotseatBtn.addEventListener("click", goHotseat);
  retryBtn.addEventListener("click", retry);

  return () => {
    hotseatBtn.removeEventListener("click", goHotseat);
    retryBtn.removeEventListener("click", retry);
  };
}
