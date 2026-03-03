import { type AI, MoveReason, type ScoredMove, type DebugPhase, type InsaneAIConfig, DEFAULT_INSANE_CONFIG } from "./types.ts";
import { type Game, GameState, type Player, type Point, type LineGroup } from "../game.ts";
import { IDEAL_SPACING, SCALE, WIN_D_MAX } from "../consts.ts";
import type { MinimaxWorkerPool } from "./worker-pool.ts";

const WIN_SCORE = 100_000;
const CLUSTER_SAMPLE_SIZE = 8;

// ── Line analysis helpers (shared with hard.ts pattern) ─────────────────

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

// ── Threat intelligence ─────────────────────────────────────────────────

interface ThreatInfo {
    open4Count: number;
    open3Count: number;
    doubleThreatCount: number;
    forkPotential: number;
}

function computeThreatInfo(state: Game, player: Player): ThreatInfo {
    let open4Count = 0;
    let open3Count = 0;
    let forkPotential = 0;

    for (const group of state.getLineGroups(player)) {
        const info = analyzeLineGroup(group, state);
        if (info.maxRun >= 4 && info.openEnds >= 1) open4Count++;
        if (info.maxRun >= 3 && info.openEnds === 2) open3Count++;
        if (info.maxRun >= 3 && info.openEnds >= 1) forkPotential++;
    }

    const doubleThreatCount = open3Count >= 2 ? open3Count - 1 : 0;

    return { open4Count, open3Count, doubleThreatCount, forkPotential };
}

function threatScore(info: ThreatInfo, config: InsaneAIConfig): number {
    return config.threatOpen4 * info.open4Count
        + config.threatDoubleThreat * info.doubleThreatCount
        + config.threatOpen3 * info.open3Count
        + (info.forkPotential >= 2 ? config.forkBonus * (info.forkPotential - 1) : 0);
}

function isCriticalPosition(state: Game, player: Player): boolean {
    const opponent: Player = player === 0 ? 1 : 0;

    for (const group of state.getLineGroups(player)) {
        const info = analyzeLineGroup(group, state);
        if (info.maxRun >= 4 && info.openEnds >= 1) return true;
        if (info.maxRun >= 3 && info.openEnds >= 1) {
            let threatLines = 0;
            for (const g2 of state.getLineGroups(player)) {
                if (g2 !== group) {
                    const info2 = analyzeLineGroup(g2, state);
                    if (info2.maxRun >= 3 && info2.openEnds >= 1) threatLines++;
                }
            }
            if (threatLines >= 1) return true;
        }
    }

    for (const group of state.getLineGroups(opponent)) {
        const info = analyzeLineGroup(group, state);
        if (info.maxRun >= 4 && info.openEnds >= 1) return true;
    }

    return false;
}

// ── Candidate generation ────────────────────────────────────────────────

interface Candidate {
    x: number;
    y: number;
    reason: MoveReason;
    threatSize: number;
    heuristicScore: number;
}

function candidateKey(x: number, y: number): string {
    return `${Math.round(x * SCALE)},${Math.round(y * SCALE)}`;
}

function generateCandidates(game: Game, player: Player, limit: number, config: InsaneAIConfig): Candidate[] {
    const opponent: Player = player === 0 ? 1 : 0;
    const candidateMap = new Map<string, Candidate>();

    for (const group of game.getLineGroups(player)) {
        if (group.stones.size < 2) continue;
        addLineExtensionCandidates(group, candidateMap, config);
    }

    for (const group of game.getLineGroups(opponent)) {
        if (group.stones.size < 2) continue;
        addBlockingCandidates(group, candidateMap, config);
    }

    if (candidateMap.size < limit) {
        addTacticalNeighbors(game.getPlayerPoints(player), candidateMap);
    }

    const candidates = [...candidateMap.values()].filter(c => game.isValidMove(c.x, c.y));
    candidates.sort((a, b) => b.heuristicScore - a.heuristicScore);
    return candidates.slice(0, limit);
}

function addLineExtensionCandidates(
    group: LineGroup,
    candidates: Map<string, Candidate>, config: InsaneAIConfig,
): void {
    const minProj = group.projections[0]!;
    const maxProj = group.projections[group.projections.length - 1]!;
    const spacing = IDEAL_SPACING * SCALE;

    const extensions = [
        [(group.originX + group.dirX * (minProj - spacing)) / SCALE, (group.originY + group.dirY * (minProj - spacing)) / SCALE],
        [(group.originX + group.dirX * (maxProj + spacing)) / SCALE, (group.originY + group.dirY * (maxProj + spacing)) / SCALE],
    ] as const;

    for (const [extX, extY] of extensions) {
        const key = candidateKey(extX, extY);
        const existing = candidates.get(key);
        const size = group.stones.size;
        const score = computeCandidateHeuristic(size, true, config);
        if (!existing || score > existing.heuristicScore) {
            candidates.set(key, {
                x: extX, y: extY,
                reason: MoveReason.OFFENSIVE_EXTENSION,
                threatSize: size,
                heuristicScore: score,
            });
        }
    }
}

function addBlockingCandidates(
    group: LineGroup,
    candidates: Map<string, Candidate>, config: InsaneAIConfig,
): void {
    const minProj = group.projections[0]!;
    const maxProj = group.projections[group.projections.length - 1]!;
    const spacing = IDEAL_SPACING * SCALE;

    const extensions = [
        [(group.originX + group.dirX * (minProj - spacing)) / SCALE, (group.originY + group.dirY * (minProj - spacing)) / SCALE],
        [(group.originX + group.dirX * (maxProj + spacing)) / SCALE, (group.originY + group.dirY * (maxProj + spacing)) / SCALE],
    ] as const;

    const reason = group.stones.size >= 4 ? MoveReason.CRITICAL_BLOCK : MoveReason.DEFENSIVE_BLOCK;

    for (const [extX, extY] of extensions) {
        const key = candidateKey(extX, extY);
        const existing = candidates.get(key);
        const size = group.stones.size;
        const score = computeCandidateHeuristic(size, false, config);
        if (!existing || score > existing.heuristicScore) {
            candidates.set(key, {
                x: extX, y: extY,
                reason,
                threatSize: size,
                heuristicScore: score,
            });
        }
    }
}

function computeCandidateHeuristic(groupSize: number, isOffensive: boolean, config: InsaneAIConfig): number {
    const effectiveSize = isOffensive ? groupSize + 1 : groupSize;
    if (effectiveSize >= 5) return WIN_SCORE;
    if (effectiveSize >= 4) return config.threatOpen4;
    if (effectiveSize >= 3) return config.threatOpen3;
    return groupSize * 10;
}

function addTacticalNeighbors(playerPoints: Point[], candidates: Map<string, Candidate>): void {
    const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4];
    for (const stone of playerPoints) {
        for (const angle of angles) {
            const x = stone.x / SCALE + Math.cos(angle) * IDEAL_SPACING;
            const y = stone.y / SCALE + Math.sin(angle) * IDEAL_SPACING;
            const key = candidateKey(x, y);
            if (!candidates.has(key)) {
                candidates.set(key, {
                    x, y,
                    reason: MoveReason.OFFENSIVE_EXTENSION,
                    threatSize: 0,
                    heuristicScore: 1,
                });
            }
        }
    }
}

// ── MCTS Node ───────────────────────────────────────────────────────────

class MCTSNode {
    readonly move: Candidate | null;
    readonly player: Player;
    parent: MCTSNode | null;
    children: MCTSNode[] = [];
    visits = 0;
    totalReward = 0;
    isExpanded = false;

    constructor(move: Candidate | null, player: Player, parent: MCTSNode | null) {
        this.move = move;
        this.player = player;
        this.parent = parent;
    }

    get averageReward(): number {
        return this.visits === 0 ? 0 : this.totalReward / this.visits;
    }

    ucb1(explorationC: number): number {
        if (this.visits === 0) return Infinity;
        const parentVisits = this.parent?.visits ?? 1;
        return this.averageReward + explorationC * Math.sqrt(Math.log(parentVisits) / this.visits);
    }

    bestChild(explorationC: number): MCTSNode | null {
        let best: MCTSNode | null = null;
        let bestScore = -Infinity;
        for (const child of this.children) {
            const score = child.ucb1(explorationC);
            if (score > bestScore) {
                bestScore = score;
                best = child;
            }
        }
        return best;
    }
}

// ── Transposition Table ─────────────────────────────────────────────────

function stateHash(game: Game, player: Player): string {
    const pts = game.getPoints();
    const sorted = pts.map(p => `${p.x},${p.y},${p.player}`).sort();
    return `${player}:${sorted.join("|")}`;
}

// ── Killer Move Table ───────────────────────────────────────────────────

class KillerMoveTable {
    private table: Map<string, string[]> = new Map();

    record(player: Player, depth: number, move: Candidate): void {
        const key = `${player},${depth}`;
        let moves = this.table.get(key);
        if (!moves) {
            moves = [];
            this.table.set(key, moves);
        }
        const moveKey = candidateKey(move.x, move.y);
        if (!moves.includes(moveKey)) {
            if (moves.length >= 2) moves.shift();
            moves.push(moveKey);
        }
    }

    isKiller(player: Player, depth: number, move: Candidate): boolean {
        const key = `${player},${depth}`;
        const moves = this.table.get(key);
        if (!moves) return false;
        return moves.includes(candidateKey(move.x, move.y));
    }

    clear(): void {
        this.table.clear();
    }
}

// ── InsaneAI ────────────────────────────────────────────────────────────

const REASON_COLORS: Record<MoveReason, string> = {
    [MoveReason.CRITICAL_BLOCK]: "#ff0000",
    [MoveReason.DEFENSIVE_BLOCK]: "#ff8800",
    [MoveReason.OFFENSIVE_EXTENSION]: "#00cc00",
    [MoveReason.NEARBY_RANDOM]: "#0088ff",
    [MoveReason.FALLBACK]: "#888888",
};

export class InsaneAI implements AI {
    private debugPhases: DebugPhase[] = [];
    private killerTable = new KillerMoveTable();
    private transpositionTable = new Map<string, number>();
    readonly config: InsaneAIConfig;
    private workerPool?: MinimaxWorkerPool;

    constructor(config?: Partial<InsaneAIConfig>, workerPool?: MinimaxWorkerPool) {
        this.config = { ...DEFAULT_INSANE_CONFIG, ...config } as InsaneAIConfig;
        this.workerPool = workerPool;
    }

    getLastDebugPhases(): DebugPhase[] {
        return this.debugPhases;
    }

    // ── single candidate evaluation (used by workers) ───────────────────

    evaluateCandidate(
        game: Game,
        candidate: { x: number; y: number },
        player: Player,
    ): { score: number; immediateWin: boolean } {
        this.transpositionTable.clear();

        const child = game.clone();
        if (!child.addMove(candidate.x, candidate.y, player)) {
            return { score: -Infinity, immediateWin: false };
        }

        const aiWin = player === 0 ? GameState.WIN_0 : GameState.WIN_1;
        if (child.getState() === aiWin) {
            return { score: WIN_SCORE, immediateWin: true };
        }

        // Root parallelization: run focused MCTS for this one candidate
        const iterationsPerCandidate = Math.floor(this.config.maxIterations / this.config.rootCandidateLimit);
        const reward = this.runMCTS(child, player, aiWin, iterationsPerCandidate, 200);
        return { score: reward * WIN_SCORE, immediateWin: false };
    }

    // ── main move selection ─────────────────────────────────────────────

    async getMove(game: Game, player: Player): Promise<ScoredMove> {
        this.debugPhases = [];
        this.transpositionTable.clear();
        const opponent: Player = player === 0 ? 1 : 0;
        const aiPoints = game.getPlayerPoints(player);
        const opponentPoints = game.getPlayerPoints(opponent);

        // Special case: AI has no stones yet
        if (aiPoints.length === 0) {
            const move = this.firstMove(game, opponentPoints);
            return { ...move, score: 0, reason: MoveReason.FALLBACK };
        }

        // Generate root candidates
        const rootCandidates = generateCandidates(game, player, this.config.rootCandidateLimit, this.config);

        if (rootCandidates.length === 0) {
            const move = this.fallbackMove(game, aiPoints, opponentPoints);
            return { ...move, score: 0, reason: MoveReason.FALLBACK };
        }

        // Check for immediate win
        const aiWin = player === 0 ? GameState.WIN_0 : GameState.WIN_1;
        for (const cand of rootCandidates) {
            const child = game.clone();
            if (child.addMove(cand.x, cand.y, player) && child.getState() === aiWin) {
                this.debugPhases.push({
                    title: "Immediate Win",
                    description: `Win at (${cand.x.toFixed(1)}, ${cand.y.toFixed(1)})`,
                    markers: [{ x: cand.x, y: cand.y, color: "#ffff00", label: "★ WIN", radius: 10 }],
                    lines: [],
                });
                return { x: cand.x, y: cand.y, score: WIN_SCORE, reason: cand.reason };
            }
        }

        // Debug phase 1: Root candidates
        this.debugPhases.push({
            title: "Root Candidates",
            description: `${rootCandidates.length} candidates for MCTS`,
            markers: rootCandidates.map((c, i) => ({
                x: c.x, y: c.y,
                color: REASON_COLORS[c.reason],
                label: `#${i + 1} h=${c.heuristicScore.toFixed(0)}`,
                radius: 4,
            })),
            lines: [],
        });

        // Evaluate candidates (parallel via workers, or sequential MCTS)
        let bestMove: Candidate | null = null;
        let bestScore = -Infinity;
        const evalResults: Array<{ candidate: Candidate; score: number; detail: string }> = [];

        if (this.workerPool && rootCandidates.length > 1) {
            // ── Parallel evaluation via worker pool ──────────────────────
            const gamePoints = game.getPoints().map(p => ({ x: p.x, y: p.y, player: p.player }));
            const candidatePositions = rootCandidates.map(c => ({ x: c.x, y: c.y }));
            const results = await this.workerPool.evaluateCandidates(gamePoints, candidatePositions, player);

            for (let i = 0; i < results.length; i++) {
                const r = results[i]!;
                const candidate = rootCandidates[i]!;
                evalResults.push({ candidate, score: r.score, detail: `s=${r.score.toFixed(0)}` });
                if (r.score > bestScore) {
                    bestScore = r.score;
                    bestMove = candidate;
                }
            }
        } else {
            // ── Sequential: full MCTS tree over all candidates ──────────
            const mctsResult = this.runFullMCTS(game, player, aiWin, rootCandidates);
            for (const r of mctsResult) {
                evalResults.push(r);
                if (r.score > bestScore) {
                    bestScore = r.score;
                    bestMove = r.candidate;
                }
            }
        }

        // Debug phase 2: Evaluation results
        this.debugPhases.push({
            title: "MCTS Evaluation",
            description: `Evaluated ${evalResults.length} moves, best=${bestScore.toFixed(0)}`,
            markers: evalResults.map(({ candidate: c, score, detail }) => ({
                x: c.x, y: c.y,
                color: c === bestMove ? "#ffff00" : REASON_COLORS[c.reason],
                label: detail,
                radius: c === bestMove ? 8 : 5,
            })),
            lines: [],
        });

        if (!bestMove) {
            const move = this.fallbackMove(game, aiPoints, opponentPoints);
            return { ...move, score: 0, reason: MoveReason.FALLBACK };
        }

        // Debug phase 3: Selected move
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

    // ── Full MCTS tree (sequential, no workers) ─────────────────────────

    private runFullMCTS(
        game: Game, aiPlayer: Player, aiWin: GameState,
        rootCandidates: Candidate[],
    ): Array<{ candidate: Candidate; score: number; detail: string }> {
        const opponent: Player = aiPlayer === 0 ? 1 : 0;
        const root = new MCTSNode(null, opponent, null);
        this.expandNodeWith(root, rootCandidates, aiPlayer);

        const maxIter = this.config.maxIterations;
        const timeLimit = 350;
        const startTime = performance.now();

        for (let i = 0; i < maxIter; i++) {
            if (i > 0 && i % 1000 === 0 && performance.now() - startTime > timeLimit) break;

            // Selection
            let node = root;
            const clonedGame = game.clone();

            while (node.isExpanded && node.children.length > 0) {
                const child = node.bestChild(this.config.explorationC);
                if (!child || !child.move) break;
                clonedGame.addMove(child.move.x, child.move.y, child.player);
                node = child;
            }

            // Terminal check
            const gs = clonedGame.getState();
            if (gs !== GameState.ONGOING) {
                this.backpropagate(node, gs === aiWin ? 1.0 : -1.0);
                continue;
            }

            // Expansion
            if (!node.isExpanded) {
                const nextPlayer: Player = node.player === 0 ? 1 : 0;
                const candidates = generateCandidates(clonedGame, nextPlayer, this.config.internalCandidateLimit, this.config);
                this.expandNodeWith(node, candidates, nextPlayer);
            }

            // Select child for simulation
            let simNode = node;
            if (node.children.length > 0) {
                const unvisited = node.children.filter(c => c.visits === 0);
                if (unvisited.length > 0) {
                    simNode = unvisited[0]!;
                } else {
                    simNode = node.bestChild(this.config.explorationC) ?? node;
                }
                if (simNode.move) {
                    clonedGame.addMove(simNode.move.x, simNode.move.y, simNode.player);
                }
            }

            // Guided rollout
            const reward = this.guidedRollout(clonedGame, aiPlayer, aiWin, simNode.player);

            // Backpropagation
            this.backpropagate(simNode, reward);
        }

        // Collect results from root children
        const results: Array<{ candidate: Candidate; score: number; detail: string }> = [];
        for (const child of root.children) {
            if (child.move) {
                const score = child.averageReward * WIN_SCORE;
                results.push({
                    candidate: child.move,
                    score,
                    detail: `v=${child.visits} r=${child.averageReward.toFixed(2)}`,
                });
            }
        }
        return results;
    }

    // ── Focused MCTS (for worker-based per-candidate evaluation) ────────

    private runMCTS(
        game: Game, aiPlayer: Player, aiWin: GameState,
        maxIterations: number, timeLimitMs: number,
    ): number {
        const opponent: Player = aiPlayer === 0 ? 1 : 0;
        const root = new MCTSNode(null, opponent, null);

        const startTime = performance.now();

        for (let i = 0; i < maxIterations; i++) {
            if (i > 0 && i % 500 === 0 && performance.now() - startTime > timeLimitMs) break;

            let node = root;
            const clonedGame = game.clone();

            // Selection
            while (node.isExpanded && node.children.length > 0) {
                const child = node.bestChild(this.config.explorationC);
                if (!child || !child.move) break;
                clonedGame.addMove(child.move.x, child.move.y, child.player);
                node = child;
            }

            const gs = clonedGame.getState();
            if (gs !== GameState.ONGOING) {
                this.backpropagate(node, gs === aiWin ? 1.0 : -1.0);
                continue;
            }

            // Expansion
            if (!node.isExpanded) {
                const nextPlayer: Player = node.player === 0 ? 1 : 0;
                const candidates = generateCandidates(clonedGame, nextPlayer, this.config.internalCandidateLimit, this.config);
                this.expandNodeWith(node, candidates, nextPlayer);
            }

            let simNode = node;
            if (node.children.length > 0) {
                const unvisited = node.children.filter(c => c.visits === 0);
                if (unvisited.length > 0) {
                    simNode = unvisited[0]!;
                } else {
                    simNode = node.bestChild(this.config.explorationC) ?? node;
                }
                if (simNode.move) {
                    clonedGame.addMove(simNode.move.x, simNode.move.y, simNode.player);
                }
            }

            const reward = this.guidedRollout(clonedGame, aiPlayer, aiWin, simNode.player);
            this.backpropagate(simNode, reward);
        }

        return root.visits === 0 ? 0 : root.totalReward / root.visits;
    }

    // ── MCTS helpers ────────────────────────────────────────────────────

    private expandNodeWith(node: MCTSNode, candidates: Candidate[], nextPlayer: Player): void {
        const sorted = candidates.slice().sort((a, b) => {
            const aKiller = this.killerTable.isKiller(nextPlayer, node.children.length, a) ? 1 : 0;
            const bKiller = this.killerTable.isKiller(nextPlayer, node.children.length, b) ? 1 : 0;
            if (aKiller !== bKiller) return bKiller - aKiller;
            return b.heuristicScore - a.heuristicScore;
        });

        for (const cand of sorted) {
            const child = new MCTSNode(cand, nextPlayer, node);
            node.children.push(child);
        }
        node.isExpanded = true;
    }

    private backpropagate(node: MCTSNode, reward: number): void {
        let current: MCTSNode | null = node;
        while (current !== null) {
            current.visits++;
            current.totalReward += reward;
            current = current.parent;
        }

        if (reward > 0.5 && node.move) {
            const depth = this.getNodeDepth(node);
            this.killerTable.record(node.player, depth, node.move);
        }
    }

    private getNodeDepth(node: MCTSNode): number {
        let depth = 0;
        let current: MCTSNode | null = node;
        while (current?.parent) {
            depth++;
            current = current.parent;
        }
        return depth;
    }

    // ── Guided Rollout ──────────────────────────────────────────────────

    private guidedRollout(game: Game, aiPlayer: Player, aiWin: GameState, lastPlayer: Player): number {
        const rolloutGame = game.clone();
        let currentPlayer: Player = lastPlayer === 0 ? 1 : 0;
        let depth = this.config.rolloutDepth;

        // Selective deepening for critical positions
        if (isCriticalPosition(rolloutGame, aiPlayer) || isCriticalPosition(rolloutGame, aiPlayer === 0 ? 1 : 0)) {
            depth = Math.min(depth + this.config.depthExtension, this.config.maxSearchDepth);
        }

        for (let d = 0; d < depth; d++) {
            const gs = rolloutGame.getState();
            if (gs !== GameState.ONGOING) {
                return gs === aiWin ? 1.0 : -1.0;
            }

            const candidates = generateCandidates(rolloutGame, currentPlayer, this.config.internalCandidateLimit, this.config);
            if (candidates.length === 0) break;

            // Softmax selection over top 2 candidates
            const topN = Math.min(2, candidates.length);
            const topCandidates = candidates.slice(0, topN);
            const selected = this.softmaxSelect(topCandidates);

            if (!rolloutGame.addMove(selected.x, selected.y, currentPlayer)) {
                let placed = false;
                for (const alt of candidates) {
                    if (alt === selected) continue;
                    if (rolloutGame.addMove(alt.x, alt.y, currentPlayer)) {
                        placed = true;
                        break;
                    }
                }
                if (!placed) break;
            }

            currentPlayer = currentPlayer === 0 ? 1 : 0;
        }

        // Terminal evaluation
        const gs = rolloutGame.getState();
        if (gs === aiWin) return 1.0;
        if (gs !== GameState.ONGOING) return -1.0;

        // Heuristic evaluation with transposition caching
        const hash = stateHash(rolloutGame, aiPlayer);
        const cached = this.transpositionTable.get(hash);
        if (cached !== undefined) return cached;

        const evalScore = this.evaluate(rolloutGame, aiPlayer);
        const normalized = Math.max(-1, Math.min(1, evalScore / WIN_SCORE));
        this.transpositionTable.set(hash, normalized);
        return normalized;
    }

    private softmaxSelect(candidates: Candidate[]): Candidate {
        if (candidates.length === 1) return candidates[0]!;

        const temp = this.config.rolloutTemperature;
        const scores = candidates.map(c => c.heuristicScore);
        const maxScore = Math.max(...scores);

        const exps = scores.map(s => Math.exp((s - maxScore) / Math.max(temp, 0.01)));
        const sumExp = exps.reduce((a, b) => a + b, 0);

        const r = Math.random() * sumExp;
        let cumulative = 0;
        for (let i = 0; i < candidates.length; i++) {
            cumulative += exps[i]!;
            if (r <= cumulative) return candidates[i]!;
        }
        return candidates[candidates.length - 1]!;
    }

    // ── Position evaluation ─────────────────────────────────────────────

    private evaluate(state: Game, aiPlayer: Player): number {
        const opponent: Player = aiPlayer === 0 ? 1 : 0;
        let score = 0;

        const aiThreat = computeThreatInfo(state, aiPlayer);
        score += threatScore(aiThreat, this.config);

        const oppThreat = computeThreatInfo(state, opponent);
        score -= threatScore(oppThreat, this.config) * this.config.opponentBias;

        for (const group of state.getLineGroups(aiPlayer)) {
            const info = analyzeLineGroup(group, state);
            score += this.lineScoreFromInfo(info);
        }
        for (const group of state.getLineGroups(opponent)) {
            const info = analyzeLineGroup(group, state);
            score -= this.lineScoreFromInfo(info) * this.config.opponentBias;
            if (info.maxRun >= 4 && info.openEnds >= 1) {
                score -= this.config.defensePenalty;
            }
        }

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
        if (info.openEnds === 0) return 0;

        const weights: Record<number, number> = {
            2: this.config.lineWeight2,
            3: this.config.lineWeight3,
            4: this.config.lineWeight4,
        };
        const weight = weights[info.maxRun] ?? info.maxRun * 5;
        const openFactor = info.openEnds === 2 ? this.config.openFactor : 1.0;
        return weight * openFactor;
    }

    // ── Fallback / first-move helpers ───────────────────────────────────

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
