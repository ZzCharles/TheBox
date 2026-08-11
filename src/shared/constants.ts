/**
 * Tunable values for the whole game. Imported by both client and server.
 *
 * Anything a playtest might want to change lives here and nowhere else.
 */

/** Bump whenever a wire type changes shape. Mismatched clients are told to refresh. */
export const PROTOCOL_VERSION = 4;

// ---------------------------------------------------------------- timing ---

/** Normal turn length. */
export const TURN_SECONDS = 12;

/**
 * Continuation turns — the extra turn you get after claiming a box — are
 * shorter. You already know where the next box is, and this is what stops one
 * player holding the board for a minute on a long chain.
 */
export const CONTINUATION_TURN_SECONDS = 6;

/** Haptic + visual warning fires with this much time left. */
export const WARN_AT_SECONDS_REMAINING = 4;

/**
 * The endgame deserves thought — so past this much of the board, the clock is
 * multiplied rather than switched off (§6.3.2).
 *
 * Removing the clock here would re-open the pass exploit at precisely the worst
 * moment: once the board is mostly closed, refusing to open a chain is the whole
 * game. A longer clock grants the extra thinking time the request is actually
 * about, and the timeout auto-move stays as the thing that guarantees every
 * game terminates.
 */
export const ENDGAME_CLOCK_FRACTION = 0.6;
export const ENDGAME_CLOCK_MULTIPLIER = 2;

/** Added to every deadline so the placement animation doesn't eat think time. */
export const ANIMATION_GRACE_MS = 350;

/** Consecutive missed shot clocks before a player is parked. Resets on any move. */
export const MISSED_TURNS_TO_BENCH = 2;

/** How long a dropped socket has to come back before the player is parked. */
export const DISCONNECT_GRACE_MS = 12_000;

// ----------------------------------------------------------------- lobby ---

export const MIN_PLAYERS = 2;

/**
 * Capped at 8 because `GameState.boxes` is an Int8Array storing the owning
 * player index directly. Raising this means widening that array.
 */
export const MAX_PLAYERS = 8;

export const MAX_SPECTATORS = 20;

// ------------------------------------------------------------ board size ---

/** The engine's absolute floor, and where a collapsing board bottoms out. */
export const MIN_GRID = 6;
export const MAX_GRID = 14;

/**
 * Grand is a real commitment — 420 moves — so it takes a real table. Below this
 * it is two or three people alternating for the better part of an hour.
 */
export const GRAND_MIN_PLAYERS = 4;

/**
 * Board sizes the host can pick from in the lobby.
 *
 * A game is `2n(n+1)` MOVES long — lines, not boxes, set the clock — so length
 * grows quadratically. Naming them beats showing raw grid dimensions, because
 * "10x10" tells nobody it is a twenty-minute commitment.
 *
 * Every size starts at 8 or above so that the shrinking board works on all of
 * them: with the floor at `SHRINK_FLOOR_SQUARES`, a 6x6 board could never burn
 * a single ring, which made Twist on it indistinguishable from Simple. Each of
 * these collapses down to 6x6 and stops — one burn for Small, four for Grand.
 */
export const BOARD_PRESETS = [
  /*
   * `minPlayers: 1` is not a typo. The host picks the board while people are
   * still arriving, so gating on the CURRENT roster would grey out every size
   * in a lobby of one. The lobby already refuses to start below MIN_PLAYERS;
   * only Grand is worth withholding until the table is real.
   */
  { key: "small", label: "Small", grid: 8, minPlayers: 1 },
  { key: "medium", label: "Medium", grid: 10, minPlayers: 1 },
  { key: "large", label: "Large", grid: 12, minPlayers: 1 },
  { key: "grand", label: "Grand", grid: 14, minPlayers: GRAND_MIN_PLAYERS },
] as const;

export type BoardPresetKey = (typeof BOARD_PRESETS)[number]["key"];

export function presetForGrid(grid: number): BoardPresetKey | null {
  return BOARD_PRESETS.find((p) => p.grid === grid)?.key ?? null;
}

/** Whether a lobby of this size may pick a given board. */
export function presetAllowed(grid: number, playerCount: number): boolean {
  const preset = BOARD_PRESETS.find((p) => p.grid === grid);
  return preset === undefined ? false : playerCount >= preset.minPlayers;
}

/**
 * Default when the host hasn't chosen. Small lobbies get Small; seven or eight
 * players get Medium so nobody ends up with a handful of boxes each.
 *
 * Deliberately never returns Grand: it has to be chosen on purpose.
 */
export function gridSizeFor(playerCount: number): number {
  return playerCount >= 7 ? 10 : 8;
}

/** Rough wall-clock length, at ~6s of real thinking per move. */
export function estimatedMinutes(n: number): number {
  return Math.round((2 * n * (n + 1) * 6) / 60);
}

// ------------------------------------------------------------ twist mode ---

export const WILDCARD_COST = 10;
export const MAX_WILDCARD_CHARGES = 2;

/** Shrinking board arms once this fraction of lines is placed. */
export const SHRINK_ARM_FRACTION = 0.55;
/** Big lobbies drag, so their boards start collapsing sooner. */
export const SHRINK_ARM_FRACTION_LARGE_LOBBY = 0.45;
export const LARGE_LOBBY_THRESHOLD = 6;
/** Full rotations between collapses, once armed. */
export const SHRINK_INTERVAL_ROTATIONS = 2;

/**
 * The board stops burning once its short side would drop below this. A ring
 * collapsing into a 4x4 sliver is neither readable nor worth playing out, and
 * the burn needs a decent ring to look like anything.
 *
 * Consequence worth knowing: a Twist game no longer ends by the board eating
 * itself. It ends the ordinary way, when the surviving core is fully claimed —
 * which still terminates, because every move places a line and lines run out.
 */
export const SHRINK_FLOOR_SQUARES = 6;

export function shrinkArmFraction(playerCount: number): number {
  return playerCount >= LARGE_LOBBY_THRESHOLD
    ? SHRINK_ARM_FRACTION_LARGE_LOBBY
    : SHRINK_ARM_FRACTION;
}

// --------------------------------------------------------- streak callouts ---

/**
 * Boxes claimed in a SINGLE TURN — the whole run of continuation moves, not one
 * line — and the word that lands for it (§12.4). Highest tier that fits wins.
 *
 * ⚠️ **These thresholds are the owner's original guesses and are still unproven.**
 * §12.4 asked for them to be checked against real games before building, so they
 * were checked against simulated ones first. Two model players disagreed so
 * sharply that no honest number could be picked from either:
 *
 * | policy                    | median haul | turns hitting 4+ |
 * |---------------------------|-------------|------------------|
 * | always takes, avoids opening | 10       | 100%             |
 * | takes, opens carelessly half the time | 3 | 45%          |
 *
 * Competent play never scores below 6, so `Nice` would never fire; careless play
 * clears 4 on nearly half of all scoring turns, which is the "fires constantly
 * and stops meaning anything" failure §12.4 predicted. Real games decide it.
 * Raising `at` is a one-line change and nothing else needs to move.
 */
export const STREAK_TIERS = [
  { at: 4, word: "Nice" },
  { at: 7, word: "Blazing" },
  { at: 10, word: "Ruthless" },
  { at: 13, word: "WILDFIRE" },
  { at: 16, word: "Insanity" },
] as const;

export type StreakTier = (typeof STREAK_TIERS)[number];

/**
 * The top of the ladder, and the only rung that behaves differently.
 *
 * Every other tier fires ONCE, on the way up: a haul crossing 7 says `Blazing`
 * and then says nothing more until it reaches 10. `Insanity` instead re-fires on
 * **every further box** (owner's call, 2026-08-12) — past sixteen there is no
 * higher word to climb to, so repetition is the only escalation left, and a turn
 * that just keeps going should keep being celebrated rather than going quiet at
 * exactly its most absurd.
 */
export const STREAK_TOP_TIER = STREAK_TIERS[STREAK_TIERS.length - 1]!;

/** Does this haul sit at the rung that re-fires per box? */
export function isTopStreakTier(tier: StreakTier): boolean {
  return tier.at === STREAK_TOP_TIER.at;
}

/** The tier a haul earns, or null when it is not worth saying anything. */
export function streakTier(boxes: number): StreakTier | null {
  let hit: StreakTier | null = null;
  for (const tier of STREAK_TIERS) {
    if (boxes >= tier.at) hit = tier;
  }
  return hit;
}

// --------------------------------------------------------------- palette ---

/** Assigned in join order. Checked for separation under deuteranopia. */
export const PLAYER_COLORS = [
  "#22D3EE", // cyan
  "#F472B6", // magenta
  "#A3E635", // lime
  "#FB923C", // orange
  "#A78BFA", // violet
  "#F87171", // red
  "#2DD4BF", // teal
  "#FBBF24", // amber
] as const;

/**
 * Surface and ink. These names match the CSS custom properties in
 * `src/client/styles/base.css` one for one — one vocabulary, two files.
 */
export const COLOR_INK = "#0B0D12";
export const COLOR_RISE = "#131722";
export const COLOR_PANEL = "#171B26";
export const COLOR_PANEL_RAISED = "#1C2130";
export const COLOR_EDGE = "#242B3D";
export const COLOR_EDGE_STRONG = "#323B52";
export const COLOR_DOT = "#FFC24B";
export const COLOR_GLOW = "#FFB020";
export const COLOR_TEXT = "#E8EAF0";
export const COLOR_DIM = "#7A8296";

/**
 * Dead things don't glow, and that absence of light is how death reads on the
 * board. One flat colour covers both a dead dot and a burned (spent) tile.
 */
export const COLOR_DEAD = "#2A3040";

/**
 * A square spent on a Wildcard. Deliberately NOT ash.
 *
 * The two dead tiles mean opposite things: a square the fire took keeps its
 * point, while a square spent on a Wildcard was paid away and counts for
 * nobody. Drawing both as ash made a trade look like damage. This one reads as
 * metal — cold, hard-edged, lit from above like the primary button, with a
 * bright top bevel that ash never has. Something you traded, not something
 * that burned.
 */
export const SPENT_TILE = {
  top: "#3C4557",
  bottom: "#252B39",
  edge: "rgba(104,117,146,.85)",
  /** A one-pixel highlight along the top inner edge. This is what says metal. */
  sheen: "rgba(198,210,236,.5)",
} as const;

/**
 * The Twist burn. Canvas-only, so these live here rather than in CSS: a doomed
 * dot heats up, tiles flash through the flame ramp and cool to ash.
 */
export const FIRE = {
  doomedDot: "#FF7044",
  doomedGlow: "rgb(255,80,40)",
  ashFill: "rgba(15,19,28,.94)",
  ashEdge: "rgba(35,42,59,.85)",

  /**
   * The four stops a TILE passes through as it burns, as raw channels so the
   * renderer can interpolate between them.
   *
   * Distinct from `flameRamp` below, which colours the particles: this is the
   * square itself going white-hot, cooling to ember, and settling into ash the
   * exact colour of `ashFill`. The last stop matching ash is what makes the
   * cool land on the resting state instead of stepping to it.
   */
  tileFlash: [255, 244, 214],
  tileHot: [255, 150, 50],
  tileEmber: [190, 58, 28],
  tileAsh: [15, 19, 28],
  /** Where a cooled tile's edge ends up: the same grey as `ashEdge`. */
  tileEdgeAsh: [35, 42, 59],
  /** A dot that has finished dying. Matches `COLOR_DEAD`. */
  deadDot: [42, 48, 64],

  /** Hottest first. Sampled across a tile's flash-then-cool. */
  flameRamp: [
    "rgb(255,252,240)",
    "rgb(255,232,168)",
    "rgb(255,186,74)",
    "rgb(255,126,44)",
    "rgb(214,62,26)",
    "rgb(104,26,12)",
  ],
  smoke: "rgba(60,54,52,.55)",
} as const;
