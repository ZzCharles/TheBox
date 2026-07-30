import "./styles/base.css";
import "./styles/game.css";

import { mountHotseat } from "./ui/hotseat.ts";
import { mountLanding } from "./ui/landing.ts";
import { mountRoom } from "./ui/room.ts";

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

  // A throw while mounting used to leave the PREVIOUS screen on display, which
  // looks exactly like the app hanging. Say what happened instead.
  try {
    const match = /^#\/r\/([A-Za-z0-9]{4})$/.exec(location.hash);
    if (match) {
      dispose = mountRoom(app, match[1]!.toUpperCase());
      return;
    }
    if (location.hash === "#/hotseat") {
      dispose = mountHotseat(app);
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
      <h1>BOX</h1>
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
route();
