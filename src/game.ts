import { kdTree } from "kd-tree-javascript";
import {
    EPSILON,
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

interface Point {
    x: number;
    y: number;
    player: Player;
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
    private tree0: kdTree<Point>;
    private tree1: kdTree<Point>;
    private points: Point[];
    private state: GameState = GameState.ONGOING;

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
        if(nearest.length > 0 && nearest[0]!![1] < SYMBOL_RADIUS * 2) {
            console.log("Move rejected: too close to existing move");
            return null;
        }

        // rule 2: closest move must be within MAX_PLACEMENT_DISTANCE
        if(nearest.length > 0 && nearest[0]!![1] > MAX_PLACEMENT_DISTANCE) {
            console.log("Move rejected: too far from existing moves");
            return null;
        }


        if(player === 0) this.tree0.insert(point);
        else this.tree1.insert(point);
        this.points.push(point);

        // check for win condition
        if(this.checkWin(point)) {
            this.state = player === 0 ? GameState.WIN_0 : GameState.WIN_1;
            console.log(`Player ${player} wins!`);
        }

        return point;
    }

    getClosestPlayerPoint(point: Point): Point | null {
        const tree = point.player === 0 ? this.tree0 : this.tree1;
        const nearest = tree.nearest(point, 1);
        if(nearest.length === 0) return null;
        return nearest[0]!![0];
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
                    if(consecutiveCount >= 5) return true; // win condition met
                } else {
                    console.debug("Invalid spacing between projections:", currentProj, nextProj, "delta:", delta, "resetting consecutive count");
                    consecutiveCount = 1; // reset count if spacing is not valid
                }
            }
        }

        return false;
    }
}