import { type AI, MoveReason, type ScoredMove, type DebugPhase, type InsaneAIConfig, normalizeInsaneConfig } from "./types.ts";
import { type Game, GameState, type Player, type Point, type LineGroup } from "../game.ts";
import { IDEAL_SPACING, SCALE, WIN_D_MAX } from "../consts.ts";
import type { MCTSWorkerPool } from "./worker-pool.ts";
import { type RandomSource, randomIndex, SYSTEM_RANDOM } from "./random.ts";
import { aggregateMCTSReports, type MCTSRootStat, type MCTSSearchReport, ucb1Score } from "./mcts-result.ts";
import { HardAI } from "./hard.ts";

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

    // Check for open-4 threats (either side)
    for (const group of state.getLineGroups(player)) {
        const info = analyzeLineGroup(group, state);
        if (info.maxRun >= 4 && info.openEnds >= 1) return true;
    }
    for (const group of state.getLineGroups(opponent)) {
        const info = analyzeLineGroup(group, state);
        if (info.maxRun >= 4 && info.openEnds >= 1) return true;
    }

    // Check for multi-line fork: two or more open-3 lines
    let open3Count = 0;
    for (const group of state.getLineGroups(player)) {
        const info = analyzeLineGroup(group, state);
        if (info.maxRun >= 3 && info.openEnds >= 1) open3Count++;
        if (open3Count >= 2) return true;
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

function immediateWinningCandidates(
    game: Game,
    player: Player,
    limit: number,
    config: InsaneAIConfig,
): Candidate[] {
    const win = player === 0 ? GameState.WIN_0 : GameState.WIN_1;
    return generateCandidates(game, player, limit, config).filter(candidate => {
        const child = game.clone();
        return !!child.addMove(candidate.x, candidate.y, player) && child.getState() === win;
    });
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

    ucb1(explorationC: number, maximizing: boolean): number {
        return ucb1Score(this.averageReward, this.visits, this.parent?.visits ?? 1, explorationC, maximizing);
    }

    bestChild(explorationC: number, maximizing: boolean): MCTSNode | null {
        let best: MCTSNode | null = null;
        let bestScore = -Infinity;
        for (const child of this.children) {
            const score = child.ucb1(explorationC, maximizing);
            if (score > bestScore) {
                bestScore = score;
                best = child;
            }
        }
        return best;
    }
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
    readonly config: InsaneAIConfig;
    private workerPool?: MCTSWorkerPool;
    private readonly random: RandomSource;

    constructor(config?: Partial<InsaneAIConfig>, workerPool?: MCTSWorkerPool, random: RandomSource = SYSTEM_RANDOM) {
        this.config = normalizeInsaneConfig(config);
        this.workerPool = workerPool;
        this.random = random;
    }

    getLastDebugPhases(): DebugPhase[] {
        return this.debugPhases;
    }

    // ── main move selection ─────────────────────────────────────────────

    async getMove(game: Game, player: Player): Promise<ScoredMove> {
        // Delegate entire MCTS search to worker pool (root parallelization)
        if (this.workerPool) {
            const gamePoints = game.getPoints().map(p => ({ x: p.x, y: p.y, player: p.player }));
            const result = await this.workerPool.search(gamePoints, player);
            this.debugPhases = this.withSelectedPhase(result.debugPhases, result);
            return result;
        }

        const result = aggregateMCTSReports([this.searchRoot(game, player)]);
        this.debugPhases = this.withSelectedPhase(result.debugPhases, result);
        return result;
    }

    /** Run one independent root tree. Workers return this report for aggregation. */
    searchRoot(game: Game, player: Player): MCTSSearchReport {
        const searchStarted = performance.now();
        const debugPhases: DebugPhase[] = [];
        this.killerTable.clear();
        const opponent: Player = player === 0 ? 1 : 0;
        const aiPoints = game.getPlayerPoints(player);
        const opponentPoints = game.getPlayerPoints(opponent);

        // Special case: AI has no stones yet
        if (aiPoints.length === 0) {
            const move = this.firstMove(game, opponentPoints);
            return {
                kind: "fallback",
                rootStats: [{ ...move, reason: MoveReason.FALLBACK, visits: 1, totalReward: 0 }],
                debugPhases,
            };
        }

        // Generate root candidates
        let rootCandidates = generateCandidates(game, player, this.config.rootCandidateLimit, this.config);

        if (rootCandidates.length === 0) {
            const move = this.fallbackMove(game, aiPoints, opponentPoints);
            return {
                kind: "fallback",
                rootStats: [{ ...move, reason: MoveReason.FALLBACK, visits: 1, totalReward: 0 }],
                debugPhases,
            };
        }

        // Check for immediate win
        const aiWin = player === 0 ? GameState.WIN_0 : GameState.WIN_1;
        for (const cand of rootCandidates) {
            const child = game.clone();
            if (child.addMove(cand.x, cand.y, player) && child.getState() === aiWin) {
                debugPhases.push({
                    title: "Immediate Win",
                    description: `Win at (${cand.x.toFixed(1)}, ${cand.y.toFixed(1)})`,
                    markers: [{ x: cand.x, y: cand.y, color: "#ffff00", label: "★ WIN", radius: 10 }],
                    lines: [],
                });
                return {
                    kind: "immediate_win",
                    rootStats: [{ x: cand.x, y: cand.y, reason: cand.reason, visits: 1, totalReward: 1 }],
                    debugPhases,
                };
            }
        }

        // A unique loss in one is not a statistical decision. Resolve it before
        // spending the MCTS budget so Insane remains tactically reliable.
        const immediateThreatKeys = new Set(
            immediateWinningCandidates(game, opponent, this.config.rootCandidateLimit, this.config)
                .map(candidate => candidateKey(candidate.x, candidate.y)),
        );
        const forcedBlock = rootCandidates.find(cand => immediateThreatKeys.has(candidateKey(cand.x, cand.y)));
        if (forcedBlock) {
            debugPhases.push({
                title: "Forced Block",
                description: `Prevent immediate loss at (${forcedBlock.x.toFixed(1)}, ${forcedBlock.y.toFixed(1)})`,
                markers: [{ x: forcedBlock.x, y: forcedBlock.y, color: "#ff0000", label: "★ BLOCK", radius: 10 }],
                lines: [],
            });
            return {
                kind: "forced_move",
                rootStats: [{ x: forcedBlock.x, y: forcedBlock.y, reason: MoveReason.CRITICAL_BLOCK, visits: 1, totalReward: 0.5 }],
                debugPhases,
            };
        }

        // Do not spend stochastic search budget on a root move that permits a
        // deterministic win on the opponent's next turn.
        const safeCandidates = rootCandidates.filter(candidate => {
            const child = game.clone();
            if (!child.addMove(candidate.x, candidate.y, player)) return false;
            return immediateWinningCandidates(child, opponent, this.config.rootCandidateLimit, this.config).length === 0;
        });
        if (safeCandidates.length > 0) rootCandidates = safeCandidates;

        // Debug phase 1: Root candidates
        debugPhases.push({
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

        const priorRewards = new Map<string, number>();
        if (this.config.minimaxPriorVisits > 0) {
            const oracle = new HardAI({
                baseDepth: this.config.minimaxPriorDepth,
                maxDepth: this.config.minimaxPriorDepth,
                maxCandidates: this.config.internalCandidateLimit,
            }, undefined, this.random);
            for (const candidate of rootCandidates) {
                const result = oracle.evaluateCandidate(game, candidate, player, this.config.minimaxPriorDepth);
                priorRewards.set(candidateKey(candidate.x, candidate.y), Math.tanh(result.score / this.config.evaluationScale));
            }
        }

        const deadline = this.config.searchTimeMs > 0 ? searchStarted + this.config.searchTimeMs : undefined;
        const rootStats = this.runFullMCTS(game, player, aiWin, rootCandidates, priorRewards, deadline);
        const best = rootStats.reduce<MCTSRootStat | undefined>((current, stat) => {
            if (!current || stat.visits > current.visits) return stat;
            if (stat.visits === current.visits) {
                const mean = stat.visits === 0 ? -Infinity : stat.totalReward / stat.visits;
                const currentMean = current.visits === 0 ? -Infinity : current.totalReward / current.visits;
                if (mean > currentMean) return stat;
            }
            return current;
        }, undefined);

        // Debug phase 2: Evaluation results
        debugPhases.push({
            title: "MCTS Evaluation",
            description: `Evaluated ${rootStats.length} root moves; robust child has ${best?.visits ?? 0} visits`,
            markers: rootStats.map(stat => ({
                x: stat.x, y: stat.y,
                color: stat === best ? "#ffff00" : REASON_COLORS[stat.reason],
                label: `v=${stat.visits} r=${(stat.visits === 0 ? 0 : stat.totalReward / stat.visits).toFixed(2)}`,
                radius: stat === best ? 8 : 5,
            })),
            lines: [],
        });

        if (!best) {
            const move = this.fallbackMove(game, aiPoints, opponentPoints);
            return {
                kind: "fallback",
                rootStats: [{ ...move, reason: MoveReason.FALLBACK, visits: 1, totalReward: 0 }],
                debugPhases,
            };
        }

        return { kind: "search", rootStats, debugPhases };
    }

    private withSelectedPhase(debugPhases: DebugPhase[], move: ScoredMove): DebugPhase[] {
        return [...debugPhases, {
            title: "Selected Move",
            description: `(${move.x.toFixed(1)}, ${move.y.toFixed(1)}) score=${move.score.toFixed(0)} reason=${move.reason}`,
            markers: [{
                x: move.x, y: move.y,
                color: "#ffff00",
                label: `★ ${move.score.toFixed(0)}`,
                radius: 10,
            }],
            lines: [],
        }];
    }

    // ── Full MCTS tree (sequential, no workers) ─────────────────────────

    private runFullMCTS(
        game: Game, aiPlayer: Player, aiWin: GameState,
        rootCandidates: Candidate[],
        priorRewards: ReadonlyMap<string, number>,
        deadline?: number,
    ): MCTSRootStat[] {
        const opponent: Player = aiPlayer === 0 ? 1 : 0;
        const root = new MCTSNode(null, opponent, null);
        this.expandNodeWith(root, rootCandidates, aiPlayer);

        for (const child of root.children) {
            if (!child.move) continue;
            const priorReward = priorRewards.get(candidateKey(child.move.x, child.move.y));
            if (priorReward === undefined) continue;
            child.visits = this.config.minimaxPriorVisits;
            child.totalReward = priorReward * child.visits;
            root.visits += child.visits;
            root.totalReward += child.totalReward;
        }

        const maxIter = this.config.maxIterations;

        for (let i = 0; i < maxIter; i++) {
            if (deadline !== undefined && i > 0 && i % 32 === 0 && performance.now() >= deadline) break;

            // Selection
            let node = root;
            const clonedGame = game.clone();

            while (node.isExpanded && node.children.length > 0) {
                const child = node.bestChild(this.config.explorationC, node.children[0]!.player === aiPlayer);
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
                let firstUnvisited: MCTSNode | null = null;
                for (const child of node.children) {
                    if (child.visits === 0) { firstUnvisited = child; break; }
                }
                if (firstUnvisited) {
                    simNode = firstUnvisited;
                } else {
                    simNode = node.bestChild(this.config.explorationC, node.children[0]!.player === aiPlayer) ?? node;
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
        const results: MCTSRootStat[] = [];
        for (const child of root.children) {
            if (child.move) {
                results.push({
                    x: child.move.x,
                    y: child.move.y,
                    reason: child.move.reason,
                    visits: child.visits,
                    totalReward: child.totalReward,
                });
            }
        }
        return results;
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
        // The caller creates a fresh simulation state for every iteration, so the
        // rollout can own and mutate it instead of paying for a second deep clone.
        const rolloutGame = game;
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

        // Heuristic evaluation
        const evalScore = this.evaluate(rolloutGame, aiPlayer);
        return Math.tanh(evalScore / this.config.evaluationScale);
    }

    private softmaxSelect(candidates: Candidate[]): Candidate {
        if (candidates.length === 1) return candidates[0]!;

        const temp = this.config.rolloutTemperature;
        const scores = candidates.map(c => c.heuristicScore);
        const maxScore = Math.max(...scores);

        const exps = scores.map(s => Math.exp((s - maxScore) / Math.max(temp, 0.01)));
        const sumExp = exps.reduce((a, b) => a + b, 0);

        if (sumExp <= 0) return candidates[0]!;

        const r = this.random.next() * sumExp;
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
            if (pairs > 0) {
                score += this.config.clusteringWeight * Math.exp(-(totalDist / pairs) / this.config.clusteringDecay);
            }
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
            const target = allPoints[randomIndex(allPoints.length, this.random)]!;
            const angle = this.random.next() * Math.PI * 2;
            const dist = IDEAL_SPACING + this.random.next() * 15;
            const x = target.x / SCALE + Math.cos(angle) * dist;
            const y = target.y / SCALE + Math.sin(angle) * dist;
            if (game.isValidMove(x, y)) return { x, y };
        }

        const center = allPoints[0]!;
        return { x: center.x / SCALE + IDEAL_SPACING, y: center.y / SCALE };
    }
}
