/**
 * Canvas plumbing: sizing, device pixel ratio, resize, and an ON-DEMAND render
 * loop.
 *
 * The loop only runs while something is actually animating. A turn-based game
 * spends most of its life idle, and a permanently-spinning RAF is pure battery
 * burn on a phone for zero visible benefit.
 */

/**
 * Capped at 2 deliberately. DPR 3 on a 10x10 board triples fill cost for a
 * difference nobody can see on a 6" screen.
 */
const MAX_DPR = 2;

export interface Stage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Logical size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Schedule a frame. Safe to call repeatedly; coalesces to one. */
  requestFrame(): void;
  destroy(): void;
}

/**
 * @param draw Renders one frame. Return true to request another — that is how
 *             an animation keeps the loop alive.
 */
export function createStage(
  host: HTMLElement,
  draw: (ctx: CanvasRenderingContext2D, now: number, stage: Stage) => boolean,
  onResize?: (stage: Stage) => void,
): Stage {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  // Without this, a drag gesture scrolls the page instead of drawing a line.
  canvas.style.touchAction = "none";
  host.appendChild(canvas);

  const maybeCtx = canvas.getContext("2d", { alpha: true });
  if (!maybeCtx) throw new Error("Canvas 2D is unavailable");
  // Re-bound with an explicit type: narrowing from the guard above does not
  // survive into the closures declared further down.
  const ctx: CanvasRenderingContext2D = maybeCtx;

  let width = 0;
  let height = 0;
  let frameHandle = 0;
  let destroyed = false;

  const stage: Stage = {
    canvas,
    ctx,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    requestFrame() {
      if (destroyed || frameHandle !== 0) return;
      frameHandle = requestAnimationFrame(tick);
    },
    destroy() {
      destroyed = true;
      if (frameHandle !== 0) cancelAnimationFrame(frameHandle);
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      canvas.remove();
    },
  };

  function tick(now: number) {
    frameHandle = 0;
    if (destroyed) return;
    const wantsMore = draw(ctx, now, stage);
    if (wantsMore) stage.requestFrame();
  }

  function resize() {
    const rect = host.getBoundingClientRect();
    const nextW = Math.max(1, Math.floor(rect.width));
    const nextH = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);

    const pixelW = Math.floor(nextW * dpr);
    const pixelH = Math.floor(nextH * dpr);
    if (canvas.width === pixelW && canvas.height === pixelH) return;

    width = nextW;
    height = nextH;
    canvas.width = pixelW;
    canvas.height = pixelH;
    // Draw in CSS pixels; the transform handles the rest.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    onResize?.(stage);
    stage.requestFrame();
  }

  // A hidden tab never runs rAF. Coming back needs a repaint, because the
  // state may have moved on underneath a frame that never ran.
  function onVisibility() {
    if (document.visibilityState === "visible") stage.requestFrame();
  }
  document.addEventListener("visibilitychange", onVisibility);

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  // Canvas text does not reflow when a webfont arrives — whatever was painted
  // in the fallback face stays painted. One repaint once Archivo is ready.
  // `requestFrame` is a no-op after destroy, so a late resolve is harmless.
  document.fonts?.ready.then(() => stage.requestFrame());

  return stage;
}
