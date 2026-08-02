/**
 * Landing screen: create a room, or join one with a code.
 *
 * The name is asked for ONCE, on the very first visit, and then remembered on
 * the device — so the usual landing screen has no name field at all, just a
 * greeting. Retyping your name every session is pure friction for a game you
 * play with the same few people.
 *
 * The caveats are real and are why Settings exists: it is per-browser, so a new
 * phone or a cleared browser forgets you, and a typo would otherwise be
 * permanent.
 */

import { hasName, rememberName, storedName } from "../net/identity.ts";
import { wordmark } from "./wordmark.ts";

export function mountLanding(root: HTMLElement): () => void {
  // Only ever true on a device that has never been used before.
  let asking = !hasName();

  render();

  function render() {
    root.innerHTML = `
      <main class="setup">
        <button class="gear" id="settings" aria-label="Settings">⚙</button>

        <h1>${wordmark()}</h1>

        ${
          asking
            ? `<p class="hello">What should we call you?</p>
               <label class="field">
                 <span>Your name</span>
                 <input id="name" maxlength="14" autocomplete="nickname"
                        placeholder="Player" value="${escapeAttr(storedName())}" />
               </label>
               <button class="primary" id="save-name">That's me</button>`
            : `<p class="hello">Hey, <b>${escapeHtml(storedName())}</b></p>

               <button class="primary" id="create">Create a room</button>

               <div class="divider"><span>or</span></div>

               <form class="join" id="join-form">
                 <input id="code" maxlength="4" inputmode="latin" autocapitalize="characters"
                        autocomplete="off" placeholder="CODE" aria-label="Room code" />
                 <button class="chip" type="submit" id="join">→</button>
               </form>`
        }

        <p class="hint" id="status"></p>
        ${asking ? "" : `<button class="linkish" id="hotseat">Play on one device</button>`}
      </main>`;

    wire();
  }

  function wire() {
    const status = root.querySelector<HTMLElement>("#status")!;

    root.querySelector<HTMLElement>("#settings")!.addEventListener("click", () => {
      location.hash = "#/settings";
    });

    // --- first run only ---
    const nameInput = root.querySelector<HTMLInputElement>("#name");
    if (nameInput) {
      const save = () => {
        const value = nameInput.value.trim();
        if (!value) {
          status.textContent = "Pick a name first.";
          return;
        }
        rememberName(value);
        asking = false;
        render();
      };
      root.querySelector<HTMLElement>("#save-name")!.addEventListener("click", save);
      nameInput.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") save();
      });
      nameInput.focus();
      return;
    }

    // --- rooms ---
    const codeInput = root.querySelector<HTMLInputElement>("#code")!;
    const createBtn = root.querySelector<HTMLButtonElement>("#create")!;
    const joinBtn = root.querySelector<HTMLButtonElement>("#join")!;

    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });

    createBtn.addEventListener("click", async () => {
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
  }

  return () => {
    /* plain DOM; the router replaces it wholesale */
  };
}

function escapeAttr(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(raw: string): string {
  return raw.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
