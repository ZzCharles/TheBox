import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The Cloudflare plugin runs the real Worker + Durable Objects inside `vite dev`
// (workerd, not a mock), so `npm run dev` is the whole stack.
export default defineConfig({
  plugins: [cloudflare()],
  server: {
    // Bind to every interface so phones on the same wifi can reach the dev
    // server. Without this Vite listens on localhost only, and the URL works
    // on this machine but nowhere else.
    host: true,
  },
});
