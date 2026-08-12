/**
 * "Add Tiki to your home screen" — offered on the result screen, and nowhere
 * else (§14).
 *
 * **Timing is the entire feature.** Chromium fires `beforeinstallprompt` on
 * first load and will show its own infobar if you let it; `pwa.ts` swallows
 * that. Someone who has just opened an invite link has no idea whether they
 * want this game on their home screen. Someone who has just finished a match
 * does. So the offer waits for a result, appears once per session, and takes no
 * space at all when there is nothing to offer.
 *
 * ⚠️ **It must not disturb the endgame.** The result overlay arrives after the
 * shatter's crown (§12.3 step 6) and carries the rematch vote, which is the
 * thing players are actually reaching for. This appends BELOW that, never
 * above it, and never steals focus.
 */

import {
  dismissInstallOffer,
  installOffer,
  isIos,
  promptInstall,
} from "../pwa.ts";

/**
 * Append an install offer to a result overlay, if there is one to make.
 *
 * @param container The `.result` element inside the overlay.
 * @returns true if anything was added — only useful for tests and probes.
 */
export function appendInstallOffer(container: HTMLElement): boolean {
  const offer = installOffer();
  if (!offer) return false;

  const wrap = document.createElement("div");
  wrap.className = "install-offer";

  if (offer.kind === "ios") {
    /*
     * iOS has no install API at all — the only route is the share sheet, by
     * hand. An instruction is worth having rather than nothing: this game is
     * played on phones and iPhone is half of them, so staying silent would mean
     * the feature does not exist for half the players.
     *
     * ⚠️ It is text, NOT a button. A button that cannot do the thing it names
     * is worse than a sentence that explains how to do it yourself.
     */
    wrap.innerHTML = `
      <p class="hint">
        Add Tiki to your home screen: tap <b>Share</b>, then
        <b>Add to Home Screen</b>.
      </p>`;
    container.appendChild(wrap);
    // Spent either way — it is shown once a session, like the real prompt.
    dismissInstallOffer();
    return true;
  }

  wrap.innerHTML = `
    <button class="chip" id="install-app">Add to home screen</button>
    <button class="linkish subtle" id="install-no">Not now</button>`;
  container.appendChild(wrap);

  const install = wrap.querySelector<HTMLButtonElement>("#install-app")!;
  const no = wrap.querySelector<HTMLElement>("#install-no")!;

  install.addEventListener("click", async () => {
    install.disabled = true;
    const outcome = await promptInstall();
    // Either answer ends it. "Dismissed" is an answer, and asking again after
    // one is how a prompt becomes nagging — the same reasoning as the Wildcard
    // nudge in §10.5.
    wrap.remove();
    if (outcome === "accepted") {
      const done = document.createElement("p");
      done.className = "hint";
      done.textContent = "Installed — look for Tiki on your home screen.";
      container.appendChild(done);
    }
  });

  no.addEventListener("click", () => {
    dismissInstallOffer();
    wrap.remove();
  });

  return true;
}

/** Re-exported so callers need only this module. */
export { isIos };
