import type { AI } from "./types.ts";
import type { Game, Player, Point, LineGroup } from "../game.ts";
import { IDEAL_SPACING, MAX_PLACEMENT_DISTANCE, SCALE } from "../consts.ts";

const TOP_K = 3;
const NOISE_AMOUNT = 15;
const DEFENSIVE_WEIGHT = 50;
const OFFENSIVE_WEIGHT = 20;
const CLUSTERING_DECAY = 30;
const NEARBY_RANDOM_COUNT = 2;

interface Candidate {
    x: number;
    y: number;
}

export class EasyAI implements AI {
    getMove(game: Game, player: Player): { x: number; y: number } {
        const opponent: Player = player === 0 ? 1 : 0;
        const aiPoints = game.getPlayerPoints(player);
        const opponentPoints = game.getPlayerPoints(opponent);
        const aiGroups = game.getLineGroups(player);
        const opponentGroups = game.getLineGroups(opponent);

        // special case: AI has no stones yet
        if (aiPoints.length === 0) {
            return this.firstMove(game, opponentPoints);
        }

        // generate candidates
        const candidateMap = new Map<string, Candidate>();

        // A) line extensions (offense)
        this.addLineExtensions(aiGroups, candidateMap);

        // B) block opponent threats (defense)
        this.addBlockingMoves(opponentGroups, candidateMap);

        // C) nearby random points
        this.addNearbyRandom(aiPoints, candidateMap);

        // D) remove illegal moves
        const candidates = [...candidateMap.values()].filter(c => game.isValidMove(c.x, c.y));

        if (candidates.length === 0) {
            return this.fallbackMove(game, aiPoints, opponentPoints);
        }

        // score candidates
        const scored = candidates.map(c => ({
            x: c.x,
            y: c.y,
            score: this.scoreMove(c, aiPoints, opponentGroups),
        }));

        // sort descending by score
        scored.sort((a, b) => b.score - a.score);

        // pick from top K
        const topK = scored.slice(0, TOP_K);
        return topK[Math.floor(Math.random() * topK.length)]!;
    }

    private firstMove(game: Game, opponentPoints: Point[]): { x: number; y: number } {
        if (opponentPoints.length === 0) {
            return { x: 400, y: 400 };
        }

        const target = opponentPoints[Math.floor(Math.random() * opponentPoints.length)]!;

        for (let i = 0; i < 20; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = IDEAL_SPACING + Math.random() * 10;
            const x = target.x / SCALE + Math.cos(angle) * dist;
            const y = target.y / SCALE + Math.sin(angle) * dist;
            if (game.isValidMove(x, y)) return { x, y };
        }

        return { x: target.x / SCALE + IDEAL_SPACING, y: target.y / SCALE };
    }

    private addLineExtensions(groups: LineGroup[], candidates: Map<string, Candidate>): void {
        for (const group of groups) {
            if (group.stones.size < 2) continue;

            const minProj = group.projections[0]!;
            const maxProj = group.projections[group.projections.length - 1]!;
            const spacing = IDEAL_SPACING * SCALE;

            const ext1X = (group.originX + group.dirX * (minProj - spacing)) / SCALE;
            const ext1Y = (group.originY + group.dirY * (minProj - spacing)) / SCALE;
            const ext2X = (group.originX + group.dirX * (maxProj + spacing)) / SCALE;
            const ext2Y = (group.originY + group.dirY * (maxProj + spacing)) / SCALE;

            candidates.set(`${Math.round(ext1X)},${Math.round(ext1Y)}`, { x: ext1X, y: ext1Y });
            candidates.set(`${Math.round(ext2X)},${Math.round(ext2Y)}`, { x: ext2X, y: ext2Y });
        }
    }

    private addBlockingMoves(opponentGroups: LineGroup[], candidates: Map<string, Candidate>): void {
        for (const group of opponentGroups) {
            if (group.stones.size < 3) continue;

            const minProj = group.projections[0]!;
            const maxProj = group.projections[group.projections.length - 1]!;
            const spacing = IDEAL_SPACING * SCALE;

            const ext1X = (group.originX + group.dirX * (minProj - spacing)) / SCALE;
            const ext1Y = (group.originY + group.dirY * (minProj - spacing)) / SCALE;
            const ext2X = (group.originX + group.dirX * (maxProj + spacing)) / SCALE;
            const ext2Y = (group.originY + group.dirY * (maxProj + spacing)) / SCALE;

            candidates.set(`${Math.round(ext1X)},${Math.round(ext1Y)}`, { x: ext1X, y: ext1Y });
            candidates.set(`${Math.round(ext2X)},${Math.round(ext2Y)}`, { x: ext2X, y: ext2Y });
        }
    }

    private addNearbyRandom(aiPoints: Point[], candidates: Map<string, Candidate>): void {
        for (const stone of aiPoints) {
            for (let i = 0; i < NEARBY_RANDOM_COUNT; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = IDEAL_SPACING + (Math.random() - 0.5) * 10;
                const x = stone.x / SCALE + Math.cos(angle) * dist;
                const y = stone.y / SCALE + Math.sin(angle) * dist;
                candidates.set(`${Math.round(x)},${Math.round(y)}`, { x, y });
            }
        }
    }

    private scoreMove(
        move: Candidate,
        aiPoints: Point[],
        opponentGroups: LineGroup[],
    ): number {
        let score = 0;
        const mx = move.x * SCALE;
        const my = move.y * SCALE;

        // Feature 1: alignment gain — bonus for being at ideal spacing from AI stones
        for (const stone of aiPoints) {
            const dx = stone.x - mx;
            const dy = stone.y - my;
            const dist = Math.sqrt(dx * dx + dy * dy) / SCALE;
            if (Math.abs(dist - IDEAL_SPACING) < 10) {
                score += OFFENSIVE_WEIGHT;
            }
        }

        // Feature 2: defensive bonus — near threatening opponent lines
        for (const group of opponentGroups) {
            if (group.stones.size < 3) continue;

            const vx = mx - group.originX;
            const vy = my - group.originY;
            const perp = Math.abs(vx * group.dirY - vy * group.dirX) / SCALE;

            if (perp < IDEAL_SPACING) {
                score += DEFENSIVE_WEIGHT * group.stones.size;
            }
        }

        // Feature 3: clustering bonus
        let minDist = Infinity;
        for (const stone of aiPoints) {
            const dx = stone.x - mx;
            const dy = stone.y - my;
            const dist = Math.sqrt(dx * dx + dy * dy) / SCALE;
            if (dist < minDist) minDist = dist;
        }
        if (minDist < Infinity) {
            score += 10 * Math.exp(-minDist / CLUSTERING_DECAY);
        }

        // Feature 4: random noise
        score += (Math.random() - 0.5) * 2 * NOISE_AMOUNT;

        return score;
    }

    private fallbackMove(game: Game, aiPoints: Point[], opponentPoints: Point[]): { x: number; y: number } {
        const allPoints = [...aiPoints, ...opponentPoints];
        for (let attempt = 0; attempt < 50; attempt++) {
            const target = allPoints[Math.floor(Math.random() * allPoints.length)]!;
            const angle = Math.random() * Math.PI * 2;
            const dist = IDEAL_SPACING + Math.random() * 15;
            const x = target.x / SCALE + Math.cos(angle) * dist;
            const y = target.y / SCALE + Math.sin(angle) * dist;
            if (game.isValidMove(x, y)) return { x, y };
        }

        const center = allPoints[0]!;
        return { x: center.x / SCALE + IDEAL_SPACING, y: center.y / SCALE };
    }
}
