import "./styles/base.css";

import { PROTOCOL_VERSION, gridSizeFor } from "../shared/constants.ts";
import { lineCount } from "../shared/board.ts";

/**
 * M0 boot stub. Proves the toolchain end to end: shared module imports, Vite
 * dev, and a live WebSocket to the Durable Object.
 *
 * M2 replaces this with the real router + canvas stage.
 */
const app = document.querySelector<HTMLDivElement>("#app")!;

const players = 6;
const n = gridSizeFor(players);

app.innerHTML = `
  <main class="boot">
    <h1>BOX</h1>
    <p class="tag">scaffold &middot; protocol v${PROTOCOL_VERSION}</p>
    <dl>
      <dt>players</dt><dd>${players}</dd>
      <dt>grid</dt><dd>${n}&times;${n}</dd>
      <dt>boxes</dt><dd>${n * n}</dd>
      <dt>lines</dt><dd>${lineCount(n)}</dd>
    </dl>
    <p class="status" id="status">connecting&hellip;</p>
  </main>
`;

const status = document.querySelector<HTMLParagraphElement>("#status")!;

const proto = location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${proto}//${location.host}/parties/game-room/scaffold`);

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data as string) as { t: string; room?: string };
  if (msg.t === "welcome") {
    status.textContent = `connected to room "${msg.room}"`;
    status.classList.add("ok");
  }
});

socket.addEventListener("close", () => {
  status.textContent = "disconnected";
  status.classList.remove("ok");
});

socket.addEventListener("error", () => {
  status.textContent = "connection failed";
});
