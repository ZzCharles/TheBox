/**
 * Making Tiki installable (§14): the service worker, the offline screen, and
 * the add-to-home-screen prompt.
 *
 * **The thing to understand first: this game NEEDS the network.** It is a
 * multiplayer Durable Object, and no amount of precaching changes that. The
 * service worker exists so that a cold start with no signal shows the app
 * telling you it is offline, instead of the browser's dinosaur — and so that a
 * bad connection on a train does not cost you the whole shell.
 *
 * ⚠️ **One real exception, and it is worth knowing: hot seat works completely
 * offline.** It has no socket at all. So the offline screen is not a dead end —
 * it offers the one mode that genuinely still plays, which is a far better
 * answer than "come back later".
 *
 * Nothing here may ever throw. A browser with no service worker support, a
 * private window that blocks registration, an insecure origin — all of them
 * must produce a working game that simply is not installable. Same rule as
 * `engine.ts`: this is decoration on top of a game that already works.
 */

import { registerSW } from "virtual:pwa-register";

// --------------------------------------------------------- service worker ---

/**
 * Register, and update in the background.
 *
 * `autoUpdate` matters more here than in most apps: the client and the server
 * share a `PROTOCOL_VERSION` (§7), and a client left on an old bundle does not
 * degrade gracefully — it is told to refresh and cannot play. Silently taking
 * the new version on the next load is the behaviour that keeps that from
 * happening.
 *
 * ⚠️ **`onNeedRefresh` deliberately does nothing.** With `registerType:
 * "autoUpdate"` the new worker activates on its own; a prompt here would ask
 * the player to approve something that has already happened, and asking
 * mid-match is worse than not asking at all.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  try {
    registerSW({
      immediate: true,
      onRegisterError(err: unknown) {
        // Blocked by policy, an insecure origin, or a private window. The game
        // is now simply not installable, which is not worth a broken screen.
        console.warn("[tiki] service worker did not register", err);
      },
    });
  } catch (err) {
    console.warn("[tiki] service worker registration threw", err);
  }
}

// ---------------------------------------------------------------- offline ---

/**
 * Which routes actually need the network.
 *
 * ⚠️ **Do NOT add the game route to the offline screen's remit.** A socket
 * dropping mid-match is already handled, and handled better: §7's rule is that
 * connection status outranks every other banner, so the game screen says
 * "Reconnecting…" and keeps the board on screen. Replacing a live match with a
 * full-page "you're offline" would throw away state the client can still
 * recover from, and would fire on every brief tunnel.
 *
 * This is only for a COLD start with no network, where there is nothing to
 * reconnect to and the alternative is a landing screen whose only button fails.
 */
export function routeNeedsNetwork(hash: string): boolean {
  if (hash === "#/hotseat" || hash === "#/settings") return false;
  // A room link with no network cannot connect, so it gets the screen too —
  // but only on a cold start; once mounted, room.ts owns the connection state.
  return true;
}

/** `false` only when the browser is CERTAIN there is no connection. */
export function isOffline(): boolean {
  return navigator.onLine === false;
}

/**
 * Call `onChange` when connectivity flips.
 *
 * ⚠️ `navigator.onLine === true` means "there is an interface", not "the
 * internet works". It is only trustworthy in the negative, which is exactly how
 * `isOffline` uses it — everything else is left to the real request failing.
 */
export function watchConnectivity(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// ---------------------------------------------------------------- install ---

/**
 * The deferred `beforeinstallprompt` event, once the browser has offered one.
 *
 * Chromium fires this early, and the whole point of catching it is to NOT use
 * it then: §14 says show the prompt after a completed game, never on first
 * load. Someone who has just finished a match knows whether they want the game
 * on their home screen; someone who has just opened a link does not.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
/** One offer per session, however many games get played. */
let offered = false;

export function initInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Without this Chromium shows its own mini-infobar, which is precisely the
    // "on first load" interruption §14 rules out.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    offered = true;
  });
}

/** Already running as an installed app? Then never offer. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS predates the standard and still reports it here only.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * iOS **never fires `beforeinstallprompt`** and offers no install API at all —
 * the only route is Share → Add to Home Screen, by hand. Since this game is
 * played on phones and iPhone is half of them, silence there would mean the
 * feature does not exist for half the players, so they get a one-line
 * instruction instead of a button.
 *
 * Deliberately every iOS browser, not just Safari: they are all WebKit
 * underneath and they all reach Add to Home Screen through the share sheet, so
 * the instruction is just as true in Chrome or Firefox there.
 */
export function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export type InstallOffer = { kind: "button" } | { kind: "ios" } | null;

/**
 * What, if anything, to offer right now. Call this when a game ENDS.
 *
 * Returns null when the game is already installed, when the browser has not
 * offered an install, or when this session has already asked once.
 */
export function installOffer(): InstallOffer {
  if (offered || isStandalone()) return null;
  if (deferred) return { kind: "button" };
  if (isIos()) return { kind: "ios" };
  return null;
}

/** Fire the browser's own install dialog. Resolves once the player answers. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  offered = true;
  // Single-use: the event cannot be prompted twice, and holding a spent one
  // makes `installOffer` lie on the next game.
  deferred = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    return "unavailable";
  }
}

/** Mark the offer as spent without prompting — the player dismissed it. */
export function dismissInstallOffer(): void {
  offered = true;
}
