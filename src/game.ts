import { kdTree } from "kd-tree-javascript";
import {
    EPSILON,
    LINE_GROUP_SEARCH_RADIUS,
    MAX_PLACEMENT_DISTANCE,
    PERPENDICULAR_TOLERANCE, SCALE,
    SYMBOL_RADIUS,
    WIN_ANGLE_STEP, WIN_D_MAX,
    WIN_SEARCH_RADIUS
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

export class Game {
    private readonly tree0: kdTree<Point>;
    private readonly tree1: kdTree<Point>;
    private points: Point[];
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
     * Create a deep copy of this game by replaying all recorded moves.
     * Used by AI to simulate future states without mutating the real game.
     */
    clone(): Game {
        const copy = new Game();
        for (const point of this.points) {
            copy.addMove(point.x / SCALE, point.y / SCALE, point.player);
        }
        return copy;
    }

    addMove(x: number, y: number, player: Player): Point | null {
        if(this.state !== GameState.ONGOING) {
            console.log("Move rejected: game already ended");
            return null;
        }

        // scale up the coordinates for better precision in distance calculations
        x = Math.round(x * SCALE);
        y = Math.round(y * SCALE);

        // rule 1: no overlapping moves
        const point = { x, y, player } satisfies Point;
        const nearest = [this.tree0.nearest(point, 1), this.tree1.nearest(point, 1)].flat();
        if(nearest.find(([_, dist]) => dist < SYMBOL_RADIUS * 2)) {
            console.log("Move rejected: too close to existing move");
            return null;
        }


        // rule 2: closest move must be within MAX_PLACEMENT_DISTANCE
        const sortedDistances = nearest.map(([_, dist]) => dist).sort((a, b) => a - b);
        if(sortedDistances.length > 0 && sortedDistances[0]! > MAX_PLACEMENT_DISTANCE) {
            console.log("Move rejected: too far from existing moves");
            return null;
        }


        if(player === 0) this.tree0.insert(point);
        else this.tree1.insert(point);
        this.points.push(point);

        // update line groups for the new stone
        this.updateLineGroups(point.player);

        // check for win condition
        if(this.checkWin(point)) {
            this.state = player === 0 ? GameState.WIN_0 : GameState.WIN_1;
            console.log(`Player ${player} wins!`);
        }

        return point;
    }

    getClosestPlayerPoint(point: Point, count: number = 1): Point[] | null {
        const tree = point.player === 0 ? this.tree0 : this.tree1;
        const nearest = tree.nearest(point, count);
        if(nearest.length === 0) return null;
        return nearest.map(([p, _]) => p);
    }

    checkWin(point: Point): boolean {
        const player = point.player;

        // get nearby points for the same player
        const tree = player === 0 ? this.tree0 : this.tree1;
        const nearby = tree.nearest(point, this.points.length, WIN_SEARCH_RADIUS).filter(p => p[0].x !== point.x || p[0].y !== point.y);
        if(nearby.length < 4) return false; // not enough points to win

        const testedAngles = new Set<number>();

        // for each nearby point, define a candidate direction
        for(const [otherPoint] of nearby) {
            const dx = otherPoint.x - point.x;
            const dy = otherPoint.y - point.y;

            const length = Math.sqrt(dx * dx + dy * dy);
            if(length <= EPSILON) continue

            const ux = dx / length;
            const uy = dy / length;

            // quantize angle
            const angle = Math.atan2(uy, ux);
            const bucket = Math.round(angle / WIN_ANGLE_STEP);

            if(testedAngles.has(bucket)) continue; // already tested this direction
            testedAngles.add(bucket);

            // collect aligned points
            const aligned = new Set<Point>();
            aligned.add(point);

            for(const [candidate] of nearby) {
                const vx = candidate.x - point.x;
                const vy = candidate.y - point.y;

                // perpendicular distance using cross product
                const perp = Math.abs(vx * uy - vy * ux);

                if(perp <= PERPENDICULAR_TOLERANCE) aligned.add(candidate);
                else console.debug("Rejected point for alignment:", candidate, "perpendicular distance:", perp);
            }

            console.debug("Aligned points:", Array.from(aligned));
            if(aligned.size < 5) continue; // not enough aligned points

            // project to 1d
            const projections = new Array<number>();

            for(const p of aligned) {
                const tx = p.x - point.x;
                const ty = p.y - point.y;

                const t = tx * ux + ty * uy; // dot product
                projections.push(t);
            }

            // sort projections in ascending order
            projections.sort((a, b) => a - b);

            console.debug("Projections:", projections);

            // check spacing constraint
            let consecutiveCount = 1;
            for(let i = 0; i < projections.length - 1; i++) {
                const nextProj = projections[i + 1];
                const currentProj = projections[i];
                console.debug("Checking projections:", currentProj, nextProj);
                if(nextProj == null || currentProj == null) continue;

                const delta = nextProj - currentProj;
                if(delta <= WIN_D_MAX) {
                    consecutiveCount++;
                    console.debug("Valid spacing between projections:", currentProj, nextProj, "delta:", delta, "consecutiveCount:", consecutiveCount);
                    // win condition met
                    if(consecutiveCount >= 5) {
                        // set the first and last of the winning points for highlighting
                        const sortedAligned = Array.from(aligned).sort((a, b) => {
                            const ta = (a.x - point.x) * ux + (a.y - point.y) * uy;
                            const tb = (b.x - point.x) * ux + (b.y - point.y) * uy;
                            return ta - tb;
                        });
                        this.winPoints = [sortedAligned[0]!, sortedAligned[sortedAligned.length - 1]!];
                        return true;
                    }
                } else {
                    console.debug("Invalid spacing between projections:", currentProj, nextProj, "delta:", delta, "resetting consecutive count");
                    consecutiveCount = 1; // reset count if spacing is not valid
                }
            }
        }

        return false;
    }

    getPlayerPoints(player: Player): Point[] {
        return this.points.filter(p => p.player === player);
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

    private updateLineGroups(player: Player): void {
        const tree = player === 0 ? this.tree0 : this.tree1;
        const points = this.points.filter(p => p.player === player);
        const groups = player === 0 ? this.lineGroups0 : this.lineGroups1;

        // due to line groups being very fragile and complex, simply rebuild all groups from scratch for the affected player after each move
        groups.length = 0;

        for(const point of points) {
            const nearby = tree.nearest(point, 50, LINE_GROUP_SEARCH_RADIUS)
                .filter(([p]) => {
                    if(p === point) return false;

                    // don't consider neighbors that are already in the same group as the current point to avoid creating duplicate groups
                    for(const group of groups) {
                        if(group.stones.has(point) && group.stones.has(p)) {
                            return false;
                        }
                    }

                    return true;
                });

            for (const [neighbor] of nearby) {
                const dx = neighbor.x - point.x;
                const dy = neighbor.y - point.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len <= EPSILON) continue;
                if (len > WIN_D_MAX) continue; // don't create line groups with distant neighbors to limit the number of groups

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

                // find every other point collinear to the current point and neighbor
                const collinear = new Set<Point>();
                collinear.add(point);
                collinear.add(neighbor);

                for (const [candidate] of nearby) {
                    if (candidate === neighbor) continue;

                    const vx = candidate.x - point.x;
                    const vy = candidate.y - point.y;

                    // perpendicular distance using cross product
                    const perp = Math.abs(vx * uy - vy * ux);

                    if (perp <= PERPENDICULAR_TOLERANCE) collinear.add(candidate);
                }

                // create a projection of the collinear points
                const projections = new Array<{ point: Point; proj: number }>();
                for (const p of collinear) {
                    const tx = p.x - point.x;
                    const ty = p.y - point.y;
                    const proj = tx * ux + ty * uy; // dot product
                    projections.push({ point: p, proj });
                }

                // sort projections in ascending order
                projections.sort((a, b) => a.proj - b.proj);

                // find all points on this line that are close enough to be considered a group
                const groupsToCreate: Point[][] = [];
                const potentialGroup = new Set<Point>();
                for(let i = 0; i < projections.length - 1; i++) {
                    const current = projections[i]!;
                    const next = projections[i + 1]!;
                    if(next.proj - current.proj <= WIN_D_MAX) {
                        potentialGroup.add(current.point);
                        potentialGroup.add(next.point);
                    } else {
                        // create the new group and reset for the next segment
                        potentialGroup.add(current.point);
                        if(potentialGroup.size >= 2) {
                            groupsToCreate.push(Array.from(potentialGroup))
                        }
                        potentialGroup.clear();
                    }
                }

                if(potentialGroup.size >= 2) {
                    groupsToCreate.push(Array.from(potentialGroup));
                }
                for(const groupPoints of groupsToCreate) {
                    const group: LineGroup = {
                        dirX: ux,
                        dirY: uy,
                        angleBucket: bucket,
                        originX: groupPoints[0]!.x,
                        originY: groupPoints[0]!.y,
                        projections: groupPoints.map(p => {
                            const tx = p.x - groupPoints[0]!.x;
                            const ty = p.y - groupPoints[0]!.y;
                            return tx * ux + ty * uy; // dot product
                        }).sort((a, b) => a - b),
                        stones: new Set(groupPoints),
                    }
                    groups.push(group);
                }
            }
        }
    }
}