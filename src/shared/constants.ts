/**
 * Tunable values for the whole game. Imported by both client and server.
 *
 * Anything a playtest might want to change lives here and nowhere else.
 */

/** Bump whenever a wire type changes shape. Mismatched clients are told to refresh. */
export const PROTOCOL_VERSION = 2;

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

export const MIN_GRID = 6;
export const MAX_GRID = 12;

/**
 * Board sizes the host can pick from in the lobby.
 *
 * A game is `2n(n+1)` MOVES long — lines, not boxes, set the clock — so length
 * grows quadratically. Naming them beats showing raw grid dimensions, because
 * "10x10" tells nobody it is a twenty-minute commitment.
 */
export const BOARD_PRESETS = [
  { key: "small", label: "Small", grid: 6 },
  { key: "medium", label: "Medium", grid: 8 },
  { key: "large", label: "Large", grid: 10 },
  { key: "grand", label: "Grand", grid: 12 },
] as const;

export type BoardPresetKey = (typeof BOARD_PRESETS)[number]["key"];

export function presetForGrid(grid: number): BoardPresetKey | null {
  return BOARD_PRESETS.find((p) => p.grid === grid)?.key ?? null;
}

/**
 * Default when the host hasn't chosen. Small lobbies get Medium; seven or eight
 * players get Large so nobody ends up with a handful of boxes each.
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

export function shrinkArmFraction(playerCount: number): number {
  return playerCount >= LARGE_LOBBY_THRESHOLD
    ? SHRINK_ARM_FRACTION_LARGE_LOBBY
    : SHRINK_ARM_FRACTION;
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

export const COLOR_BG_DEEP = "#0B0D12";
export const COLOR_SURFACE = "#171B26";
export const COLOR_DOT = "#FFC24B";
export const COLOR_DOT_GLOW = "#FFB020";
export const COLOR_TEXT = "#E8EAF0";
export const COLOR_TEXT_DIM = "#7A8296";
export const COLOR_SPENT = "#2A3040";
