export const SYMBOL_RADIUS = 10;
export const SCALE = 1000;

/**
 * The maximum distance from the closest stone where a move is considered valid.
 */
export const MAX_PLACEMENT_DISTANCE = 6 * SYMBOL_RADIUS;

export const PERPENDICULAR_TOLERANCE = 0.25 * SYMBOL_RADIUS * SCALE;
export const WIN_D_MAX = Math.round(3.5 * SYMBOL_RADIUS * SCALE);
export const WIN_SEARCH_RADIUS = 5 * WIN_D_MAX;
export const WIN_ANGLE_STEP = Math.PI / 32;

export const EPSILON = 1e-4;