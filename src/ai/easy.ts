import { type AI, MoveReason, type ScoredMove } from "./types.ts";
import type { Game, Player, Point, LineGroup } from "../game.ts";
import { IDEAL_SPACING, SCALE } from "../consts.ts";

const TOP_K = 3;
const NOISE_AMOUNT = 15;
const CRITICAL_BLOCK_SCORE = 500;
const DEFENSIVE_BLOCK_SCORE = 150;
const OFFENSIVE_WEIGHT = 20;
const CLUSTERING_DECAY = 30;
const NEARBY_RANDOM_COUNT = 2;

interface Candidate {
    x: number;
    y: number;
    reason: MoveReason;
    threatSize: number;
}

function candidateKey(x: number, y: number): string {
    return `${Math.round(x * SCALE)},${Math.round(y * SCALE)}`;
}

export class EasyAI implements AI {
    getMove(game: Game, player: Player): ScoredMove {
        const opponent: Player = player === 0 ? 1 : 0;
        const aiPoints = game.getPlayerPoints(player);
        const opponentPoints = game.getPlayerPoints(opponent);
        const aiGroups = game.getLineGroups(player);
        const opponentGroups = game.getLineGroups(opponent);

        // special case: AI has no stones yet
        if (aiPoints.length === 0) {
            const move = this.firstMove(game, opponentPoints);
            return { ...move, score: 0, reason: MoveReason.FALLBACK };
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
            const move = this.fallbackMove(game, aiPoints, opponentPoints);
            return { ...move, score: 0, reason: MoveReason.FALLBACK };
        }

        // score candidates
        const scored: ScoredMove[] = candidates.map(c => this.scoreMove(c, aiPoints));

        // critical blocks always take priority
        const criticalBlocks = scored.filter(m => m.reason === MoveReason.CRITICAL_BLOCK);
        if (criticalBlocks.length > 0) {
            criticalBlocks.sort((a, b) => b.score - a.score);
            const topK = criticalBlocks.slice(0, TOP_K);
            return topK[Math.floor(Math.random() * topK.length)]!;
        }

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

    private addLineExtensions(groups: ReadonlyArray<LineGroup>, candidates: Map<string, Candidate>): void {
        for (const group of groups) {
            if (group.stones.size < 2) continue;

            const minProj = group.projections[0]!;
            const maxProj = group.projections[group.projections.length - 1]!;
            const spacing = IDEAL_SPACING * SCALE;

            const ext1X = (group.originX + group.dirX * (minProj - spacing)) / SCALE;
            const ext1Y = (group.originY + group.dirY * (minProj - spacing)) / SCALE;
            const ext2X = (group.originX + group.dirX * (maxProj + spacing)) / SCALE;
            const ext2Y = (group.originY + group.dirY * (maxProj + spacing)) / SCALE;

            const key1 = candidateKey(ext1X, ext1Y);
            const key2 = candidateKey(ext2X, ext2Y);

            // only set if no higher-priority candidate exists at this position
            if (!candidates.has(key1) || candidates.get(key1)!.reason === MoveReason.NEARBY_RANDOM) {
                candidates.set(key1, { x: ext1X, y: ext1Y, reason: MoveReason.OFFENSIVE_EXTENSION, threatSize: 0 });
            }
            if (!candidates.has(key2) || candidates.get(key2)!.reason === MoveReason.NEARBY_RANDOM) {
                candidates.set(key2, { x: ext2X, y: ext2Y, reason: MoveReason.OFFENSIVE_EXTENSION, threatSize: 0 });
            }
        }
    }

    private addBlockingMoves(opponentGroups: ReadonlyArray<LineGroup>, candidates: Map<string, Candidate>): void {
        for (const group of opponentGroups) {
            if (group.stones.size < 3) continue;

            const minProj = group.projections[0]!;
            const maxProj = group.projections[group.projections.length - 1]!;
            const spacing = IDEAL_SPACING * SCALE;

            const ext1X = (group.originX + group.dirX * (minProj - spacing)) / SCALE;
            const ext1Y = (group.originY + group.dirY * (minProj - spacing)) / SCALE;
            const ext2X = (group.originX + group.dirX * (maxProj + spacing)) / SCALE;
            const ext2Y = (group.originY + group.dirY * (maxProj + spacing)) / SCALE;

            const reason = group.stones.size >= 4 ? MoveReason.CRITICAL_BLOCK : MoveReason.DEFENSIVE_BLOCK;

            const key1 = candidateKey(ext1X, ext1Y);
            const key2 = candidateKey(ext2X, ext2Y);

            // blocking moves always override lower-priority candidates
            const existing1 = candidates.get(key1);
            if (!existing1 || this.reasonPriority(reason) > this.reasonPriority(existing1.reason) || group.stones.size > existing1.threatSize) {
                candidates.set(key1, { x: ext1X, y: ext1Y, reason, threatSize: group.stones.size });
            }

            const existing2 = candidates.get(key2);
            if (!existing2 || this.reasonPriority(reason) > this.reasonPriority(existing2.reason) || group.stones.size > existing2.threatSize) {
                candidates.set(key2, { x: ext2X, y: ext2Y, reason, threatSize: group.stones.size });
            }
        }
    }

    private reasonPriority(reason: MoveReason): number {
        switch (reason) {
            case MoveReason.CRITICAL_BLOCK: return 4;
            case MoveReason.DEFENSIVE_BLOCK: return 3;
            case MoveReason.OFFENSIVE_EXTENSION: return 2;
            case MoveReason.NEARBY_RANDOM: return 1;
            case MoveReason.FALLBACK: return 0;
        }
    }

    private addNearbyRandom(aiPoints: Point[], candidates: Map<string, Candidate>): void {
        for (const stone of aiPoints) {
            for (let i = 0; i < NEARBY_RANDOM_COUNT; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = IDEAL_SPACING + (Math.random() - 0.5) * 10;
                const x = stone.x / SCALE + Math.cos(angle) * dist;
                const y = stone.y / SCALE + Math.sin(angle) * dist;
                const key = candidateKey(x, y);
                // never overwrite a higher-priority candidate
                if (!candidates.has(key)) {
                    candidates.set(key, { x, y, reason: MoveReason.NEARBY_RANDOM, threatSize: 0 });
                }
            }
        }
    }

    private scoreMove(candidate: Candidate, aiPoints: Point[]): ScoredMove {
        let score = 0;
        const mx = candidate.x * SCALE;
        const my = candidate.y * SCALE;

        // base score from move reason
        if (candidate.reason === MoveReason.CRITICAL_BLOCK) {
            score += CRITICAL_BLOCK_SCORE;
        } else if (candidate.reason === MoveReason.DEFENSIVE_BLOCK) {
            score += DEFENSIVE_BLOCK_SCORE;
        }

        // alignment gain — bonus for being at ideal spacing from AI stones
        for (const stone of aiPoints) {
            const dx = stone.x - mx;
            const dy = stone.y - my;
            const dist = Math.sqrt(dx * dx + dy * dy) / SCALE;
            if (Math.abs(dist - IDEAL_SPACING) < 10) {
                score += OFFENSIVE_WEIGHT;
            }
        }

        // clustering bonus
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

        // random noise
        score += (Math.random() - 0.5) * 2 * NOISE_AMOUNT;

        return {
            x: candidate.x,
            y: candidate.y,
            score,
            reason: candidate.reason,
        };
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
