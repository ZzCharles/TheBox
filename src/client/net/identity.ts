/**
 * Who this device is. Persisted so a refresh or a dropped connection returns to
 * the same seat rather than joining as a stranger.
 */

const CLIENT_ID_KEY = "box.clientId";
const NAME_KEY = "box.name";
const OWNER_KEY = "box.ownerKey";
/** The server's last verdict on that key. A cache of an answer, not a claim. */
const OWNER_VERDICT_KEY = "box.ownerVerdict";
const PREFS_KEY = "box.prefs";

/*
 * The `box.` prefix outlives the rename to Tiki on purpose: changing it would
 * silently forget the name and seat of everyone already carrying one, which is
 * the exact friction the remembered name exists to remove.
 */

export function clientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

/**
 * A random 128-bit id.
 *
 * `crypto.randomUUID()` is SECURE-CONTEXT ONLY — present on localhost and
 * HTTPS, `undefined` over plain HTTP to a LAN address. Calling it on a phone
 * pointed at `http://192.168.x.x:5173` throws, which used to kill the room
 * screen before it rendered.
 *
 * `crypto.getRandomValues()` carries no such restriction, so build the id from
 * that and only use `randomUUID` when it actually exists.
 */
function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function storedName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

export function rememberName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 14));
}

/** True once a name has been chosen, so we stop asking on every visit. */
export function hasName(): boolean {
  return storedName().trim().length > 0;
}

/**
 * The owner key, typed once on the owner's device. Kept locally and sent with
 * every `hello`; the server checks it against a secret, so the key itself never
 * appears anywhere in the shipped code.
 */
export function ownerKey(): string {
  return localStorage.getItem(OWNER_KEY) ?? "";
}

export function rememberOwnerKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed) localStorage.setItem(OWNER_KEY, trimmed);
  else localStorage.removeItem(OWNER_KEY);
  // A new key has never been checked. Clearing the verdict is what stops
  // Settings showing a stale ✓ from the previous key against the new one.
  localStorage.removeItem(OWNER_VERDICT_KEY);
}

/**
 * What the server said about this device's owner key, last time it connected.
 *
 * ⚠️ **This is a cache of a SERVER answer, never a claim.** It exists so
 * Settings can tell the truth — the client has no way to check a key itself,
 * and the version that pretended otherwise told anyone who typed anything that
 * they were the owner. Nothing reads this to grant a privilege; the server
 * decides that on every connection, every time.
 */
export type OwnerVerdict = "unverified" | "accepted" | "rejected";

export function ownerVerdict(): OwnerVerdict {
  if (!ownerKey()) return "unverified";
  const stored = localStorage.getItem(OWNER_VERDICT_KEY);
  return stored === "accepted" || stored === "rejected" ? stored : "unverified";
}

/**
 * Record what the server said. Called on `welcome`, which carries the verdict.
 *
 * ⚠️ Only a real `false` counts as a rejection. A missing field means we are
 * talking to a Worker that predates it (possible for ~30s after a deploy,
 * §0.1), and "I did not hear an answer" must never be shown as "your key is
 * wrong" — the whole point of this is that the UI stops asserting things it
 * does not know.
 */
export function rememberOwnerVerdict(accepted: boolean | undefined): void {
  if (!ownerKey()) return;
  if (typeof accepted !== "boolean") return;
  localStorage.setItem(OWNER_VERDICT_KEY, accepted ? "accepted" : "rejected");
}

// ------------------------------------------------------------ preferences ---

export interface Prefs {
  /**
   * Preferred player colour, as an index into `PLAYER_COLORS`. Granted if it is
   * free when you join and quietly swapped for the next open one if not — no
   * prompt, no error. -1 means no preference.
   */
  colour: number;
  sound: boolean;
  vibrate: boolean;
  /** A manual override, on top of the OS-level `prefers-reduced-motion`. */
  reduceMotion: boolean;
  leftHanded: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  colour: -1,
  sound: true,
  vibrate: true,
  reduceMotion: false,
  leftHanded: false,
};

export function prefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    // Spread over the defaults so a preference added later doesn't come back
    // undefined for anyone who already has a stored blob.
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(next: Partial<Prefs>): Prefs {
  const merged = { ...prefs(), ...next };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
  } catch {
    /* a full or blocked store is not worth breaking the game over */
  }
  applyPrefs(merged);
  return merged;
}

/**
 * Push the preferences that affect presentation onto the document, so CSS can
 * act on them. Called at boot and after every change.
 */
export function applyPrefs(p: Prefs = prefs()): void {
  const root = document.documentElement;
  root.classList.toggle("reduce-motion", p.reduceMotion);
  root.classList.toggle("left-handed", p.leftHanded);
}

/** A short buzz, where the device has one. Absent on iOS Safari — feature-detect. */
export function buzz(ms = 40): void {
  if (!prefs().vibrate) return;
  navigator.vibrate?.(ms);
}

export function canVibrate(): boolean {
  return typeof navigator.vibrate === "function";
}

/**
 * Whether to drop motion, from EITHER the OS setting or our own toggle.
 *
 * CSS gets this through the `reduce-motion` class and its own media query, but
 * the board is canvas and has to ask in JavaScript. The rule the design pass
 * settled on: keep every state change, drop every sequence. Squares still
 * claim, the board still burns — they arrive rather than travel.
 */
export function motionReduced(): boolean {
  if (prefs().reduceMotion) return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Everything this device remembers. Used by "forget this device" in Settings. */
export function forgetDevice(): void {
  for (const key of [CLIENT_ID_KEY, NAME_KEY, OWNER_KEY, OWNER_VERDICT_KEY, PREFS_KEY]) {
    localStorage.removeItem(key);
  }
}
