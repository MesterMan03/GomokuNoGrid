import { type AI, MoveReason, type ScoredMove, type DebugPhase, type DebugMarker, type MediumAIConfig, DEFAULT_MEDIUM_CONFIG } from "./types.ts";
import { type Game, GameState, type Player, type Point, type LineGroup } from "../game.ts";
import { IDEAL_SPACING, SCALE, WIN_D_MAX } from "../consts.ts";

const MINIMAX_DEPTH = 2; // root move already simulated → 2 more plies = 3-ply total
const WIN_SCORE = 100_000;

interface Candidate {
    x: number;
    y: number;
    reason: MoveReason;
    threatSize: number;
}

function candidateKey(x: number, y: number): string {
    return `${Math.round(x * SCALE)},${Math.round(y * SCALE)}`;
}

const REASON_COLORS: Record<MoveReason, string> = {
    [MoveReason.CRITICAL_BLOCK]: "#ff0000",
    [MoveReason.DEFENSIVE_BLOCK]: "#ff8800",
    [MoveReason.OFFENSIVE_EXTENSION]: "#00cc00",
    [MoveReason.NEARBY_RANDOM]: "#0088ff",
    [MoveReason.FALLBACK]: "#888888",
};

export class MediumAI implements AI {
    private debugPhases: DebugPhase[] = [];
    readonly config: MediumAIConfig;

    constructor(config?: Partial<MediumAIConfig>) {
        this.config = { ...DEFAULT_MEDIUM_CONFIG, ...config };
    }

    getLastDebugPhases(): DebugPhase[] {
        return this.debugPhases;
    }

    async getMove(game: Game, player: Player): Promise<ScoredMove> {
        this.debugPhases = [];
        const opponent: Player = player === 0 ? 1 : 0;
        const aiPoints = game.getPlayerPoints(player);
        const opponentPoints = game.getPlayerPoints(opponent);

        // special case: AI has no stones yet
        if (aiPoints.length === 0) {
            const move = this.firstMove(game, opponentPoints);
            return { ...move, score: 0, reason: MoveReason.FALLBACK };
        }

        // generate & rank candidates
        const allCandidates = this.generateCandidates(game, player);

        if (allCandidates.length === 0) {
            const move = this.fallbackMove(game, aiPoints, opponentPoints);
            return { ...move, score: 0, reason: MoveReason.FALLBACK };
        }

        // Debug phase 1: All candidates
        this.debugPhases.push({
            title: "Candidate Generation",
            description: `Generated ${allCandidates.length} candidate moves`,
            markers: allCandidates.map(c => ({
                x: c.x, y: c.y,
                color: REASON_COLORS[c.reason],
                label: `${c.reason.replace("_", " ")} (${c.threatSize})`,
                radius: 4,
            })),
            lines: [],
        });

        // sort by quick heuristic for better pruning at root
        allCandidates.sort(
            (a, b) => this.quickScore(b, game, player) - this.quickScore(a, game, player),
        );
        const topCandidates = allCandidates.slice(0, this.config.maxCandidates);

        // Debug phase 2: Top candidates with scores
        this.debugPhases.push({
            title: "Top Candidates",
            description: `Top ${topCandidates.length} after heuristic sort`,
            markers: topCandidates.map((c, i) => ({
                x: c.x, y: c.y,
                color: REASON_COLORS[c.reason],
                label: `#${i + 1} q=${this.quickScore(c, game, player).toFixed(0)}`,
                radius: 5,
            })),
            lines: [],
        });

        // minimax search from each root candidate
        let bestScore = -Infinity;
        let bestMove: Candidate | null = null;
        const minimaxResults: Array<{ candidate: Candidate; score: number }> = [];

        for (const candidate of topCandidates) {
            const child = game.clone();
            const placed = child.addMove(candidate.x, candidate.y, player);
            if (!placed) continue;

            const score = this.minimax(child, MINIMAX_DEPTH, -Infinity, Infinity, false, player);
            minimaxResults.push({ candidate, score });

            if (score > bestScore) {
                bestScore = score;
                bestMove = candidate;
            }
        }

        // Debug phase 3: Minimax results
        this.debugPhases.push({
            title: "Minimax Evaluation",
            description: `Evaluated ${minimaxResults.length} moves, best=${bestScore.toFixed(0)}`,
            markers: minimaxResults.map(({ candidate: c, score }) => ({
                x: c.x, y: c.y,
                color: c === bestMove ? "#ffff00" : REASON_COLORS[c.reason],
                label: `mm=${score.toFixed(0)}`,
                radius: c === bestMove ? 8 : 5,
            })),
            lines: [],
        });

        if (!bestMove) {
            const move = this.fallbackMove(game, aiPoints, opponentPoints);
            return { ...move, score: 0, reason: MoveReason.FALLBACK };
        }

        // Debug phase 4: Selected move
        this.debugPhases.push({
            title: "Selected Move",
            description: `(${bestMove.x.toFixed(1)}, ${bestMove.y.toFixed(1)}) score=${bestScore.toFixed(0)} reason=${bestMove.reason}`,
            markers: [{
                x: bestMove.x, y: bestMove.y,
                color: "#ffff00",
                label: `★ ${bestScore.toFixed(0)}`,
                radius: 10,
            }],
            lines: [],
        });

        return {
            x: bestMove.x,
            y: bestMove.y,
            score: bestScore,
            reason: bestMove.reason,
        };
    }

    // ── minimax with alpha-beta ──────────────────────────────────────────

    private minimax(
        state: Game,
        depth: number,
        alpha: number,
        beta: number,
        maximizingPlayer: boolean,
        aiPlayer: Player,
    ): number {
        // terminal or leaf
        const gs = state.getState();
        if (gs !== GameState.ONGOING) {
            const aiWin = aiPlayer === 0 ? GameState.WIN_0 : GameState.WIN_1;
            return gs === aiWin ? WIN_SCORE : -WIN_SCORE;
        }
        if (depth === 0) {
            return this.evaluate(state, aiPlayer);
        }

        const currentPlayer: Player = maximizingPlayer ? aiPlayer : (aiPlayer === 0 ? 1 : 0);
        const moves = this.generateCandidates(state, currentPlayer);

        if (moves.length === 0) {
            return this.evaluate(state, aiPlayer);
        }

        // move ordering for better pruning
        moves.sort(
            (a, b) => this.quickScore(b, state, currentPlayer) - this.quickScore(a, state, currentPlayer),
        );
        const topMoves = moves.slice(0, this.config.maxCandidates);

        if (maximizingPlayer) {
            let maxEval = -Infinity;
            for (const move of topMoves) {
                const child = state.clone();
                if (!child.addMove(move.x, move.y, currentPlayer)) continue;
                const evalScore = this.minimax(child, depth - 1, alpha, beta, false, aiPlayer);
                maxEval = Math.max(maxEval, evalScore);
                alpha = Math.max(alpha, evalScore);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const move of topMoves) {
                const child = state.clone();
                if (!child.addMove(move.x, move.y, currentPlayer)) continue;
                const evalScore = this.minimax(child, depth - 1, alpha, beta, true, aiPlayer);
                minEval = Math.min(minEval, evalScore);
                beta = Math.min(beta, evalScore);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    // ── evaluation ───────────────────────────────────────────────────────

    evaluate(state: Game, aiPlayer: Player): number {
        const opponent: Player = aiPlayer === 0 ? 1 : 0;
        let score = 0;

        // line strength
        for (const group of state.getLineGroups(aiPlayer)) {
            score += this.lineScore(group, state);
        }
        for (const group of state.getLineGroups(opponent)) {
            score -= this.lineScore(group, state) * this.config.opponentBias;
        }

        // positional clustering bonus
        const aiPoints = state.getPlayerPoints(aiPlayer);
        if (aiPoints.length > 1) {
            let totalDist = 0;
            let pairs = 0;
            for (let i = 0; i < aiPoints.length; i++) {
                for (let j = i + 1; j < aiPoints.length; j++) {
                    const dx = aiPoints[i]!.x - aiPoints[j]!.x;
                    const dy = aiPoints[i]!.y - aiPoints[j]!.y;
                    totalDist += Math.sqrt(dx * dx + dy * dy) / SCALE;
                    pairs++;
                }
            }
            score += this.config.clusteringWeight * Math.exp(-(totalDist / pairs) / this.config.clusteringDecay);
        }

        return score;
    }

    private lineScore(group: LineGroup, state: Game): number {
        const projections = group.projections;
        if (projections.length < 2) return 0;

        // count longest consecutive run (stones within WIN_D_MAX gap)
        let maxRun = 1;
        let currentRun = 1;
        for (let i = 0; i < projections.length - 1; i++) {
            const delta = projections[i + 1]! - projections[i]!;
            if (delta <= WIN_D_MAX) {
                currentRun++;
                maxRun = Math.max(maxRun, currentRun);
            } else {
                currentRun = 1;
            }
        }

        if (maxRun >= 5) return WIN_SCORE;
        if (maxRun < 2) return 0;

        // check open ends – can the line be extended?
        const minProj = projections[0]!;
        const maxProj = projections[projections.length - 1]!;
        const spacing = IDEAL_SPACING * SCALE;

        const ext1X = (group.originX + group.dirX * (minProj - spacing)) / SCALE;
        const ext1Y = (group.originY + group.dirY * (minProj - spacing)) / SCALE;
        const ext2X = (group.originX + group.dirX * (maxProj + spacing)) / SCALE;
        const ext2Y = (group.originY + group.dirY * (maxProj + spacing)) / SCALE;

        let openEnds = 0;
        if (state.isValidMove(ext1X, ext1Y)) openEnds++;
        if (state.isValidMove(ext2X, ext2Y)) openEnds++;

        if (openEnds === 0) return 0; // dead line – no value

        const weights: Record<number, number> = {
            2: this.config.lineWeight2,
            3: this.config.lineWeight3,
            4: this.config.lineWeight4,
        };
        const weight = weights[maxRun] ?? maxRun * 5;
        const openFactor = openEnds === 2 ? this.config.openFactor : 1.0;
        return weight * openFactor;
    }

    // ── quick heuristic for move ordering ────────────────────────────────

    private quickScore(candidate: Candidate, game: Game, player: Player): number {
        let score = 0;

        if (candidate.reason === MoveReason.CRITICAL_BLOCK) score += this.config.criticalBlockScore;
        else if (candidate.reason === MoveReason.DEFENSIVE_BLOCK) score += this.config.defensiveBlockScore;
        else if (candidate.reason === MoveReason.OFFENSIVE_EXTENSION) score += this.config.offensiveExtensionScore;

        score += candidate.threatSize * this.config.threatSizeWeight;

        // clustering to own stones
        const points = game.getPlayerPoints(player);
        const mx = candidate.x * SCALE;
        const my = candidate.y * SCALE;
        let minDist = Infinity;
        for (const stone of points) {
            const dx = stone.x - mx;
            const dy = stone.y - my;
            const dist = Math.sqrt(dx * dx + dy * dy) / SCALE;
            if (dist < minDist) minDist = dist;
        }
        if (minDist < Infinity) {
            score += this.config.clusterQuickWeight * Math.exp(-minDist / this.config.clusteringDecay);
        }

        return score;
    }

    // ── candidate generation ─────────────────────────────────────────────

    private generateCandidates(game: Game, player: Player): Candidate[] {
        const opponent: Player = player === 0 ? 1 : 0;
        const candidateMap = new Map<string, Candidate>();

        // offensive extensions (own groups, size ≥ 2)
        this.addLineExtensions(game.getLineGroups(player), candidateMap);

        // defensive blocks (opponent groups, size ≥ 2)
        this.addBlockingMoves(game.getLineGroups(opponent), candidateMap);

        // tactical neighbors when too few candidates
        if (candidateMap.size < this.config.maxCandidates) {
            this.addTacticalNeighbors(game.getPlayerPoints(player), candidateMap);
        }

        return [...candidateMap.values()].filter(c => game.isValidMove(c.x, c.y));
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

            if (!candidates.has(key1) || candidates.get(key1)!.reason === MoveReason.NEARBY_RANDOM) {
                candidates.set(key1, { x: ext1X, y: ext1Y, reason: MoveReason.OFFENSIVE_EXTENSION, threatSize: group.stones.size });
            }
            if (!candidates.has(key2) || candidates.get(key2)!.reason === MoveReason.NEARBY_RANDOM) {
                candidates.set(key2, { x: ext2X, y: ext2Y, reason: MoveReason.OFFENSIVE_EXTENSION, threatSize: group.stones.size });
            }
        }
    }

    private addBlockingMoves(opponentGroups: ReadonlyArray<LineGroup>, candidates: Map<string, Candidate>): void {
        for (const group of opponentGroups) {
            if (group.stones.size < 2) continue;

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

    private addTacticalNeighbors(playerPoints: Point[], candidates: Map<string, Candidate>): void {
        const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4];
        for (const stone of playerPoints) {
            for (const angle of angles) {
                const x = stone.x / SCALE + Math.cos(angle) * IDEAL_SPACING;
                const y = stone.y / SCALE + Math.sin(angle) * IDEAL_SPACING;
                const key = candidateKey(x, y);
                if (!candidates.has(key)) {
                    candidates.set(key, { x, y, reason: MoveReason.OFFENSIVE_EXTENSION, threatSize: 0 });
                }
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

    // ── fallback / first-move helpers ────────────────────────────────────

    private firstMove(game: Game, opponentPoints: Point[]): { x: number; y: number } {
        if (opponentPoints.length === 0) {
            return { x: 400, y: 400 };
        }

        const target = opponentPoints[0]!;
        for (let i = 0; i < 20; i++) {
            const angle = (Math.PI * 2 * i) / 20;
            const x = target.x / SCALE + Math.cos(angle) * IDEAL_SPACING;
            const y = target.y / SCALE + Math.sin(angle) * IDEAL_SPACING;
            if (game.isValidMove(x, y)) return { x, y };
        }

        return { x: target.x / SCALE + IDEAL_SPACING, y: target.y / SCALE };
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
