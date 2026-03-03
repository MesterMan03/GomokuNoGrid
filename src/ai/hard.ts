import { type AI, MoveReason, type ScoredMove, type DebugPhase, type HardAIConfig, DEFAULT_HARD_CONFIG } from "./types.ts";
import { type Game, GameState, type Player, type Point, type LineGroup } from "../game.ts";
import { IDEAL_SPACING, SCALE, WIN_D_MAX } from "../consts.ts";
import type { MinimaxWorkerPool } from "./worker-pool.ts";

const WIN_SCORE = 100_000;
const MAX_NODES = 15_000;
const INNER_MAX_CANDIDATES = 8;
const CLUSTER_SAMPLE_SIZE = 8;

// ── Threat tiers ────────────────────────────────────────────────────────

const enum ThreatTier {
    TERMINAL = 0,   // 5-in-a-row
    FORCED = 1,     // open 4, double open 3
    STRONG = 2,     // open 3, fork potential
    NORMAL = 3,     // line extension, clustering
}

interface Candidate {
    x: number;
    y: number;
    reason: MoveReason;
    threatSize: number;
    tier: ThreatTier;
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

// ── Line analysis helpers ───────────────────────────────────────────────

interface LineInfo {
    maxRun: number;
    openEnds: number;
}

function analyzeLineGroup(group: LineGroup, state: Game): LineInfo {
    const projections = group.projections;
    if (projections.length < 2) return { maxRun: 1, openEnds: 0 };

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

    return { maxRun, openEnds };
}

/**
 * Check whether a position is "tactically unstable" for quiescence purposes.
 * Unstable if any line group ≥ 4 OR a double-threat exists.
 */
function isUnstable(state: Game, player: Player): boolean {
    const opponent: Player = player === 0 ? 1 : 0;

    for (const group of state.getLineGroups(player)) {
        const info = analyzeLineGroup(group, state);
        if (info.maxRun >= 4 && info.openEnds >= 1) return true;
    }
    for (const group of state.getLineGroups(opponent)) {
        const info = analyzeLineGroup(group, state);
        if (info.maxRun >= 4 && info.openEnds >= 1) return true;
    }

    // Double open-3 threat detection
    let open3Count = 0;
    for (const group of state.getLineGroups(player)) {
        const info = analyzeLineGroup(group, state);
        if (info.maxRun >= 3 && info.openEnds === 2) open3Count++;
        if (open3Count >= 2) return true;
    }

    return false;
}

// ── HardAI ──────────────────────────────────────────────────────────────

export class HardAI implements AI {
    private debugPhases: DebugPhase[] = [];
    private nodeCount = 0;
    readonly config: HardAIConfig;
    private workerPool?: MinimaxWorkerPool;

    constructor(config?: Partial<HardAIConfig>, workerPool?: MinimaxWorkerPool) {
        this.config = { ...DEFAULT_HARD_CONFIG, ...config } as HardAIConfig;
        this.workerPool = workerPool;
    }

    getLastDebugPhases(): DebugPhase[] {
        return this.debugPhases;
    }

    async getMove(game: Game, player: Player): Promise<ScoredMove> {
        this.debugPhases = [];
        this.nodeCount = 0;
        const opponent: Player = player === 0 ? 1 : 0;
        const aiPoints = game.getPlayerPoints(player);
        const opponentPoints = game.getPlayerPoints(opponent);

        // special case: AI has no stones yet
        if (aiPoints.length === 0) {
            const move = this.firstMove(game, opponentPoints);
            return { ...move, score: 0, reason: MoveReason.FALLBACK };
        }

        // generate & classify candidates
        const allCandidates = this.generateCandidates(game, player);

        if (allCandidates.length === 0) {
            const move = this.fallbackMove(game, aiPoints, opponentPoints);
            return { ...move, score: 0, reason: MoveReason.FALLBACK };
        }

        // Tier 0: immediate win — return instantly
        const winMove = allCandidates.find(c => c.tier === ThreatTier.TERMINAL);
        if (winMove) {
            this.debugPhases.push({
                title: "Immediate Win",
                description: `Win move at (${winMove.x.toFixed(1)}, ${winMove.y.toFixed(1)})`,
                markers: [{ x: winMove.x, y: winMove.y, color: "#ffff00", label: "★ WIN", radius: 10 }],
                lines: [],
            });
            return { x: winMove.x, y: winMove.y, score: WIN_SCORE, reason: winMove.reason };
        }

        // Debug phase 1: All candidates
        this.debugPhases.push({
            title: "Candidate Generation",
            description: `Generated ${allCandidates.length} candidate moves`,
            markers: allCandidates.map(c => ({
                x: c.x, y: c.y,
                color: REASON_COLORS[c.reason],
                label: `${c.reason.replace("_", " ")} T${c.tier} (${c.threatSize})`,
                radius: 4,
            })),
            lines: [],
        });

        // Move ordering: sort by priority then heuristic score
        const scoredCandidates = allCandidates.map(c => ({
            candidate: c,
            qs: this.quickScore(c, game, player),
        }));
        scoredCandidates.sort((a, b) => {
            // tier first (lower = higher priority)
            if (a.candidate.tier !== b.candidate.tier) return a.candidate.tier - b.candidate.tier;
            return b.qs - a.qs;
        });
        const topScored = scoredCandidates.slice(0, this.config.maxCandidates);
        const topCandidates = topScored.map(s => s.candidate);

        // Debug phase 2: Top candidates
        this.debugPhases.push({
            title: "Top Candidates",
            description: `Top ${topCandidates.length} after threat ordering`,
            markers: topScored.map((s, i) => ({
                x: s.candidate.x, y: s.candidate.y,
                color: REASON_COLORS[s.candidate.reason],
                label: `#${i + 1} T${s.candidate.tier} q=${s.qs.toFixed(0)}`,
                radius: 5,
            })),
            lines: [],
        });

        // Selective minimax search
        let bestScore = -Infinity;
        let bestMove: Candidate | null = null;
        const minimaxResults: Array<{ candidate: Candidate; score: number }> = [];

        const aiWinState = player === 0 ? GameState.WIN_0 : GameState.WIN_1;

        if (this.workerPool && topCandidates.length > 1) {
            // ── Parallel evaluation via worker pool ──────────────────────
            const gamePoints = game.getPoints().map(p => ({ x: p.x, y: p.y, player: p.player }));
            const candidatePositions = topCandidates.map(c => ({ x: c.x, y: c.y }));
            const results = await this.workerPool.evaluateCandidates(gamePoints, candidatePositions, player);

            for (let i = 0; i < results.length; i++) {
                const r = results[i]!;
                const candidate = topCandidates[i]!;
                minimaxResults.push({ candidate, score: r.score });
                if (r.score > bestScore) {
                    bestScore = r.score;
                    bestMove = candidate;
                }
            }
        } else {
            // ── Sequential evaluation (fallback / single candidate) ─────
            for (const candidate of topCandidates) {
                const child = game.clone();
                const placed = child.addMove(candidate.x, candidate.y, player);
                if (!placed) continue;

                if (child.getState() === aiWinState) {
                    minimaxResults.push({ candidate, score: WIN_SCORE });
                    bestScore = WIN_SCORE;
                    bestMove = candidate;
                    break;
                }

                // Dynamic depth: extend for forced/strong threats
                let depth = this.config.baseDepth;
                if (candidate.tier <= ThreatTier.FORCED) depth += 1;

                depth = Math.min(depth, this.config.maxDepth);

                const score = this.minimax(child, depth, -Infinity, Infinity, false, player, aiWinState);
                minimaxResults.push({ candidate, score });

                if (score > bestScore) {
                    bestScore = score;
                    bestMove = candidate;
                }
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

    // ── single candidate evaluation (used by workers and sequential fallback) ──

    evaluateCandidate(
        game: Game,
        candidate: { x: number; y: number },
        player: Player,
    ): { score: number; immediateWin: boolean } {
        this.nodeCount = 0;

        const child = game.clone();
        const placed = child.addMove(candidate.x, candidate.y, player);
        if (!placed) return { score: -Infinity, immediateWin: false };

        const aiWinState = player === 0 ? GameState.WIN_0 : GameState.WIN_1;
        if (child.getState() === aiWinState) {
            return { score: WIN_SCORE, immediateWin: true };
        }

        const depth = Math.min(this.config.baseDepth, this.config.maxDepth);
        const score = this.minimax(child, depth, -Infinity, Infinity, false, player, aiWinState);
        return { score, immediateWin: score >= WIN_SCORE };
    }

    // ── minimax with alpha-beta and selective extensions ─────────────────

    private terminalScore(state: Game, aiWin: GameState): number | null {
        const gs = state.getState();
        if (gs === GameState.ONGOING) return null;
        return gs === aiWin ? WIN_SCORE : -WIN_SCORE;
    }

    /**
     * Compute the effective depth for a child node, accounting for extensions
     * but never exceeding maxDepth total plies from the root.
     */
    private extendedDepth(depth: number, ext: number): number {
        const pliesFromRoot = this.config.baseDepth - depth + 1;
        return Math.max(0, Math.min(depth - 1 + ext, this.config.maxDepth - pliesFromRoot));
    }

    private minimax(
        state: Game,
        depth: number,
        alpha: number,
        beta: number,
        maximizingPlayer: boolean,
        aiPlayer: Player,
        aiWin: GameState,
    ): number {
        this.nodeCount++;
        if (this.nodeCount >= MAX_NODES) return this.evaluate(state, aiPlayer);

        const terminal = this.terminalScore(state, aiWin);
        if (terminal !== null) return terminal;

        if (depth === 0) {
            // Quiescence: if position is unstable, continue with forcing moves
            return this.quiescence(state, alpha, beta, maximizingPlayer, aiPlayer, aiWin, 2);
        }

        const currentPlayer: Player = maximizingPlayer ? aiPlayer : (aiPlayer === 0 ? 1 : 0);
        const moves = this.generateCandidates(state, currentPlayer, false);

        if (moves.length === 0) {
            return this.evaluate(state, aiPlayer);
        }

        // Move ordering for better alpha-beta pruning
        const scoredMoves = moves.map(m => ({ move: m, qs: this.quickScore(m, state, currentPlayer) }));
        scoredMoves.sort((a, b) => {
            if (a.move.tier !== b.move.tier) return a.move.tier - b.move.tier;
            return b.qs - a.qs;
        });
        const topMoves = scoredMoves.slice(0, INNER_MAX_CANDIDATES).map(s => s.move);

        if (maximizingPlayer) {
            let maxEval = -Infinity;
            let anyExplored = false;
            for (const move of topMoves) {
                const child = state.clone();
                if (!child.addMove(move.x, move.y, currentPlayer)) continue;
                anyExplored = true;

                // Extension: only for forced-tier moves (no expensive hasActiveThreat check)
                const ext = move.tier <= ThreatTier.FORCED ? 1 : 0;
                const childDepth = this.extendedDepth(depth, ext);

                const evalScore = this.terminalScore(child, aiWin)
                    ?? this.minimax(child, childDepth, alpha, beta, false, aiPlayer, aiWin);

                maxEval = Math.max(maxEval, evalScore);
                alpha = Math.max(alpha, evalScore);
                if (beta <= alpha) break;
            }
            return anyExplored ? maxEval : this.evaluate(state, aiPlayer);
        } else {
            let minEval = Infinity;
            let anyExplored = false;
            for (const move of topMoves) {
                const child = state.clone();
                if (!child.addMove(move.x, move.y, currentPlayer)) continue;
                anyExplored = true;

                const ext = move.tier <= ThreatTier.FORCED ? 1 : 0;
                const childDepth = this.extendedDepth(depth, ext);

                const evalScore = this.terminalScore(child, aiWin)
                    ?? this.minimax(child, childDepth, alpha, beta, true, aiPlayer, aiWin);

                minEval = Math.min(minEval, evalScore);
                beta = Math.min(beta, evalScore);
                if (beta <= alpha) break;
            }
            return anyExplored ? minEval : this.evaluate(state, aiPlayer);
        }
    }

    // ── quiescence search ───────────────────────────────────────────────

    private quiescence(
        state: Game,
        alpha: number,
        beta: number,
        maximizingPlayer: boolean,
        aiPlayer: Player,
        aiWin: GameState,
        qDepth: number,
    ): number {
        this.nodeCount++;
        if (this.nodeCount >= MAX_NODES) return this.evaluate(state, aiPlayer);

        const terminal = this.terminalScore(state, aiWin);
        if (terminal !== null) return terminal;

        const standPat = this.evaluate(state, aiPlayer);

        // If position is stable or quiescence depth exhausted, return static eval
        if (qDepth <= 0 || !isUnstable(state, aiPlayer)) {
            return standPat;
        }

        const currentPlayer: Player = maximizingPlayer ? aiPlayer : (aiPlayer === 0 ? 1 : 0);
        // Only search forcing moves (tier 0 and 1)
        const moves = this.generateCandidates(state, currentPlayer, false)
            .filter(m => m.tier <= ThreatTier.FORCED);

        if (moves.length === 0) return standPat;

        if (maximizingPlayer) {
            let maxEval = standPat;
            alpha = Math.max(alpha, standPat);
            if (beta <= alpha) return maxEval;

            for (const move of moves.slice(0, 6)) {
                const child = state.clone();
                if (!child.addMove(move.x, move.y, currentPlayer)) continue;

                const evalScore = this.terminalScore(child, aiWin)
                    ?? this.quiescence(child, alpha, beta, false, aiPlayer, aiWin, qDepth - 1);

                maxEval = Math.max(maxEval, evalScore);
                alpha = Math.max(alpha, evalScore);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = standPat;
            beta = Math.min(beta, standPat);
            if (beta <= alpha) return minEval;

            for (const move of moves.slice(0, 6)) {
                const child = state.clone();
                if (!child.addMove(move.x, move.y, currentPlayer)) continue;

                const evalScore = this.terminalScore(child, aiWin)
                    ?? this.quiescence(child, alpha, beta, true, aiPlayer, aiWin, qDepth - 1);

                minEval = Math.min(minEval, evalScore);
                beta = Math.min(beta, evalScore);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    // ── threat detection ────────────────────────────────────────────────

    /**
     * Classify a candidate move's threat tier by simulating placement.
     * Only used at root level — inner nodes use estimateTier() instead.
     */
    private classifyThreat(game: Game, x: number, y: number, player: Player): ThreatTier {
        const child = game.clone();
        const placed = child.addMove(x, y, player);
        if (!placed) return ThreatTier.NORMAL;

        const aiWin = player === 0 ? GameState.WIN_0 : GameState.WIN_1;
        if (child.getState() === aiWin) return ThreatTier.TERMINAL;

        let open4 = false;
        let open3Count = 0;

        for (const group of child.getLineGroups(player)) {
            const info = analyzeLineGroup(group, child);
            if (info.maxRun >= 4 && info.openEnds >= 1) open4 = true;
            if (info.maxRun >= 3 && info.openEnds === 2) open3Count++;
        }

        if (open4 || open3Count >= 2) return ThreatTier.FORCED;
        if (open3Count >= 1) return ThreatTier.STRONG;

        return ThreatTier.NORMAL;
    }

    /**
     * Lightweight tier estimation from line group size, without cloning the game.
     * Used at inner minimax nodes to avoid the expensive classifyThreat() clone.
     *
     * This is a heuristic approximation that intentionally overestimates threat
     * levels compared to classifyThreat(), since it cannot verify open ends or
     * actual connectivity after placement. Overestimation is acceptable because
     * it causes conservative behavior (searching more deeply) rather than missing
     * real threats. The trade-off is slightly more nodes searched vs the massive
     * reduction from eliminating game cloning at every inner node.
     */
    private estimateTier(groupSize: number, isOffensive: boolean): ThreatTier {
        // Offensive: extending a group of N creates N+1; blocking is about the existing threat
        const effectiveSize = isOffensive ? groupSize + 1 : groupSize;
        if (effectiveSize >= 5) return ThreatTier.TERMINAL;
        if (effectiveSize >= 4) return ThreatTier.FORCED;
        if (effectiveSize >= 3) return ThreatTier.STRONG;
        return ThreatTier.NORMAL;
    }

    // ── evaluation ──────────────────────────────────────────────────────

    evaluate(state: Game, aiPlayer: Player): number {
        const opponent: Player = aiPlayer === 0 ? 1 : 0;
        let score = 0;

        // Line strength (single analyzeLineGroup call per group)
        let aiForkLines = 0;
        for (const group of state.getLineGroups(aiPlayer)) {
            const info = analyzeLineGroup(group, state);
            score += this.lineScoreFromInfo(info);
            if (info.maxRun >= 3 && info.openEnds >= 1) aiForkLines++;
        }

        for (const group of state.getLineGroups(opponent)) {
            const info = analyzeLineGroup(group, state);
            score -= this.lineScoreFromInfo(info) * this.config.opponentBias;

            // Defense safety: penalize if opponent can create open 4
            if (info.maxRun >= 4 && info.openEnds >= 1) {
                score -= this.config.defensePenalty;
            }
        }

        // Fork potential: reward ≥ 2 independent threat lines
        if (aiForkLines >= 2) {
            score += this.config.forkBonus * (aiForkLines - 1);
        }

        // Positional clustering bonus (capped to first N stones to avoid O(n²) explosion;
        // early-placement bias is acceptable for this small bonus term)
        const aiPoints = state.getPlayerPoints(aiPlayer);
        if (aiPoints.length > 1) {
            const sampleSize = Math.min(aiPoints.length, CLUSTER_SAMPLE_SIZE);
            let totalDist = 0;
            let pairs = 0;
            for (let i = 0; i < sampleSize; i++) {
                for (let j = i + 1; j < sampleSize; j++) {
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

    private lineScoreFromInfo(info: LineInfo): number {
        if (info.maxRun >= 5) return WIN_SCORE;
        if (info.maxRun < 2) return 0;
        if (info.openEnds === 0) return 0; // dead line

        const weights: Record<number, number> = {
            2: this.config.lineWeight2,
            3: this.config.lineWeight3,
            4: this.config.lineWeight4,
        };
        const weight = weights[info.maxRun] ?? info.maxRun * 5;
        const openFactor = info.openEnds === 2 ? this.config.openFactor : 1.0;
        return weight * openFactor;
    }

    // ── quick heuristic for move ordering ───────────────────────────────

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

        // Small random noise for tie-breaking
        score += (Math.random() - 0.5) * 2;

        return score;
    }

    // ── candidate generation ────────────────────────────────────────────

    private generateCandidates(game: Game, player: Player, validate = true): Candidate[] {
        const opponent: Player = player === 0 ? 1 : 0;
        const candidateMap = new Map<string, Candidate>();

        // offensive extensions (own groups, size ≥ 2)
        this.addLineExtensions(game, game.getLineGroups(player), player, candidateMap, validate);

        // defensive blocks (opponent groups, size ≥ 2)
        this.addBlockingMoves(game, game.getLineGroups(opponent), player, candidateMap, validate);

        // tactical neighbors when too few candidates
        if (candidateMap.size < this.config.maxCandidates) {
            this.addTacticalNeighbors(game.getPlayerPoints(player), candidateMap);
        }

        const candidates = [...candidateMap.values()];
        return validate ? candidates.filter(c => game.isValidMove(c.x, c.y)) : candidates;
    }

    private addLineExtensions(game: Game, groups: ReadonlyArray<LineGroup>, player: Player, candidates: Map<string, Candidate>, classify: boolean): void {
        for (const group of groups) {
            if (group.stones.size < 2) continue;

            const minProj = group.projections[0]!;
            const maxProj = group.projections[group.projections.length - 1]!;
            const spacing = IDEAL_SPACING * SCALE;

            const ext1X = (group.originX + group.dirX * (minProj - spacing)) / SCALE;
            const ext1Y = (group.originY + group.dirY * (minProj - spacing)) / SCALE;
            const ext2X = (group.originX + group.dirX * (maxProj + spacing)) / SCALE;
            const ext2Y = (group.originY + group.dirY * (maxProj + spacing)) / SCALE;

            for (const [extX, extY] of [[ext1X, ext1Y], [ext2X, ext2Y]] as const) {
                const key = candidateKey(extX, extY);
                const existing = candidates.get(key);
                if (!existing || existing.reason === MoveReason.NEARBY_RANDOM) {
                    const tier = classify
                        ? this.classifyThreat(game, extX, extY, player)
                        : this.estimateTier(group.stones.size, true);
                    candidates.set(key, { x: extX, y: extY, reason: MoveReason.OFFENSIVE_EXTENSION, threatSize: group.stones.size, tier });
                }
            }
        }
    }

    private addBlockingMoves(game: Game, opponentGroups: ReadonlyArray<LineGroup>, aiPlayer: Player, candidates: Map<string, Candidate>, classify: boolean): void {
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

            for (const [extX, extY] of [[ext1X, ext1Y], [ext2X, ext2Y]] as const) {
                const key = candidateKey(extX, extY);
                const existing = candidates.get(key);
                if (!existing || this.reasonPriority(reason) > this.reasonPriority(existing.reason) || group.stones.size > existing.threatSize) {
                    const tier = classify
                        ? this.classifyThreat(game, extX, extY, aiPlayer)
                        : this.estimateTier(group.stones.size, false);
                    candidates.set(key, { x: extX, y: extY, reason, threatSize: group.stones.size, tier });
                }
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
                    candidates.set(key, { x, y, reason: MoveReason.OFFENSIVE_EXTENSION, threatSize: 0, tier: ThreatTier.NORMAL });
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

    // ── fallback / first-move helpers ───────────────────────────────────

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
