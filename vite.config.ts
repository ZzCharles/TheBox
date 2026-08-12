import { defineConfig, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Confine a plugin to the browser build.
 *
 * ⚠️ **This build has TWO environments** — `client` and the Cloudflare `box`
 * worker — and by default a plugin runs in both. Unscoped, `VitePWA` wrote a
 * second `manifest.webmanifest` into `dist/box/`, the Worker bundle directory,
 * where nothing serves it and nothing wants it. A service worker and a web app
 * manifest are browser artefacts by definition; the Worker is the thing they
 * would be fetched FROM.
 */
function clientOnly(plugins: Plugin[]): Plugin[] {
  return plugins.map((plugin) => ({
    ...plugin,
    applyToEnvironment: (environment: { name: string }) => environment.name === "client",
  }));
}

// The Cloudflare plugin runs the real Worker + Durable Objects inside `vite dev`
// (workerd, not a mock), so `npm run dev` is the whole stack.
export default defineConfig({
  plugins: [
    cloudflare(),
    ...clientOnly(
      VitePWA({
      // The game talks to an authoritative server over a WebSocket, so a stale
      // client is not a cosmetic problem — it is a PROTOCOL_VERSION mismatch and
      // a "refresh to update" screen (§7). Update in the background, always.
      registerType: "autoUpdate",
      // Registration lives in main.ts rather than in a generated snippet, so the
      // update flow is code we can read. See `registerServiceWorker`.
      injectRegister: null,
      /*
       * ⚠️ The dev service worker is OFF on purpose.
       *
       * A precaching SW in front of `vite dev` fights HMR, and worse, it caches
       * the dev module graph — which is how you end up debugging a file you
       * already fixed. M8 is verified against `npm run build` + preview and the
       * real deploy, not against dev.
       */
      devOptions: { enabled: false },
      includeAssets: ["fonts/Archivo.woff2", "icons/*.png", "sfx/voice/*.mp3"],
      manifest: {
        name: "Tiki",
        short_name: "Tiki",
        description: "Dots and Boxes with your friends, on your phones.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0B0D12",
        theme_color: "#0B0D12",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            // Its own file, not `any maskable` on the 512: a maskable icon is
            // drawn smaller so a launcher can crop it, and declaring one image
            // as both means every platform gets the wrong one half the time.
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        /*
         * `mp3` is here for the announcer (§13.2). Precaching the voice lines
         * matters more than it looks: "Here we go" fires the instant a game
         * starts, and a first-use network fetch would land it somewhere in the
         * middle of the opening move instead of on the beat.
         *
         * ⚠️ Watch the total. Precache is downloaded in full on first visit,
         * and a set of announcer lines is the only thing in this project big
         * enough to make that a real number — §13.2 has the budget.
         */
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,ico,mp3}"],
        /*
         * ⚠️ **Never let the service worker answer for the API or the socket.**
         *
         * `/api/*` mints and looks up room codes and `/parties/*` is the
         * WebSocket upgrade to the Durable Object. A cached room code is a room
         * that does not exist, and a navigation fallback served over an upgrade
         * request is a game that cannot start. Neither is recoverable from the
         * client, so both are excluded from the SPA fallback outright.
         */
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/parties\//],
        // The offline screen is a route of the app itself (§14), so the shell
        // has to be reachable with no network at all.
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Self-hosted and content-hashed by nothing — the filename is
            // stable — so cache-first is safe and saves the round trip that
            // otherwise blocks first paint (font-display: block).
            urlPattern: ({ url }) => url.pathname.startsWith("/fonts/"),
            handler: "CacheFirst",
            options: {
              cacheName: "tiki-fonts",
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      }),
    ),
  ],
  server: {
    // Bind to every interface so phones on the same wifi can reach the dev
    // server. Without this Vite listens on localhost only, and the URL works
    // on this machine but nowhere else.
    host: true,
  },
});
