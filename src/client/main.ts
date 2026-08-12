import "./styles/base.css";
import "./styles/game.css";

import { mountHotseat } from "./ui/hotseat.ts";
import { mountLanding } from "./ui/landing.ts";
import { mountRoom } from "./ui/room.ts";
import { mountSettings } from "./ui/settings.ts";
import { wordmark } from "./ui/wordmark.ts";
import { applyPrefs } from "./net/identity.ts";
import { initAudio } from "./audio/engine.ts";
import {
  applyPendingReload,
  initInstallPrompt,
  isOffline,
  registerServiceWorker,
  routeNeedsNetwork,
  watchConnectivity,
} from "./pwa.ts";
import { mountOffline } from "./ui/offline.ts";

/**
 * Hash routing, so an invite link is just a URL you can paste into a group chat.
 *
 *   #/            landing
 *   #/r/ABCD      online room (lobby or game, decided by the server)
 *   #/hotseat     one-device play, no networking
 */

const app = document.querySelector<HTMLDivElement>("#app")!;
let dispose: (() => void) | null = null;

function route() {
  dispose?.();
  dispose = null;

  /*
   * Leaving a screen is the moment a deferred app update can land — a new
   * service worker never reloads the page mid-match (§14.4), so it waits here
   * for somewhere that costs nothing. Reloads if one is owed, in which case
   * nothing below runs.
   */
  applyPendingReload();

  // A throw while mounting used to leave the PREVIOUS screen on display, which
  // looks exactly like the app hanging. Say what happened instead.
  try {
    /*
     * Cold start with no network: say so in the app's own voice rather than
     * letting the landing screen offer a Create button that cannot work (§14).
     *
     * ⚠️ This only ever REPLACES a screen at mount. A socket dropping during a
     * match is a completely different situation and is handled far better by
     * the game screen itself, which keeps the board up and says "Reconnecting…"
     * (§7). Never route a live game here.
     */
    if (isOffline() && routeNeedsNetwork(location.hash)) {
      dispose = mountOffline(app);
      return;
    }

    const match = /^#\/r\/([A-Za-z0-9]{4})$/.exec(location.hash);
    if (match) {
      dispose = mountRoom(app, match[1]!.toUpperCase());
      return;
    }
    if (location.hash === "#/hotseat") {
      dispose = mountHotseat(app);
      return;
    }
    if (location.hash === "#/settings") {
      dispose = mountSettings(app);
      return;
    }
    dispose = mountLanding(app);
  } catch (err) {
    showFatal(err);
  }
}

function showFatal(err: unknown) {
  console.error("[box] failed to open screen", err);
  app.innerHTML = `
    <main class="setup">
      <h1>${wordmark(false)}</h1>
      <p class="tag">something broke</p>
      <p class="hint">${escapeHtml(String(err))}</p>
      <button class="primary" id="fatal-home">Back to start</button>
    </main>`;
  app.querySelector("#fatal-home")?.addEventListener("click", () => {
    location.hash = "#/";
    location.reload();
  });
}

function escapeHtml(raw: string): string {
  return raw.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

window.addEventListener("hashchange", route);

/*
 * Coming back online re-routes, so the offline screen lets go of its own
 * accord — you should not have to reload a game to notice the wifi returned.
 *
 * Going offline deliberately does NOT re-route: that would yank a live match
 * off the screen the instant a phone passed a tunnel, which is exactly what
 * §7's reconnect handling exists to avoid.
 */
watchConnectivity(() => {
  if (!isOffline()) route();
});

// Preferences that CSS acts on have to be on the document before the first
// screen paints, or reduce-motion lands one frame late and you see the thing it
// was meant to suppress.
applyPrefs();

// Only installs listeners. A browser makes no sound until the user has touched
// it — the context is built inside the first gesture, whatever that gesture is.
initAudio();

// Likewise listeners only: Chromium fires `beforeinstallprompt` early and we
// hold it back until a game has actually finished (§14).
initInstallPrompt();

route();

// Registered AFTER the first screen is up. A service worker install competes
// for bandwidth with the very assets the first paint is waiting on, and this
// game's first screen is the one people judge it by.
registerServiceWorker();
