/**
 * Dev-only debug surface, hung off `window.__box`.
 *
 * Stripped from production builds — every call site is behind
 * `if (import.meta.env.DEV)`, which Vite eliminates at build time.
 *
 * It exists mainly so a hidden or headless tab can render a frame on demand:
 * `requestAnimationFrame` never fires while `document.visibilityState` is
 * "hidden", which makes the canvas impossible to inspect automatically.
 */

export interface DebugSurface {
  state: () => unknown;
  layout: () => unknown;
  drawNow: () => void;
}

declare global {
  interface Window {
    __box?: DebugSurface;
  }
}

export function exposeDebug(surface: DebugSurface): void {
  window.__box = surface;
}
