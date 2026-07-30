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
}

window.addEventListener("hashchange", route);
route();
