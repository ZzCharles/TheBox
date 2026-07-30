import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The Cloudflare plugin runs the real Worker + Durable Objects inside `vite dev`
// (workerd, not a mock), so `npm run dev` is the whole stack.
export default defineConfig({
  plugins: [cloudflare()],
});
