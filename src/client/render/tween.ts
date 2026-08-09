/**
 * Minimal keyed animator. No dependencies, no allocation per frame.
 *
 * Animations are identified by a string key ("line:42", "box:7") so the render
 * loop can ask "how far along is this?" without holding references to anything.
 */

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;
export const easeOutQuint: Easing = (t) => 1 - (1 - t) ** 5;
export const easeInOutQuad: Easing = (t) =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/** Overshoots past 1 before settling. Good for the claim pulse. */
export const easeOutBack: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/**
 * `easeOutBack` with the overshoot as a parameter, because the board roll-in
 * was tuned to its own value (1.35) rather than the standard 1.70158 — a
 * bouncier one made eleven rows of dots look like they were falling downstairs.
 */
export function easeOutBackWith(overshoot: number): Easing {
  const c3 = overshoot + 1;
  return (t) => 1 + c3 * (t - 1) ** 3 + overshoot * (t - 1) ** 2;
}

/** Rises to 1 then falls back to 0. For pulses that return to rest. */
export const pulse: Easing = (t) => Math.sin(t * Math.PI);

interface Entry {
  start: number;
  duration: number;
  ease: Easing;
}

export class Animator {
  private entries = new Map<string, Entry>();

  start(key: string, now: number, duration: number, ease: Easing = easeOutCubic): void {
    this.entries.set(key, { start: now, duration, ease });
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  cancel(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * Eased progress in [0, 1]. Returns 1 for unknown keys so callers can treat
   * "finished" and "never started" identically — which is what you want when a
   * snapshot arrives mid-animation.
   */
  value(key: string, now: number): number {
    const e = this.entries.get(key);
    if (e === undefined) return 1;
    const raw = e.duration <= 0 ? 1 : (now - e.start) / e.duration;
    return e.ease(Math.min(1, Math.max(0, raw)));
  }

  /** Raw, un-eased progress. Needed when easing would distort a hold. */
  rawValue(key: string, now: number): number {
    const e = this.entries.get(key);
    if (e === undefined) return 1;
    return e.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - e.start) / e.duration));
  }

  /**
   * Drop finished animations. Returns true while any remain, which is what the
   * stage uses to decide whether to schedule another frame.
   */
  update(now: number): boolean {
    for (const [key, e] of this.entries) {
      if (now - e.start >= e.duration) this.entries.delete(key);
    }
    return this.entries.size > 0;
  }

  get busy(): boolean {
    return this.entries.size > 0;
  }
}
