import { kdTree } from "kd-tree-javascript";
import {
    EPSILON,
    MAX_PLACEMENT_DISTANCE,
    PERPENDICULAR_TOLERANCE, SCALE,
    SYMBOL_RADIUS,
    WIN_ANGLE_STEP, WIN_D_MAX,
    WIN_D_MIN, WIN_SEARCH_RADIUS
} from "./consts.ts";

type Player = 0 | 1;

interface Point {
    x: number;
    y: number;
    player: Player;
}

function distance(a: Point, b: Point): number {
    return (Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)) / SCALE;
}

export class Game {
    private tree: kdTree<Point>;
    points: Point[];

    constructor() {
        this.tree = new kdTree([], distance, ["x", "y"]);
        this.points = [];
    }

    addMove(x: number, y: number, player: Player): boolean {
        // scale up the coordinates for better precision in distance calculations
        x = Math.round(x * SCALE);
        y = Math.round(y * SCALE);

        // rule 1: no overlapping moves
        const nearest = this.tree.nearest({ x, y, player: 0 }, 1);
        if(nearest.length > 0 && nearest[0]!![1] < SYMBOL_RADIUS * 2) {
            console.log("Move rejected: too close to existing move");
            return false;
        }

        // rule 2: closest move must be within MAX_PLACEMENT_DISTANCE
        if(nearest.length > 0 && nearest[0]!![1] > MAX_PLACEMENT_DISTANCE) {
            console.log("Move rejected: too far from existing moves");
            return false;
        }

        this.tree.insert({ x, y, player });
        // we use a separate array to keep track of points for easy access when needed
        this.points.push({ x, y, player });
        return true;
    }

    async checkWin(point: Point): Promise<boolean> {
        const player = point.player;

        // get nearby points for the same player
        const nearby = this.tree.nearest(point, this.points.length, WIN_SEARCH_RADIUS).filter(p => p[0].player === player && (p[0].x !== point.x || p[0].y !== point.y));
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
                if(WIN_D_MIN <= delta && delta <= WIN_D_MAX) {
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

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const game = new Game();

const indicatorCanvas = document.createElement("canvas");
indicatorCanvas.width = canvas.width;
indicatorCanvas.height = canvas.height;
const indicatorCtx = indicatorCanvas.getContext("2d")!;

let currentPlayer: Player = 0;

let translateX = 0;
let translateY = 0;
let scale = 1;
const scaleAmount = 1.05;

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

function draw() {
    ctx.setTransform(scale, 0, 0, scale, translateX, translateY);
    ctx.clearRect(
        -translateX / scale,
        -translateY / scale,
        canvas.width / scale,
        canvas.height / scale
    );

    // background
    ctx.fillStyle = "white";
    ctx.fillRect(-translateX / scale,
        -translateY / scale,
        canvas.width / scale,
        canvas.height / scale);

    // draw placement indicator
    indicatorCtx.fillStyle = "aqua";
    for(const point of game.points) {
        indicatorCtx.beginPath();
        indicatorCtx.arc(point.x / SCALE, point.y / SCALE, MAX_PLACEMENT_DISTANCE, 0, Math.PI * 2);
        indicatorCtx.fill();
    }

    indicatorCtx.fillStyle = "white";
    for(const point of game.points) {
        indicatorCtx.beginPath();
        indicatorCtx.arc(point.x / SCALE, point.y / SCALE, SYMBOL_RADIUS * 2, 0, Math.PI * 2);
        indicatorCtx.fill();
    }

    ctx.globalAlpha = 0.4;
    ctx.drawImage(indicatorCanvas, 0, 0);
    ctx.globalAlpha = 1.0;

    // draw all points
    for(const point of game.points) {
        // for player 0, draw an x, for player 1, draw an arc
        if(point.player === 0) {
            ctx.strokeStyle = "black";
            ctx.beginPath();
            ctx.moveTo(point.x / SCALE - SYMBOL_RADIUS, point.y / SCALE - SYMBOL_RADIUS);
            ctx.lineTo(point.x / SCALE + SYMBOL_RADIUS, point.y / SCALE + SYMBOL_RADIUS);
            ctx.moveTo(point.x / SCALE + SYMBOL_RADIUS, point.y / SCALE - SYMBOL_RADIUS);
            ctx.lineTo(point.x / SCALE - SYMBOL_RADIUS, point.y / SCALE + SYMBOL_RADIUS);
            ctx.stroke();
        } else {
            ctx.strokeStyle = "red";
            ctx.beginPath();
            ctx.arc(point.x / SCALE, point.y / SCALE, SYMBOL_RADIUS, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

// ---------- ZOOM TO MOUSE ----------
canvas.addEventListener("wheel", (event) => {
    event.preventDefault();

    const mouseX = event.offsetX;
    const mouseY = event.offsetY;

    const zoom = event.deltaY < 0 ? scaleAmount : 1 / scaleAmount;

    const newScale = Math.min(Math.max(scale * zoom, MIN_SCALE), MAX_SCALE);

    // Adjust translation so zoom is centered on mouse
    translateX = mouseX - (mouseX - translateX) * (newScale / scale);
    translateY = mouseY - (mouseY - translateY) * (newScale / scale);

    scale = newScale;

    draw();
});

// ---------- ARROW KEY PANNING ----------
const PAN_SPEED = 30;

window.addEventListener("keydown", (event) => {
    switch (event.key) {
        case "W":
        case "ArrowUp":
            translateY += PAN_SPEED;
            break;
        case "S":
        case "ArrowDown":
            translateY -= PAN_SPEED;
            break;
        case "A":
        case "ArrowLeft":
            translateX += PAN_SPEED;
            break;
        case "D":
        case "ArrowRight":
            translateX -= PAN_SPEED;
            break;
        default:
            return;
    }

    draw();
});

canvas.addEventListener("click", async (event) => {
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    const worldX = (screenX - translateX) / scale;
    const worldY = (screenY - translateY) / scale;

    const valid = game.addMove(worldX, worldY, currentPlayer);
    if(!valid) return; // if move is invalid, do not switch player or redraw
    draw();

    const lastPoint = game.points[game.points.length - 1];
    if(lastPoint && await game.checkWin(lastPoint)) {
        console.log(`Player ${currentPlayer} wins!`);
    }

    currentPlayer = currentPlayer === 0 ? 1 : 0; // switch player
});

requestAnimationFrame(draw);

window.game = game;