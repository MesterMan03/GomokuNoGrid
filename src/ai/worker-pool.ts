import type { GameUpdate } from "./evolution.ts";

// ── Minimax Worker Pool ─────────────────────────────────────────────────

export interface CandidateResult {
    score: number;
    immediateWin: boolean;
}

/**
 * Pool of Web Workers for parallel minimax candidate evaluation.
 * Used by MediumAI during gameplay to evaluate root candidates simultaneously.
 */
export class MinimaxWorkerPool {
    private workers: Worker[];
    private nextId = 0;

    constructor(config: Record<string, number>, numWorkers?: number) {
        const count = numWorkers ?? Math.min(navigator.hardwareConcurrency || 4, 8);
        this.workers = [];
        for (let i = 0; i < count; i++) {
            const w = new Worker(
                new URL("../minimax.worker.js", import.meta.url),
                { type: "module" },
            );
            w.postMessage({ type: "init", config });
            this.workers.push(w);
        }
    }

    updateConfig(config: Record<string, number>): void {
        for (const w of this.workers) {
            w.postMessage({ type: "init", config });
        }
    }

    async evaluateCandidates(
        gamePoints: Array<{ x: number; y: number; player: 0 | 1 }>,
        candidates: Array<{ x: number; y: number }>,
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
            const id = this.nextId++;
            promises.push(
                this.evaluateOne(this.workers[workerIndex]!, id, gamePoints, candidates[i]!, player)
                    .then(r => { results[i] = r; }),
            );
        }

        await Promise.all(promises);
        return results;
    }

    private evaluateOne(
        worker: Worker,
        id: number,
        points: Array<{ x: number; y: number; player: 0 | 1 }>,
        candidate: { x: number; y: number },
        player: 0 | 1,
    ): Promise<CandidateResult> {
        return new Promise((resolve, reject) => {
            let timeoutId: ReturnType<typeof setTimeout> | undefined;

            const cleanup = () => {
                worker.removeEventListener("message", messageHandler);
                worker.removeEventListener("error", errorHandler);
                clearTimeout(timeoutId);
            };

            const messageHandler = (e: MessageEvent) => {
                const data = e.data;
                if (!data || data.id !== id) return;
                if (data.type === "result") {
                    cleanup();
                    resolve({ score: data.score, immediateWin: data.immediateWin });
                } else if (data.type === "error") {
                    cleanup();
                    reject(new Error(typeof data.error === "string" ? data.error : "Minimax worker reported an error"));
                }
            };

            const errorHandler = (event: ErrorEvent) => {
                cleanup();
                reject(event.error instanceof Error ? event.error : new Error(event.message || "Minimax worker error"));
            };

            worker.addEventListener("message", messageHandler);
            worker.addEventListener("error", errorHandler);

            // Timeout to prevent indefinite hangs if the worker never responds
            timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error(`Minimax worker timed out for candidate id=${id}`));
            }, 30_000);

            worker.postMessage({ type: "evaluate", id, points, candidate, player });
        });
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
        const count = numWorkers ?? Math.min(navigator.hardwareConcurrency || 4, 8);
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
