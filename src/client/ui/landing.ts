/**
 * Landing screen: who you are, then create or join a room.
 *
 * The name is asked for ONCE and then remembered on the device. Retyping it
 * every session is pure friction for a game you play with the same few people.
 */

import {
  hasName,
  ownerKey,
  rememberName,
  rememberOwnerKey,
  storedName,
} from "../net/identity.ts";

export function mountLanding(root: HTMLElement): () => void {
  let editingName = !hasName();

  render();

  function render() {
    const name = storedName();
    root.innerHTML = `
      <main class="setup">
        <h1>BOX</h1>
        <p class="tag">dots &amp; boxes &middot; with friends</p>

        ${
          editingName
            ? `<label class="field">
                 <span>Your name</span>
                 <input id="name" maxlength="14" autocomplete="nickname"
                        placeholder="Player" value="${escapeAttr(name)}" />
               </label>
               <button class="chip" id="save-name">Save name</button>`
            : `<p class="identity">
                 Playing as <strong>${escapeHtml(name)}</strong>
                 <button class="linkish" id="change-name">change</button>
               </p>`
        }

        <button class="primary" id="create">Create room</button>

        <div class="divider"><span>or</span></div>

        <form class="join" id="join-form">
          <input id="code" maxlength="4" inputmode="latin" autocapitalize="characters"
                 autocomplete="off" placeholder="CODE" aria-label="Room code" />
          <button class="chip" type="submit" id="join">Join</button>
        </form>

        <p class="hint" id="status"></p>
        <button class="linkish" id="hotseat">Play on one device</button>
        <button class="linkish subtle" id="owner">${ownerKey() ? "Owner device ✓" : "&nbsp;"}</button>
      </main>`;

    wire();
  }

  function wire() {
    const status = root.querySelector<HTMLElement>("#status")!;
    const codeInput = root.querySelector<HTMLInputElement>("#code")!;
    const createBtn = root.querySelector<HTMLButtonElement>("#create")!;
    const joinBtn = root.querySelector<HTMLButtonElement>("#join")!;

    // --- identity ---
    root.querySelector<HTMLElement>("#change-name")?.addEventListener("click", () => {
      editingName = true;
      render();
      root.querySelector<HTMLInputElement>("#name")?.focus();
    });

    const nameInput = root.querySelector<HTMLInputElement>("#name");
    const saveName = () => {
      const value = (nameInput?.value ?? "").trim();
      if (!value) {
        status.textContent = "Pick a name first.";
        return false;
      }
      rememberName(value);
      editingName = false;
      render();
      return true;
    };
    root.querySelector<HTMLElement>("#save-name")?.addEventListener("click", saveName);
    nameInput?.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") saveName();
    });

    /** Ensure a name exists before doing anything that joins a room. */
    const ensureName = (): boolean => {
      if (hasName()) return true;
      if (nameInput) return saveName();
      editingName = true;
      render();
      return false;
    };

    // --- owner device ---
    root.querySelector<HTMLElement>("#owner")!.addEventListener("click", () => {
      if (ownerKey()) {
        rememberOwnerKey("");
        status.textContent = "This device is no longer the owner.";
        render();
        return;
      }
      const entered = prompt("Owner key (leave blank to cancel)");
      if (entered === null) return;
      rememberOwnerKey(entered);
      status.textContent = entered.trim()
        ? "Saved. You'll host any room you're in."
        : "";
      render();
    });

    // --- rooms ---
    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });

    createBtn.addEventListener("click", async () => {
      if (!ensureName()) return;
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
      if (!ensureName()) return;
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
