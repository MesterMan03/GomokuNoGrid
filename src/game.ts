import { kdTree } from "kd-tree-javascript";
import {
    EPSILON,
    LINE_GROUP_SEARCH_RADIUS,
    MAX_PLACEMENT_DISTANCE,
    PERPENDICULAR_TOLERANCE, SCALE,
    SYMBOL_RADIUS,
    WIN_ANGLE_STEP, WIN_D_MAX
} from "./consts.ts";

/**
 * 0: X
 * 1: O
 */
export type Player = 0 | 1;

export interface Point {
    x: number;
    y: number;
    player: Player;
}

export interface LineGroup {
    dirX: number;
    dirY: number;
    angleBucket: number;
    originX: number;
    originY: number;
    projections: number[];
    stones: Set<Point>;
}

function distance(a: Point, b: Point): number {
    return (Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)) / SCALE;
}

export enum GameState {
    ONGOING,
    WIN_0,
    WIN_1
}

export interface GameDump {
    points: Array<{ x: number; y: number; player: Player }>;
    state: GameState;
}

export class Game {
    private tree0: kdTree<Point>;
    private tree1: kdTree<Point>;
    private points: Point[];
    private points0: Point[] = [];
    private points1: Point[] = [];
    private state: GameState = GameState.ONGOING;
    private winPoints: Point[] = [];
    private lineGroups0: LineGroup[] = [];
    private lineGroups1: LineGroup[] = [];

    constructor() {
        this.tree0 = new kdTree([], distance, ["x", "y"]);
        this.tree1 = new kdTree([], distance, ["x", "y"]);
        this.points = [];
    }

    getPoints(): Point[] {
        // return immutable copy to prevent external modification
        return this.points.slice();
    }

    getState(): GameState {
        return this.state;
    }

    getWinPoints(): Point[] {
        return this.winPoints.slice();
    }

    /**
     * Build a Game from an array of points in internal (scaled) coordinates.
     * Skips gameplay validation (overlap/distance rules, win checks) — use only
     * for reconstructing known-valid states. Builds KD-trees and line groups once.
     */
    static fromPoints(points: ReadonlyArray<{ x: number; y: number; player: Player }>): Game {
        const game = new Game();
        const pts0: Point[] = [];
        const pts1: Point[] = [];
        for (const p of points) {
            const point: Point = { x: p.x, y: p.y, player: p.player };
            game.points.push(point);
            if (p.player === 0) pts0.push(point);
            else pts1.push(point);
        }
        game.points0 = pts0;
        game.points1 = pts1;
        // Build balanced KD-trees from arrays (instead of inserting one by one)
        game.tree0 = new kdTree(pts0, distance, ["x", "y"]);
        game.tree1 = new kdTree(pts1, distance, ["x", "y"]);
        game.updateLineGroups(0);
        game.updateLineGroups(1);
        return game;
    }

    /**
     * Create a deep copy of this game by directly copying state.
     * Builds balanced KD-trees from existing points instead of replaying moves.
     * Used by AI to simulate future states without mutating the real game.
     */
    clone(): Game {
        const copy = new Game();
        copy.points = this.points.slice();
        copy.points0 = this.points0.slice();
        copy.points1 = this.points1.slice();
        copy.state = this.state;
        copy.winPoints = this.winPoints.slice();
        // Build balanced KD-trees directly (avoids replaying N addMoves)
        copy.tree0 = new kdTree(copy.points0.slice(), distance, ["x", "y"]);
        copy.tree1 = new kdTree(copy.points1.slice(), distance, ["x", "y"]);
        // Deep copy line groups (opponent's groups needed for evaluation)
        copy.lineGroups0 = this.lineGroups0.map(g => ({
            ...g,
            projections: g.projections.slice(),
            stones: new Set(g.stones),
        }));
        copy.lineGroups1 = this.lineGroups1.map(g => ({
            ...g,
            projections: g.projections.slice(),
            stones: new Set(g.stones),
        }));
        return copy;
    }

    dump(): GameDump {
        return {
            points: this.points.map(p => ({ x: p.x, y: p.y, player: p.player })),
            state: this.state,
        };
    }

    static load(dump: GameDump): Game {
        const game = Game.fromPoints(dump.points);
        game.state = dump.state;
        if (dump.state !== GameState.ONGOING) {
            const player: Player = dump.state === GameState.WIN_0 ? 0 : 1;
            game.findWinningSegment(player);
        }
        return game;
    }

    addMove(x: number, y: number, player: Player): Point | null {
        if(this.state !== GameState.ONGOING) {
            console.debug("Move rejected: game already ended");
            return null;
        }

        // scale up the coordinates for better precision in distance calculations
        x = Math.round(x * SCALE);
        y = Math.round(y * SCALE);

        // rule 1: no overlapping moves
        const point = { x, y, player } satisfies Point;
        const nearest = [this.tree0.nearest(point, 1), this.tree1.nearest(point, 1)].flat();
        if(nearest.find(([_, dist]) => dist < SYMBOL_RADIUS * 2)) {
            console.debug("Move rejected: too close to existing move");
            return null;
        }


        // rule 2: closest move must be within MAX_PLACEMENT_DISTANCE
        const sortedDistances = nearest.map(([_, dist]) => dist).sort((a, b) => a - b);
        if(sortedDistances.length > 0 && sortedDistances[0]! > MAX_PLACEMENT_DISTANCE) {
            console.debug("Move rejected: too far from existing moves");
            return null;
        }


        if(player === 0) {
            this.tree0.insert(point);
            this.points0.push(point);
        } else {
            this.tree1.insert(point);
            this.points1.push(point);
        }
        this.points.push(point);

        // update line groups for the new stone
        this.updateLineGroups(point.player);

        // check for win condition using line groups
        if(this.findWinningSegment(point.player)) {
            this.state = player === 0 ? GameState.WIN_0 : GameState.WIN_1;
            console.log(`Player ${player} wins!`);
        }

        return point;
    }

    /**
     * Remove the last move and rebuild internal state.
     * Works even after the game has ended (win state).
     * Returns the removed point, or null if no moves to undo.
     */
    undo(): Point | null {
        if (this.points.length === 0) return null;

        const removed = this.points.pop()!;

        // Remove from per-player array
        if (removed.player === 0) {
            this.points0.pop();
        } else {
            this.points1.pop();
        }

        // Rebuild KD-trees from remaining points
        this.tree0 = new kdTree(this.points0.slice(), distance, ["x", "y"]);
        this.tree1 = new kdTree(this.points1.slice(), distance, ["x", "y"]);

        // Rebuild line groups
        this.updateLineGroups(0);
        this.updateLineGroups(1);

        // Re-evaluate game state
        this.state = GameState.ONGOING;
        this.winPoints = [];
        if (this.findWinningSegment(0)) {
            this.state = GameState.WIN_0;
        } else if (this.findWinningSegment(1)) {
            this.state = GameState.WIN_1;
        }

        return removed;
    }

    getClosestPlayerPoint(point: Point, count: number = 1): Point[] | null {
        const tree = point.player === 0 ? this.tree0 : this.tree1;
        const nearest = tree.nearest(point, count);
        if(nearest.length === 0) return null;
        return nearest.map(([p, _]) => p);
    }

    getPlayerPoints(player: Player): Point[] {
        return (player === 0 ? this.points0 : this.points1).slice();
    }

    getLineGroups(player: Player): ReadonlyArray<LineGroup> {
        return (player === 0 ? this.lineGroups0 : this.lineGroups1).slice();
    }

    isValidMove(x: number, y: number): boolean {
        if (this.state !== GameState.ONGOING) return false;

        const sx = Math.round(x * SCALE);
        const sy = Math.round(y * SCALE);
        const point = { x: sx, y: sy, player: 0 as Player };

        const nearest = [...this.tree0.nearest(point, 1), ...this.tree1.nearest(point, 1)]
            .sort((a, b) => a[1] - b[1]);

        if (nearest.length === 0) return true;
        if (nearest[0]![1] < SYMBOL_RADIUS * 2) return false;
        return nearest[0]![1] <= MAX_PLACEMENT_DISTANCE;
    }

    /**
     * Check if any line group for the given player has 5+ consecutive stones.
     * Sets winPoints to the endpoints of the winning segment if found.
     */
    private findWinningSegment(player: Player): boolean {
        const groups = player === 0 ? this.lineGroups0 : this.lineGroups1;
        for (const group of groups) {
            if (group.projections.length < 5) continue;

            let run = 1;
            let runStartIdx = 0;
            for (let i = 0; i < group.projections.length - 1; i++) {
                if (group.projections[i + 1]! - group.projections[i]! <= WIN_D_MAX) {
                    run++;
                    if (run >= 5) {
                        // Find stone objects sorted by projection for win endpoints
                        const sorted = Array.from(group.stones).sort((a, b) => {
                            const ta = (a.x - group.originX) * group.dirX + (a.y - group.originY) * group.dirY;
                            const tb = (b.x - group.originX) * group.dirX + (b.y - group.originY) * group.dirY;
                            return ta - tb;
                        });
                        this.winPoints = [sorted[runStartIdx]!, sorted[i + 1]!];
                        return true;
                    }
                } else {
                    run = 1;
                    runStartIdx = i + 1;
                }
            }
        }
        return false;
    }

    private updateLineGroups(player: Player): void {
        const tree = player === 0 ? this.tree0 : this.tree1;
        const points = player === 0 ? this.points0 : this.points1;
        const groups = player === 0 ? this.lineGroups0 : this.lineGroups1;

        groups.length = 0;
        const seenGroups = new Set<string>();

        for (const point of points) {
            const nearby = tree.nearest(point, 50, LINE_GROUP_SEARCH_RADIUS)
                .filter(([p]) => p !== point);

            const testedBuckets = new Set<number>();

            for (const [neighbor] of nearby) {
                const dx = neighbor.x - point.x;
                const dy = neighbor.y - point.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len <= EPSILON) continue;
                if (len > WIN_D_MAX) continue;

                let ux = dx / len;
                let uy = dy / len;

                // canonicalize direction to [0, π)
                let angle = Math.atan2(uy, ux);
                if (angle < 0) {
                    angle += Math.PI;
                    ux = -ux;
                    uy = -uy;
                } else if (angle >= Math.PI) {
                    angle -= Math.PI;
                    ux = -ux;
                    uy = -uy;
                }
                const bucket = Math.round(angle / WIN_ANGLE_STEP);

                // skip already-tested directions from this point
                if (testedBuckets.has(bucket)) continue;
                testedBuckets.add(bucket);

                // find all collinear points in the nearby set
                const collinear: Array<{ point: Point; proj: number }> = [];
                collinear.push({ point, proj: 0 });

                for (const [candidate] of nearby) {
                    if (candidate === point) continue;
                    const vx = candidate.x - point.x;
                    const vy = candidate.y - point.y;
                    const perp = Math.abs(vx * uy - vy * ux);
                    if (perp <= PERPENDICULAR_TOLERANCE) {
                        const proj = vx * ux + vy * uy;
                        collinear.push({ point: candidate, proj });
                    }
                }

                // sort by projection
                collinear.sort((a, b) => a.proj - b.proj);

                // split into consecutive segments (gap ≤ WIN_D_MAX)
                let segStart = 0;
                for (let i = 0; i < collinear.length - 1; i++) {
                    if (collinear[i + 1]!.proj - collinear[i]!.proj > WIN_D_MAX) {
                        if (i - segStart + 1 >= 2) {
                            this.addGroupIfNew(groups, seenGroups, collinear.slice(segStart, i + 1), ux, uy, bucket);
                        }
                        segStart = i + 1;
                    }
                }
                // last segment
                if (collinear.length - segStart >= 2) {
                    this.addGroupIfNew(groups, seenGroups, collinear.slice(segStart), ux, uy, bucket);
                }
            }
        }
    }

    private addGroupIfNew(
        groups: LineGroup[],
        seen: Set<string>,
        segment: Array<{ point: Point; proj: number }>,
        ux: number, uy: number, bucket: number,
    ): void {
        // canonical key from sorted coordinates to deduplicate
        const key = segment
            .map(s => `${s.point.x},${s.point.y}`)
            .sort()
            .join("|");
        if (seen.has(key)) return;
        seen.add(key);

        const origin = segment[0]!.point;
        groups.push({
            dirX: ux,
            dirY: uy,
            angleBucket: bucket,
            originX: origin.x,
            originY: origin.y,
            projections: segment.map(s => {
                return (s.point.x - origin.x) * ux + (s.point.y - origin.y) * uy;
            }).sort((a, b) => a - b),
            stones: new Set(segment.map(s => s.point)),
        });
    }
}