/**
 * WebSocket transport: connect, reconnect with backoff, and clock sync.
 *
 * CLOCK SYNC matters more than it looks. The server broadcasts turn deadlines
 * as absolute server-epoch milliseconds, and phone clocks are routinely seconds
 * off. Rendering a countdown against raw `Date.now()` would show some players a
 * clock that starts at 9s and others one that starts at 15s. So we estimate the
 * offset from ping round-trips and correct for it.
 */

import {
  decode,
  encode,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "../../shared/protocol.ts";

export type NetStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface NetOptions {
  code: string;
  clientId: string;
  name: string;
  /** Sent on every hello; empty on all devices except the owner's. */
  ownerKey?: string;
  /** Preferred colour index, or -1 for no preference. */
  colour?: number;
  onMessage(msg: ServerMessage): void;
  onStatus(status: NetStatus): void;
}

export interface Net {
  send(msg: ClientMessage): void;
  /** Best estimate of the server's clock, in epoch ms. */
  now(): number;
  /** Round-trip time in ms, or null before the first pong. */
  readonly latency: number | null;
  readonly status: NetStatus;
  close(): void;
}

const PING_INTERVAL_MS = 10_000;
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8_000;

export function connect(options: NetOptions): Net {
  let socket: WebSocket | null = null;
  let status: NetStatus = "connecting";
  let closedByUs = false;
  let attempt = 0;
  let reconnectTimer = 0;
  let pingTimer = 0;

  /** Server clock minus local clock, from the lowest-latency sample seen. */
  let offset = 0;
  let bestRtt = Number.POSITIVE_INFINITY;
  let latency: number | null = null;

  const queue: ClientMessage[] = [];

  function setStatus(next: NetStatus) {
    if (status === next) return;
    status = next;
    options.onStatus(next);
  }

  function url(): string {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${location.host}/parties/game-room/${encodeURIComponent(options.code)}`;
  }

  function open() {
    socket = new WebSocket(url());

    socket.addEventListener("open", () => {
      attempt = 0;
      setStatus("open");
      // Always re-introduce ourselves: the server treats a known clientId as a
      // reconnect and hands back the same seat.
      raw({
        t: "hello",
        protocolVersion: PROTOCOL_VERSION,
        clientId: options.clientId,
        name: options.name,
        ...(options.ownerKey ? { ownerKey: options.ownerKey } : {}),
        ...(options.colour !== undefined && options.colour >= 0
          ? { colour: options.colour }
          : {}),
      });
      for (const msg of queue.splice(0)) raw(msg);
      ping();
      pingTimer = window.setInterval(ping, PING_INTERVAL_MS);
    });

    socket.addEventListener("message", (event) => {
      const msg = decode<ServerMessage>(event.data);
      if (!msg) return;

      if (msg.t === "pong") {
        const rtt = Date.now() - msg.t0;
        latency = rtt;
        // Assume a symmetric round trip: the server's clock at the moment we
        // receive this was serverNow + rtt/2.
        if (rtt < bestRtt) {
          bestRtt = rtt;
          offset = msg.serverNow + rtt / 2 - Date.now();
        }
        return;
      }

      if (msg.t === "welcome" || msg.t === "room") {
        // A free coarse sample; refined by the pings above.
        if (bestRtt === Number.POSITIVE_INFINITY) {
          offset = msg.serverNow - Date.now();
        }
      }

      options.onMessage(msg);
    });

    socket.addEventListener("close", () => {
      window.clearInterval(pingTimer);
      if (closedByUs) {
        setStatus("closed");
        return;
      }
      setStatus("reconnecting");
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket?.close();
    });
  }

  function scheduleReconnect() {
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
    attempt++;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(open, delay);
  }

  function ping() {
    raw({ t: "ping", t0: Date.now() });
  }

  function raw(msg: ClientMessage) {
    socket?.send(encode(msg));
  }

  open();

  /**
   * Intents that mean nothing once the moment has passed.
   *
   * A `move` is bound to a `turnSeq`; queueing one through a reconnect and
   * firing it seconds later guarantees the server drops it as stale, and the
   * player is left holding a line that will never land. The same goes for
   * buying and arming, which are both "on my turn, right now" actions.
   *
   * Everything else — hello, configure, start, rematch, wake — still queues,
   * because those are durable requests that remain true whenever they arrive.
   */
  const PERISHABLE = new Set(["move", "buy", "arm"]);

  return {
    send(msg) {
      if (socket?.readyState === WebSocket.OPEN) raw(msg);
      else if (!PERISHABLE.has(msg.t)) queue.push(msg);
    },
    now: () => Date.now() + offset,
    get latency() {
      return latency;
    },
    get status() {
      return status;
    },
    close() {
      closedByUs = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pingTimer);
      socket?.close();
      setStatus("closed");
    },
  };
}
