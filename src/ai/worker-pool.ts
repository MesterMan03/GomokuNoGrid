import type { GameUpdate } from "./evolution.ts";
import { aggregateMCTSReports, type AggregatedMCTSResult, type MCTSSearchReport } from "./mcts-result.ts";
import { WorkerRpcClient } from "./worker-rpc.ts";

const MAX_WORKERS = 8;

function resolveWorkerCount(requested?: number): number {
    const hardware = navigator.hardwareConcurrency || 4;
    const count = requested ?? Math.max(1, hardware - 1);
    return Math.max(1, Math.min(MAX_WORKERS, Math.floor(count)));
}

// ── Minimax Worker Pool ─────────────────────────────────────────────────

export interface CandidateResult {
    score: number;
    immediateWin: boolean;
}

export interface CandidateTask {
    x: number;
    y: number;
    /** Optional root depth override used to preserve HardAI's selective extension. */
    searchDepth?: number;
}

/**
 * Pool of Web Workers for parallel minimax candidate evaluation.
 * Used by MediumAI during gameplay to evaluate root candidates simultaneously.
 */
export class MinimaxWorkerPool {
    private workers: WorkerRpcClient[];

    constructor(difficulty: string, config: Record<string, number>, numWorkers?: number) {
        const count = resolveWorkerCount(numWorkers);
        this.workers = [];
        for (let i = 0; i < count; i++) {
            const w = new Worker(
                new URL("../minimax.worker.js", import.meta.url),
                { type: "module" },
            );
            const client = new WorkerRpcClient(w);
            client.post({ type: "init", difficulty, config });
            this.workers.push(client);
        }
    }

    updateConfig(difficulty: string, config: Record<string, number>): void {
        for (const w of this.workers) {
            w.post({ type: "init", difficulty, config });
        }
    }

    async evaluateCandidates(
        gamePoints: Array<{ x: number; y: number; player: 0 | 1 }>,
        candidates: CandidateTask[],
        player: 0 | 1,
    ): Promise<CandidateResult[]> {
        if (candidates.length === 0) return [];
        if (this.workers.length === 0) {
            throw new Error("No minimax workers available");
        }

        const results = new Array<CandidateResult>(candidates.length);
        const promises: Promise<void>[] = [];

        for (let i = 0; i < candidates.length; i++) {
            const workerIndex = i % this.workers.length;
            promises.push(
                this.evaluateOne(this.workers[workerIndex]!, gamePoints, candidates[i]!, player)
                    .then(r => { results[i] = r; }),
            );
        }

        await Promise.all(promises);
        return results;
    }

    private evaluateOne(
        worker: WorkerRpcClient,
        points: Array<{ x: number; y: number; player: 0 | 1 }>,
        candidate: CandidateTask,
        player: 0 | 1,
    ): Promise<CandidateResult> {
        return worker.request<{ score: number; immediateWin: boolean }>({
            type: "evaluate",
            points,
            candidate,
            player,
            searchDepth: candidate.searchDepth,
        }).then(data => ({ score: data.score, immediateWin: data.immediateWin }));
    }

    terminate(): void {
        for (const w of this.workers) w.terminate();
        this.workers = [];
    }
}

// ── MCTS Worker Pool ────────────────────────────────────────────────────

export type MCTSResult = AggregatedMCTSResult;

/**
 * Pool of Web Workers for MCTS-based search.
 * Uses root parallelization: all workers independently search the same position,
 * then root visits and rewards are merged before selecting the robust child.
 */
export class MCTSWorkerPool {
    private workers: WorkerRpcClient[];

    constructor(config: Record<string, number>, numWorkers?: number) {
        const count = resolveWorkerCount(numWorkers);
        const requestTimeoutMs = Math.max(2_000, (config["searchTimeMs"] ?? 350) * 4);
        this.workers = [];
        for (let i = 0; i < count; i++) {
            const w = new Worker(
                new URL("../mcts.worker.js", import.meta.url),
                { type: "module" },
            );
            const client = new WorkerRpcClient(w, requestTimeoutMs);
            client.post({ type: "init", config });
            this.workers.push(client);
        }
    }

    async search(
        gamePoints: Array<{ x: number; y: number; player: 0 | 1 }>,
        player: 0 | 1,
    ): Promise<MCTSResult> {
        if (this.workers.length === 0) {
            throw new Error("No MCTS workers available");
        }

        // Root parallelization: all workers search the same position independently
        const promises = this.workers.map(worker => this.searchOne(worker, gamePoints, player));
        const settled = await Promise.allSettled(promises);
        const reports = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
        if (reports.length === 0) {
            const firstFailure = settled.find(result => result.status === "rejected") as PromiseRejectedResult | undefined;
            throw firstFailure?.reason instanceof Error ? firstFailure.reason : new Error("All MCTS workers failed");
        }
        return aggregateMCTSReports(reports);
    }

    private searchOne(
        worker: WorkerRpcClient,
        points: Array<{ x: number; y: number; player: 0 | 1 }>,
        player: 0 | 1,
    ): Promise<MCTSSearchReport> {
        return worker.request<{ report: MCTSSearchReport }>({ type: "search", points, player })
            .then(data => data.report);
    }

    terminate(): void {
        for (const w of this.workers) w.terminate();
        this.workers = [];
    }
}

// ── Match Worker Pool ───────────────────────────────────────────────────

export interface MatchTask {
    id: number;
    difficulty: string;
    candidateConfig: Record<string, number>;
    baselineConfig: Record<string, number>;
    maxMoves: number;
    candidateIsPlayer0: boolean;
    individualIndex: number;
    gen: number;
    sendUpdates: boolean;
}

export interface MatchResult {
    id: number;
    fitness: number;
}

/**
 * Pool of Web Workers for parallel match execution during training.
 * Each worker plays one match at a time; tasks are distributed round-robin.
 */
export class MatchWorkerPool {
    private workers: Worker[];

    constructor(numWorkers?: number) {
        const count = resolveWorkerCount(numWorkers);
        this.workers = [];
        for (let i = 0; i < count; i++) {
            this.workers.push(
                new Worker(
                    new URL("../match.worker.js", import.meta.url),
                    { type: "module" },
                ),
            );
        }
    }

    async runMatches(
        tasks: MatchTask[],
        onGameUpdate?: (update: GameUpdate) => void,
    ): Promise<MatchResult[]> {
        if (tasks.length === 0) return [];
        if (this.workers.length === 0) throw new Error("No match workers available");

        // Distribute tasks across workers (round-robin)
        const workerBatches: MatchTask[][] = this.workers.map(() => []);
        for (let i = 0; i < tasks.length; i++) {
            workerBatches[i % this.workers.length]!.push(tasks[i]!);
        }

        const batchPromises = this.workers.map((worker, idx) =>
            this.runWorkerBatch(worker, workerBatches[idx]!, onGameUpdate),
        );

        const allResults = await Promise.all(batchPromises);
        return allResults.flat();
    }

    private runWorkerBatch(
        worker: Worker,
        tasks: MatchTask[],
        onGameUpdate?: (update: GameUpdate) => void,
    ): Promise<MatchResult[]> {
        if (tasks.length === 0) return Promise.resolve([]);

        return new Promise((resolve, reject) => {
            const results: MatchResult[] = [];
            let taskIndex = 0;

            const handler = (e: MessageEvent) => {
                const msg = e.data;
                if (msg.type === "result") {
                    results.push({ id: msg.id, fitness: msg.fitness });
                    taskIndex++;
                    if (taskIndex < tasks.length) {
                        worker.postMessage({ type: "play", ...tasks[taskIndex]! });
                    } else {
                        worker.removeEventListener("message", handler);
                        resolve(results);
                    }
                } else if (msg.type === "game_update" && onGameUpdate) {
                    onGameUpdate({
                        individualIndex: msg.individualIndex,
                        points: msg.points,
                        state: msg.state,
                        gen: msg.gen,
                    });
                } else if (msg.type === "error") {
                    worker.removeEventListener("message", handler);
                    reject(new Error(msg.message));
                }
            };

            worker.addEventListener("message", handler);
            worker.postMessage({ type: "play", ...tasks[0]! });
        });
    }

    terminate(): void {
        for (const w of this.workers) w.terminate();
        this.workers = [];
    }
}
