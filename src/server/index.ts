import { Server, routePartykitRequest, type Connection } from "partyserver";

import { PROTOCOL_VERSION } from "../shared/constants.ts";

/**
 * One Durable Object per lobby. Holds the authoritative game state, owns the
 * shot clock via `ctx.storage.setAlarm`, and fans events out over WebSockets.
 *
 * M0: connection plumbing only. The turn loop lands in M3.
 */
export class GameRoom extends Server<Env> {
  /**
   * Hibernation lets an idle lobby cost nothing while keeping sockets open.
   * Any state that must survive hibernation has to live in storage, not on
   * `this` — see M3 before adding instance fields.
   */
  static override options = { hibernate: true };

  override onConnect(connection: Connection) {
    connection.send(
      JSON.stringify({
        t: "welcome",
        protocolVersion: PROTOCOL_VERSION,
        room: this.name,
        connectionId: connection.id,
      }),
    );
  }

  override onMessage(connection: Connection, message: string | ArrayBuffer) {
    // M3 replaces this with the real protocol handler.
    if (typeof message !== "string") return;
    connection.send(JSON.stringify({ t: "echo", payload: message }));
  }

  override onAlarm() {
    // M3: shot clock expiry -> skipTurn() -> broadcast.
  }
}

export default {
  async fetch(request, env) {
    const routed = await routePartykitRequest(request, env);
    if (routed) return routed;

    // Static assets are served ahead of the Worker for everything except the
    // /parties/* routes (see `run_worker_first` in wrangler.jsonc), so anything
    // arriving here is a genuine miss.
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
