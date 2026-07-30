/**
 * Who this device is. Persisted so a refresh or a dropped connection returns to
 * the same seat rather than joining as a stranger.
 */

const CLIENT_ID_KEY = "box.clientId";
const NAME_KEY = "box.name";

export function clientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function storedName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

export function rememberName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 14));
}
