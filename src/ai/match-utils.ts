import { Game, GameState, type Player, type Point } from "../game.ts";
import { IDEAL_SPACING, SCALE, WIN_D_MAX } from "../consts.ts";
import type { AI } from "./types.ts";

// ── Standalone Position Evaluation ──────────────────────────────────────

export function evaluatePosition(game: Game, player: Player): number {
    const opponent: Player = player === 0 ? 1 : 0;
    let score = 0;

    for (const group of game.getLineGroups(player)) {
        const projections = group.projections;
        if (projections.length < 2) continue;
        let maxRun = 1, run = 1;
        for (let i = 0; i < projections.length - 1; i++) {
            const delta = projections[i + 1]! - projections[i]!;
            if (delta <= WIN_D_MAX) {
                run++;
                maxRun = Math.max(maxRun, run);
            } else {
                run = 1;
            }
        }
        if (maxRun >= 5) return 10000;
        if (maxRun >= 4) score += 300;
        else if (maxRun >= 3) score += 50;
        else if (maxRun >= 2) score += 10;
    }

    for (const group of game.getLineGroups(opponent)) {
        const projections = group.projections;
        if (projections.length < 2) continue;
        let maxRun = 1, run = 1;
        for (let i = 0; i < projections.length - 1; i++) {
            const delta = projections[i + 1]! - projections[i]!;
            if (delta <= WIN_D_MAX) {
                run++;
                maxRun = Math.max(maxRun, run);
            } else {
                run = 1;
            }
        }
        if (maxRun >= 5) return -10000;
        if (maxRun >= 4) score -= 300;
        else if (maxRun >= 3) score -= 50;
        else if (maxRun >= 2) score -= 10;
    }

    return score;
}

// ── Match Simulation ────────────────────────────────────────────────────

export async function playMatch(
    ai0: AI,
    ai1: AI,
    maxMoves: number,
    onUpdate?: (points: Point[], state: GameState) => void,
): Promise<number> {
    const game = new Game();
    game.addMove(400, 400, 0);

    const firstReply = await ai1.getMove(game, 1);
    if (!game.addMove(firstReply.x, firstReply.y, 1)) {
        // First reply failed — try random fallback placement
        let placed = false;
        const points = game.getPoints();
        if (points.length === 0) {
            onUpdate?.(points, game.getState());
            return Math.max(-1, Math.min(1, evaluatePosition(game, 0) / 1000));
        }
        for (let attempt = 0; attempt < 50; attempt++) {
            const target = points[Math.floor(Math.random() * points.length)]!;
            const angle = Math.random() * Math.PI * 2;
            const dist = IDEAL_SPACING + Math.random() * 15;
            const fx = target.x / SCALE + Math.cos(angle) * dist;
            const fy = target.y / SCALE + Math.sin(angle) * dist;
            if (game.addMove(fx, fy, 1)) {
                placed = true;
                break;
            }
        }
        if (!placed) {
            onUpdate?.(game.getPoints(), game.getState());
            const state = game.getState();
            if (state === GameState.WIN_0) return 1;
            if (state === GameState.WIN_1) return -1;
            return Math.max(-1, Math.min(1, evaluatePosition(game, 0) / 1000));
        }
    }

    let currentPlayer: Player = 0;
    for (let moveNum = 2; moveNum < maxMoves; moveNum++) {
        if (game.getState() !== GameState.ONGOING) break;

        const ai = currentPlayer === 0 ? ai0 : ai1;
        const move = await ai.getMove(game, currentPlayer);

        if (!game.addMove(move.x, move.y, currentPlayer)) {
            let placed = false;
            const points = game.getPoints();
            for (let attempt = 0; attempt < 50; attempt++) {
                const target = points[Math.floor(Math.random() * points.length)]!;
                const angle = Math.random() * Math.PI * 2;
                const dist = IDEAL_SPACING + Math.random() * 15;
                const fx = target.x / SCALE + Math.cos(angle) * dist;
                const fy = target.y / SCALE + Math.sin(angle) * dist;
                if (game.addMove(fx, fy, currentPlayer)) {
                    placed = true;
                    break;
                }
            }
            if (!placed) break;
        }

        currentPlayer = currentPlayer === 0 ? 1 : 0;

        // Send game state update and yield periodically
        if (moveNum % 3 === 0) {
            onUpdate?.(game.getPoints(), game.getState());
            await new Promise(r => setTimeout(r, 0));
        }
    }

    onUpdate?.(game.getPoints(), game.getState());

    const state = game.getState();
    if (state === GameState.WIN_0) return 1;
    if (state === GameState.WIN_1) return -1;

    const eval0 = evaluatePosition(game, 0);
    return Math.max(-1, Math.min(1, eval0 / 1000));
}
