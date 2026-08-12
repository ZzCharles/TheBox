/**
 * Settings.
 *
 * This screen exists because the name is remembered per browser and a typo is
 * otherwise permanent. Everything else here is a preference the game reads but
 * never asks about.
 */

import { PLAYER_COLORS, PROTOCOL_VERSION } from "../../shared/constants.ts";
import { play, setSoundEnabled } from "../audio/engine.ts";
import {
  buzz,
  canVibrate,
  forgetDevice,
  ownerKey,
  ownerVerdict,
  prefs,
  rememberName,
  rememberOwnerKey,
  savePrefs,
  storedName,
} from "../net/identity.ts";

/**
 * What the owner row says, and it must only ever say what is TRUE.
 *
 * ⚠️ **This row used to claim "This device hosts every room" the moment any
 * string was typed** — including a wrong one. The server was never fooled
 * (`isOwnerKey` checks the key against a Worker secret and a wrong key grants
 * nothing), but the person typing it was, and they had no way to find out.
 *
 * The client cannot check a key on its own, and must not pretend to. It can
 * only report what the server last said, which arrives on `welcome` and is
 * cached by `rememberOwnerVerdict`. Until a connection has actually happened
 * the honest answer is "not checked yet".
 */
function ownerStatusText(): string {
  if (!ownerKey()) return "Not set";
  switch (ownerVerdict()) {
    case "accepted":
      return "Verified — this device hosts every room";
    case "rejected":
      return "That key was rejected. Tap to change it";
    default:
      return "Saved — checked when you next join a room";
  }
}

function ownerStatusChevron(): string {
  if (!ownerKey()) return "+";
  switch (ownerVerdict()) {
    case "accepted":
      return "✓";
    case "rejected":
      return "✕";
    default:
      return "…";
  }
}

export function mountSettings(root: HTMLElement): () => void {
  let showingRules = false;

  render();

  function render() {
    const p = prefs();
    root.innerHTML = `
      <main class="setup settings">
        <div class="bar">
          <button class="linkish" id="back">← Back</button>
          <h2 class="bar-title">Settings</h2>
        </div>

        <div class="rows">
          <div class="row">
            <span class="k">Name</span>
            <input class="row-input" id="name" maxlength="14" autocomplete="nickname"
                   placeholder="Player" value="${escapeAttr(storedName())}" />
          </div>

          <div class="row">
            <span class="k">Favourite colour
              <em class="sub">Yours if it's free when you join</em>
            </span>
            <div class="swatches" id="swatches">
              ${PLAYER_COLORS.map(
                (c, i) =>
                  `<button class="sw${i === p.colour ? " sel" : ""}" data-i="${i}"
                           style="--sw:${c}" aria-label="Colour ${i + 1}"></button>`,
              ).join("")}
            </div>
          </div>

          ${toggleRow("sound", "Sound", "A tick per line, a knock per square", p.sound)}
          ${toggleRow(
            "vibrate",
            "Vibration",
            canVibrate() ? "A short buzz when a line lands" : "This device has no vibration",
            p.vibrate,
            !canVibrate(),
          )}
          ${toggleRow("reduceMotion", "Reduce motion", "Keep the changes, drop the sequences", p.reduceMotion)}
          ${toggleRow("leftHanded", "Left-handed layout", "Move the controls to the left", p.leftHanded)}
        </div>

        <div class="rows">
          <button class="row row-btn" id="rules">
            <span class="k">How to play</span><span class="chev">${showingRules ? "−" : "+"}</span>
          </button>
          ${showingRules ? `<div class="row rules">${RULES}</div>` : ""}
          <button class="row row-btn" id="owner">
            <span class="k">Owner device
              <em class="sub">${ownerStatusText()}</em>
            </span>
            <span class="chev">${ownerStatusChevron()}</span>
          </button>
          <button class="row row-btn" id="forget">
            <span class="k danger">Forget this device</span>
          </button>
        </div>

        <p class="hint" id="status"></p>
        <p class="version">Tiki · protocol v${PROTOCOL_VERSION} · ${
          import.meta.env.DEV ? "dev" : "live"
        }</p>
      </main>`;

    wire();
  }

  function wire() {
    const status = root.querySelector<HTMLElement>("#status")!;

    root.querySelector<HTMLElement>("#back")!.addEventListener("click", () => {
      location.hash = "#/";
    });

    // The name saves as you type. A Save button here would be one more thing to
    // forget to press, and a half-typed name is never worse than the old one.
    const nameInput = root.querySelector<HTMLInputElement>("#name")!;
    nameInput.addEventListener("input", () => {
      const value = nameInput.value.trim();
      if (!value) {
        status.textContent = "You need a name to join a room.";
        return;
      }
      rememberName(value);
      status.textContent = "Saved.";
    });

    root.querySelector<HTMLElement>("#swatches")!.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(".sw");
      if (!target) return;
      const index = Number(target.dataset.i);
      // Tapping the one you already have clears the preference.
      const next = prefs().colour === index ? -1 : index;
      savePrefs({ colour: next });
      status.textContent =
        next === -1 ? "No preference — you'll take the next free colour." : "Saved.";
      render();
    });

    for (const el of root.querySelectorAll<HTMLElement>("[data-pref]")) {
      el.addEventListener("click", () => {
        const key = el.dataset.pref as "sound" | "vibrate" | "reduceMotion" | "leftHanded";
        const now = !prefs()[key];
        savePrefs({ [key]: now });
        // A toggle for something you cannot see should prove it works rather
        // than claim to. Order matters for sound: enable, then demonstrate.
        if (key === "sound") {
          setSoundEnabled(now);
          if (now) play("click");
        }
        if (key === "vibrate" && now) buzz(40);
        render();
      });
    }

    root.querySelector<HTMLElement>("#rules")!.addEventListener("click", () => {
      showingRules = !showingRules;
      render();
    });

    root.querySelector<HTMLElement>("#owner")!.addEventListener("click", () => {
      if (ownerKey()) {
        rememberOwnerKey("");
        render();
        root.querySelector<HTMLElement>("#status")!.textContent =
          "This device is no longer the owner.";
        return;
      }
      const entered = prompt("Owner key (leave blank to cancel)");
      if (entered === null) return;
      rememberOwnerKey(entered);
      render();
      // ⚠️ NOT "you'll host any room you're in" — that was a promise this
      // screen is in no position to make. The key is checked by the server on
      // the next connection, and the row reports whatever it says then.
      root.querySelector<HTMLElement>("#status")!.textContent = entered.trim()
        ? "Saved. It'll be checked when you next join a room."
        : "";
    });

    root.querySelector<HTMLElement>("#forget")!.addEventListener("click", () => {
      if (!confirm("Forget your name, colour and settings on this device?")) return;
      forgetDevice();
      location.hash = "#/";
      location.reload();
    });
  }

  return () => {
    /* plain DOM; the router replaces it wholesale */
  };
}

function toggleRow(
  key: string,
  label: string,
  sub: string,
  on: boolean,
  disabled = false,
): string {
  return `
    <div class="row${disabled ? " is-off" : ""}">
      <span class="k">${label}<em class="sub">${sub}</em></span>
      <button class="sw-toggle${on && !disabled ? " on" : ""}" data-pref="${key}"
              role="switch" aria-checked="${on && !disabled}" aria-label="${label}"
              ${disabled ? "disabled" : ""}></button>
    </div>`;
}

const RULES = `
  <p>Draw a line between two dots. Close the fourth side of a square and you claim
  it — your letter appears in it, and <b>you go again</b>. Most squares wins.</p>
  <p><b>Twist</b> adds two things: the board collapses inward as you play, and you
  can spend 10 of your squares to buy one extra line. A square you already closed
  keeps its point even when the board burns it away.</p>`;

function escapeAttr(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
