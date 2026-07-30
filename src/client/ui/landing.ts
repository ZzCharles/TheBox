/**
 * Landing screen: pick a name, then create a room or join one by code.
 */

import { rememberName, storedName } from "../net/identity.ts";

export function mountLanding(root: HTMLElement): () => void {
  root.innerHTML = `
    <main class="setup">
      <h1>BOX</h1>
      <p class="tag">dots &amp; boxes &middot; with friends</p>

      <label class="field">
        <span>Your name</span>
        <input id="name" maxlength="14" autocomplete="nickname"
               placeholder="Player" value="${escapeAttr(storedName())}" />
      </label>

      <button class="primary" id="create">Create room</button>

      <div class="divider"><span>or</span></div>

      <form class="join" id="join-form">
        <input id="code" maxlength="4" inputmode="latin" autocapitalize="characters"
               autocomplete="off" placeholder="CODE" aria-label="Room code" />
        <button class="chip" type="submit" id="join">Join</button>
      </form>

      <p class="hint" id="status"></p>
      <button class="linkish" id="hotseat">Play on one device</button>
    </main>`;

  const nameInput = root.querySelector<HTMLInputElement>("#name")!;
  const codeInput = root.querySelector<HTMLInputElement>("#code")!;
  const createBtn = root.querySelector<HTMLButtonElement>("#create")!;
  const joinBtn = root.querySelector<HTMLButtonElement>("#join")!;
  const status = root.querySelector<HTMLElement>("#status")!;

  const saveName = () => rememberName(nameInput.value || "Player");
  nameInput.addEventListener("change", saveName);

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  createBtn.addEventListener("click", async () => {
    saveName();
    createBtn.disabled = true;
    status.textContent = "Creating…";
    try {
      const res = await fetch("/api/room", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const { code } = (await res.json()) as { code: string };
      location.hash = `#/r/${code}`;
    } catch {
      status.textContent = "Could not create a room. Try again.";
      createBtn.disabled = false;
    }
  });

  root.querySelector<HTMLFormElement>("#join-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    saveName();
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) {
      status.textContent = "Room codes are 4 characters.";
      return;
    }
    joinBtn.disabled = true;
    status.textContent = "Checking…";
    try {
      const res = await fetch(`/api/room/${encodeURIComponent(code)}`);
      const body = (await res.json()) as { exists: boolean };
      if (!body.exists) {
        status.textContent = "No room with that code.";
        joinBtn.disabled = false;
        return;
      }
      location.hash = `#/r/${code}`;
    } catch {
      status.textContent = "Could not reach the server.";
      joinBtn.disabled = false;
    }
  });

  root.querySelector<HTMLElement>("#hotseat")!.addEventListener("click", () => {
    location.hash = "#/hotseat";
  });

  return () => {
    /* plain DOM; the router replaces it wholesale */
  };
}

function escapeAttr(raw: string): string {
  return raw.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
