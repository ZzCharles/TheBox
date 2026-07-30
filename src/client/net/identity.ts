/**
 * Who this device is. Persisted so a refresh or a dropped connection returns to
 * the same seat rather than joining as a stranger.
 */

const CLIENT_ID_KEY = "box.clientId";
const NAME_KEY = "box.name";

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
