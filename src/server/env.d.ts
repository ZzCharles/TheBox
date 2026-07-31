/**
 * Secrets are not part of `wrangler.jsonc`, so `wrangler types` cannot see them.
 * Declare them here instead; this merges with the generated `Env` interface.
 *
 * Set in production with:  npx.cmd wrangler secret put OWNER_KEY
 * Set for local dev with a `.dev.vars` file containing:  OWNER_KEY=...
 *
 * Optional on purpose: when it is unset the owner feature is simply off and the
 * first player to join hosts, which is the behaviour we had before.
 */
declare global {
  interface Env {
    OWNER_KEY?: string;
  }
}

export {};
