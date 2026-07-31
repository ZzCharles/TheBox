/**
 * Who this device is. Persisted so a refresh or a dropped connection returns to
 * the same seat rather than joining as a stranger.
 */

const CLIENT_ID_KEY = "box.clientId";
const NAME_KEY = "box.name";
const OWNER_KEY = "box.ownerKey";

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
}
