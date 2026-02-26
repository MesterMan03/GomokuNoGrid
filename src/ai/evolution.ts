import { Game, GameState, type Player, type Point } from "../game.ts";
import { EasyAI } from "./easy.ts";
import { MediumAI } from "./medium.ts";
import { type AI, type AIDefinition, DEFAULT_EASY_CONFIG, DEFAULT_MEDIUM_CONFIG, type EasyAIConfig, type MediumAIConfig } from "./types.ts";
import { IDEAL_SPACING, SCALE, WIN_D_MAX } from "../consts.ts";

// ── AI Registry ──────────────────────────────────────────────────────────

const AI_REGISTRY: Record<string, AIDefinition> = {
    easy: {
        defaultConfig: DEFAULT_EASY_CONFIG,
        createAI: (config) => new EasyAI(config as Partial<EasyAIConfig>),
    },
    normal: {
        defaultConfig: DEFAULT_MEDIUM_CONFIG,
        createAI: (config) => new MediumAI(config as Partial<MediumAIConfig>),
    },
};

export function getAIDefinition(difficulty: string): AIDefinition | undefined {
    return AI_REGISTRY[difficulty];
}

export function getAvailableDifficulties(): string[] {
    return Object.keys(AI_REGISTRY);
}

// ── Evolution Parameters ────────────────────────────────────────────────

export interface EvolutionParams {
    simsPerBatch: number;
    batches: number;
    startingMoves: number;
    extraMovesPerGen: number;
    mutationRate: number;
    mutationStrength: number;
    eliteCount: number;
    populationSize: number;
}

export const DEFAULT_EVOLUTION_PARAMS: EvolutionParams = {
    simsPerBatch: 4,
    batches: 5,
    startingMoves: 30,
    extraMovesPerGen: 2,
    mutationRate: 0.3,
    mutationStrength: 0.25,
    eliteCount: 2,
    populationSize: 8,
};

export interface EvolutionResult {
    generation: number;
    bestConfig: Record<string, number>;
    bestFitness: number;
    avgFitness: number;
    log: string;
}

export interface GameUpdate {
    individualIndex: number;
    points: Array<{ x: number; y: number; player: 0 | 1 }>;
    state: number;
    gen: number;
}

// ── Standalone Fitness Evaluation ───────────────────────────────────────

function evaluatePosition(game: Game, player: Player): number {
    const opponent: Player = player === 0 ? 1 : 0;
    let score = 0;

    for (const group of game.getLineGroups(player)) {
        const projections = group.projections;
        if (projections.length < 2) continue;
        let maxRun = 1, run = 1;
        for (let i = 0; i < projections.length - 1; i++) {
            if (projections[i + 1]! - projections[i]! <= WIN_D_MAX) { run++; maxRun = Math.max(maxRun, run); }
            else run = 1;
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
            if (projections[i + 1]! - projections[i]! <= WIN_D_MAX) { run++; maxRun = Math.max(maxRun, run); }
            else run = 1;
        }
        if (maxRun >= 5) return -10000;
        if (maxRun >= 4) score -= 300;
        else if (maxRun >= 3) score -= 50;
        else if (maxRun >= 2) score -= 10;
    }

    return score;
}

// ── Match Simulation ────────────────────────────────────────────────────

async function playMatch(
    ai0: AI,
    ai1: AI,
    maxMoves: number,
    onUpdate?: (points: Point[], state: GameState) => void,
): Promise<number> {
    const game = new Game();
    game.addMove(400, 400, 0);

    const firstReply = await ai1.getMove(game, 1);
    game.addMove(firstReply.x, firstReply.y, 1);

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

// ── Genetic Operators ───────────────────────────────────────────────────

const MIN_CONFIG_VALUE = 0.1;
const MIN_CANDIDATES = 3;

function mutateConfig(
    base: Record<string, number>,
    rate: number,
    strength: number,
): Record<string, number> {
    const result = { ...base };
    const keys = Object.keys(result);
    for (const key of keys) {
        if (Math.random() < rate) {
            const val = result[key]!;
            const delta = val * strength * (Math.random() * 2 - 1);
            result[key] = Math.max(MIN_CONFIG_VALUE, val + delta);
        }
    }
    // Clamp integer-valued fields
    if (result["maxCandidates"] !== undefined) {
        result["maxCandidates"] = Math.max(MIN_CANDIDATES, Math.round(result["maxCandidates"]));
    }
    if (result["topK"] !== undefined) {
        result["topK"] = Math.max(1, Math.round(result["topK"]));
    }
    if (result["nearbyRandomCount"] !== undefined) {
        result["nearbyRandomCount"] = Math.max(0, Math.round(result["nearbyRandomCount"]));
    }
    return result;
}

function crossover(
    a: Record<string, number>,
    b: Record<string, number>,
): Record<string, number> {
    const result = { ...a };
    const keys = Object.keys(result);
    for (const key of keys) {
        if (Math.random() < 0.5 && b[key] !== undefined) {
            result[key] = b[key]!;
        }
    }
    if (result["maxCandidates"] !== undefined) {
        result["maxCandidates"] = Math.max(MIN_CANDIDATES, Math.round(result["maxCandidates"]));
    }
    if (result["topK"] !== undefined) {
        result["topK"] = Math.max(1, Math.round(result["topK"]));
    }
    if (result["nearbyRandomCount"] !== undefined) {
        result["nearbyRandomCount"] = Math.max(0, Math.round(result["nearbyRandomCount"]));
    }
    return result;
}

// ── Main Evolution Runner ───────────────────────────────────────────────

export async function runEvolution(
    params: EvolutionParams,
    difficulty: string,
    onProgress: (result: EvolutionResult) => void,
    onGameUpdate?: (update: GameUpdate) => void,
    signal?: AbortSignal,
): Promise<Record<string, number>> {
    const definition = getAIDefinition(difficulty);
    if (!definition) {
        throw new Error(`Unknown difficulty: ${difficulty}. Available: ${getAvailableDifficulties().join(", ")}`);
    }

    const totalGenerations = params.batches;
    const baseline = definition.createAI(definition.defaultConfig);

    let population: Record<string, number>[] = [];
    for (let i = 0; i < params.populationSize; i++) {
        if (i === 0) {
            population.push({ ...definition.defaultConfig });
        } else {
            population.push(mutateConfig(definition.defaultConfig, 0.8, params.mutationStrength));
        }
    }

    let bestOverall: Record<string, number> = { ...definition.defaultConfig };
    let bestOverallFitness = -Infinity;
    const maxMoves = params.startingMoves;

    for (let gen = 0; gen < totalGenerations; gen++) {
        if (signal?.aborted) break;

        const currentMaxMoves = maxMoves + gen * params.extraMovesPerGen;
        const fitnesses: number[] = [];

        for (let i = 0; i < population.length; i++) {
            if (signal?.aborted) break;

            const candidate = definition.createAI(population[i]!);
            let totalFitness = 0;

            for (let sim = 0; sim < params.simsPerBatch; sim++) {
                if (signal?.aborted) break;

                const updateHandler = onGameUpdate
                    ? (points: Point[], state: GameState) => {
                        onGameUpdate({
                            individualIndex: i,
                            points: points.map(p => ({ x: p.x, y: p.y, player: p.player })),
                            state: state as number,
                            gen: gen + 1,
                        });
                    }
                    : undefined;

                if (sim % 2 === 0) {
                    totalFitness += await playMatch(candidate, baseline, currentMaxMoves, updateHandler);
                } else {
                    totalFitness -= await playMatch(baseline, candidate, currentMaxMoves, updateHandler);
                }
            }

            fitnesses.push(totalFitness / params.simsPerBatch);
        }

        const indexed = population.map((cfg, i) => ({ cfg, fit: fitnesses[i]! }));
        indexed.sort((a, b) => b.fit - a.fit);

        const bestFitness = indexed[0]!.fit;
        const avgFitness = fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length;

        if (bestFitness > bestOverallFitness) {
            bestOverallFitness = bestFitness;
            bestOverall = { ...indexed[0]!.cfg };
        }

        onProgress({
            generation: gen + 1,
            bestConfig: { ...indexed[0]!.cfg },
            bestFitness,
            avgFitness,
            log: `Gen ${gen + 1}/${totalGenerations}: best=${bestFitness.toFixed(3)} avg=${avgFitness.toFixed(3)} moves=${currentMaxMoves}`,
        });

        const nextPop: Record<string, number>[] = [];
        for (let i = 0; i < Math.min(params.eliteCount, indexed.length); i++) {
            nextPop.push({ ...indexed[i]!.cfg });
        }
        while (nextPop.length < params.populationSize) {
            const parentA = indexed[Math.floor(Math.random() * Math.min(params.eliteCount + 2, indexed.length))]!.cfg;
            const parentB = indexed[Math.floor(Math.random() * indexed.length)]!.cfg;
            const child = crossover(parentA, parentB);
            nextPop.push(mutateConfig(child, params.mutationRate, params.mutationStrength));
        }

        population = nextPop;
    }

    return bestOverall;
}
