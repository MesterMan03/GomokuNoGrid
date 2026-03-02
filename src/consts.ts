export const SYMBOL_RADIUS = 10;
export const SCALE = 1000;

/**
 * The maximum distance from the closest stone where a move is considered valid.
 */
export const MAX_PLACEMENT_DISTANCE = 6 * SYMBOL_RADIUS;

export const PERPENDICULAR_TOLERANCE = 0.3 * SYMBOL_RADIUS * SCALE;
export const WIN_D_MAX = Math.round(3.5 * SYMBOL_RADIUS * SCALE);
/**
 * Search radius for finding nearby same-player stones when building line groups (world units).
 */
export const LINE_GROUP_SEARCH_RADIUS = 20 * SYMBOL_RADIUS;
export const WIN_ANGLE_STEP = Math.PI / 32;

export const EPSILON = 1e-4;

/**
 * The ideal spacing between consecutive stones in a line (world units).
 * Between SYMBOL_RADIUS * 2 (no overlap) and WIN_D_MAX / SCALE (max consecutive gap).
 */
export const IDEAL_SPACING = Math.round((2 * SYMBOL_RADIUS * SCALE + WIN_D_MAX) / 2);
