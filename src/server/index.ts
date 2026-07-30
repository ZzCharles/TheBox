import { getServerByName, routePartykitRequest } from "partyserver";

import { GameRoom } from "./GameRoom.ts";
import { isValidCode, normaliseCode, randomCode } from "./codes.ts";

export { GameRoom };

/** Attempts before giving up on finding a free room code. */
const CREATE_ATTEMPTS = 8;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // POST /api/room -> mint a room code nobody is using.
    if (url.pathname === "/api/room" && request.method === "POST") {
      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
        const code = randomCode();
        const room = await getServerByName(env.GameRoom, code);
        if (await room.claim()) return json({ code });
      }
      return json({ error: "Could not allocate a room code" }, 503);
    }

    // GET /api/room/:code -> check a code before trying to connect, so a typo
    // gives a clear message instead of an empty lobby.
    const lookup = url.pathname.match(/^\/api\/room\/([^/]+)$/);
    if (lookup && request.method === "GET") {
      const code = normaliseCode(lookup[1] ?? "");
      if (!isValidCode(code)) return json({ exists: false, code }, 400);
      const room = await getServerByName(env.GameRoom, code);
      return json({ exists: await room.exists(), code });
    }

    const routed = await routePartykitRequest(request, env);
    if (routed) return routed;

    // Static assets are served ahead of the Worker for everything except the
    // routes in `run_worker_first` (see wrangler.jsonc), so anything arriving
    // here is a genuine miss.
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
