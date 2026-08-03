/**
 * Touch and mouse input for the board.
 *
 * Two gestures, both always available:
 *   - TAP the space near a line. Generous tolerance; genuinely ambiguous taps
 *     near a dot are reported rather than guessed at.
 *   - DRAG from one dot to an adjacent dot. Slower but unmissable, and it feels
 *     good.
 *
 * On grids >= 10 a tap arms a ghost line and a second tap commits it, because
 * cells get small and a misplaced line hurts far more than a slow turn.
 *
 * All the geometry lives in render/layout.ts, which is unit tested. This file
 * is only gesture state.
 */

import {
  lineBetweenDots,
  nearestDot,
  nearestLine,
  type DotHit,
  type Layout,
} from "../render/layout.ts";

/** Movement beyond this (CSS px) means the player is dragging, not tapping. */
const DRAG_THRESHOLD_PX = 8;

export interface PointerHandlers {
  getLayout(): Layout;
  /** Is this line placeable right now? */
  isLegal(lineId: number): boolean;
  /** Whether the local player may act at all (not their turn, spectating, ...). */
  canAct(): boolean;
  /** Ghost line changed — null clears it. */
  onGhost(lineId: number | null): void;
  /** Player committed to a line. */
  onCommit(lineId: number): void;
  /** Tap fell between two equally plausible lines. Prompt them to aim. */
  onAmbiguous(): void;
  /** Confirm-tap: first tap arms, second commits. */
  confirmTap: boolean;
}

export function attachPointer(
  el: HTMLElement,
  handlers: PointerHandlers,
): () => void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let anchor: DotHit | null = null;
  /** Line armed by a first tap, waiting on a confirming second tap. */
  let armed: number | null = null;

  const localPoint = (e: PointerEvent) => {
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  function clearArmed() {
    if (armed !== null) {
      armed = null;
      handlers.onGhost(null);
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (pointerId !== null || !handlers.canAct()) return;
    pointerId = e.pointerId;
    // Throws if the pointer is no longer active. Capture is an optimisation for
    // drags that leave the canvas, not a requirement — never let it break input.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }

    const { x, y } = localPoint(e);
    startX = x;
    startY = y;
    dragging = false;
    anchor = nearestDot(handlers.getLayout(), x, y);
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    const { x, y } = localPoint(e);

    if (!dragging && Math.hypot(x - startX, y - startY) > DRAG_THRESHOLD_PX) {
      dragging = true;
      // Starting a drag abandons any pending confirm.
      armed = null;
    }
    if (!dragging) return;

    handlers.onGhost(resolveDrag(x, y));
  }

  /** The line a drag currently points at, if it is a legal one. */
  function resolveDrag(x: number, y: number): number | null {
    const layout = handlers.getLayout();
    if (!anchor) {
      // Drag that did not start on a dot: fall back to hover-nearest-line.
      const hit = nearestLine(layout, x, y, handlers.isLegal);
      return hit ? hit.lineId : null;
    }
    const target = nearestDot(layout, x, y);
    if (!target) return null;
    const lineId = lineBetweenDots(layout.n, anchor, target);
    if (lineId === null || !handlers.isLegal(lineId)) return null;
    return lineId;
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    const { x, y } = localPoint(e);

    // Resolve BEFORE releasing — release() clears `dragging` and `anchor`, and
    // reading them afterwards silently turns every drag into a tap.
    const wasDragging = dragging;
    const dragLine = wasDragging ? resolveDrag(x, y) : null;
    release(e);

    if (!handlers.canAct()) return;

    if (wasDragging) {
      handlers.onGhost(null);
      if (dragLine !== null) handlers.onCommit(dragLine);
      return;
    }

    // A tap.
    const hit = nearestLine(handlers.getLayout(), x, y, handlers.isLegal);
    if (!hit) {
      clearArmed();
      return;
    }

    if (hit.ambiguous && armed !== hit.lineId) {
      // Don't coin-flip between two lines the player might have meant.
      clearArmed();
      handlers.onAmbiguous();
      return;
    }

    if (!handlers.confirmTap || armed === hit.lineId) {
      armed = null;
      handlers.onGhost(null);
      handlers.onCommit(hit.lineId);
      return;
    }

    armed = hit.lineId;
    handlers.onGhost(hit.lineId);
  }

  function onPointerCancel(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    release(e);
    handlers.onGhost(null);
    armed = null;
  }

  function release(e: PointerEvent) {
    try {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    pointerId = null;
    anchor = null;
    dragging = false;
  }

  /**
   * Stop iOS turning a drag into a "go back" swipe.
   *
   * Safari's edge-swipe navigation is a SYSTEM gesture. `touch-action: none`
   * and `overscroll-behavior: none` do not touch it — the only thing that
   * suppresses it is `preventDefault()` on a NON-PASSIVE `touchstart`, and
   * listeners on document-level targets default to passive, where
   * `preventDefault` is ignored silently.
   *
   * Reported from the first LAN playtest: dragging from a dot near the left of
   * the board navigated the whole app away mid-turn. Scoped to the board
   * element, so buttons and scrollable screens elsewhere are unaffected, and
   * safe here because the board never scrolls — pointer events still fire
   * normally, since this only cancels the default action.
   */
  function onTouchStart(e: TouchEvent) {
    if (e.cancelable) e.preventDefault();
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerCancel);
  el.addEventListener("touchstart", onTouchStart, { passive: false });

  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerCancel);
    el.removeEventListener("touchstart", onTouchStart);
  };
}
