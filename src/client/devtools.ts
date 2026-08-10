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
  /**
   * The streak callout (§12.4). Exposed because a chain big enough to reach
   * WILDFIRE takes a whole game to arrive by playing, which makes the top of
   * the ladder untestable by hand.
   */
  streak?: { climb: (boxes: number) => void; end: () => void; reset: () => void };
}

declare global {
  interface Window {
    __box?: DebugSurface;
  }
}

export function exposeDebug(surface: DebugSurface): void {
  window.__box = surface;
}
