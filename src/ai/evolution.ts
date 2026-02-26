import { Game, GameState, type Player } from "../game.ts";
import { MediumAI } from "./medium.ts";
import { type MediumAIConfig, DEFAULT_MEDIUM_CONFIG } from "./types.ts";
import { IDEAL_SPACING, SCALE } from "../consts.ts";

/** Parameters controlling a single evolution run. */
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
    bestConfig: MediumAIConfig;
    bestFitness: number;
    avgFitness: number;
    log: string;
}

/**
 * Play a headless game between two AIs, returning +1 if ai0 wins, -1 if ai1 wins,
 * or a heuristic score in [-1, 1] if the game times out.
 */
async function playMatch(ai0: MediumAI, ai1: MediumAI, maxMoves: number): Promise<number> {
    const game = new Game();

    // Place first stone at center
    game.addMove(400, 400, 0);

    // AI1 responds near center
    const firstReply = await ai1.getMove(game, 1);
    game.addMove(firstReply.x, firstReply.y, 1);

    let currentPlayer: Player = 0;
    for (let moveNum = 2; moveNum < maxMoves; moveNum++) {
        if (game.getState() !== GameState.ONGOING) break;

        const ai = currentPlayer === 0 ? ai0 : ai1;
        const move = await ai.getMove(game, currentPlayer);

        if (!game.addMove(move.x, move.y, currentPlayer)) {
            // failed placement — try fallback
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
            if (!placed) break; // can't place anything, end game
        }

        currentPlayer = currentPlayer === 0 ? 1 : 0;
    }

    const state = game.getState();
    if (state === GameState.WIN_0) return 1;
    if (state === GameState.WIN_1) return -1;

    // No win — use heuristic evaluation from ai0's perspective
    const eval0 = ai0.evaluate(game, 0);
    // Clamp to [-1, 1]
    return Math.max(-1, Math.min(1, eval0 / 1000));
}

/** Mutate a config by randomly perturbing each numeric field. */
function mutateConfig(
    base: MediumAIConfig,
    rate: number,
    strength: number,
): MediumAIConfig {
    const result = { ...base };
    const keys = Object.keys(result) as Array<keyof MediumAIConfig>;
    for (const key of keys) {
        if (Math.random() < rate) {
            const val = result[key] as number;
            const delta = val * strength * (Math.random() * 2 - 1);
            (result as Record<string, number>)[key] = Math.max(0.1, val + delta);
        }
    }
    // clamp maxCandidates to integer ≥ 3
    result.maxCandidates = Math.max(3, Math.round(result.maxCandidates));
    return result;
}

/** Crossover two configs by picking each field from one parent. */
function crossover(a: MediumAIConfig, b: MediumAIConfig): MediumAIConfig {
    const result = { ...a };
    const keys = Object.keys(result) as Array<keyof MediumAIConfig>;
    for (const key of keys) {
        if (Math.random() < 0.5) {
            (result as Record<string, number>)[key] = b[key] as number;
        }
    }
    result.maxCandidates = Math.max(3, Math.round(result.maxCandidates));
    return result;
}

/**
 * Run the full evolutionary optimization. Calls `onProgress` after each generation
 * with the current best results. Returns the final best config.
 */
export async function runEvolution(
    params: EvolutionParams,
    onProgress: (result: EvolutionResult) => void,
    signal?: AbortSignal,
): Promise<MediumAIConfig> {
    const totalGenerations = params.batches;
    const baseline = new MediumAI(); // uses DEFAULT_MEDIUM_CONFIG

    // Initialize population
    let population: MediumAIConfig[] = [];
    for (let i = 0; i < params.populationSize; i++) {
        if (i === 0) {
            population.push({ ...DEFAULT_MEDIUM_CONFIG }); // keep one default
        } else {
            population.push(mutateConfig(DEFAULT_MEDIUM_CONFIG, 0.8, params.mutationStrength));
        }
    }

    let bestOverall: MediumAIConfig = { ...DEFAULT_MEDIUM_CONFIG };
    let bestOverallFitness = -Infinity;
    const maxMoves = params.startingMoves;

    for (let gen = 0; gen < totalGenerations; gen++) {
        if (signal?.aborted) break;

        const currentMaxMoves = maxMoves + gen * params.extraMovesPerGen;
        const fitnesses: number[] = [];

        // Evaluate each individual against the baseline
        for (let i = 0; i < population.length; i++) {
            if (signal?.aborted) break;

            const candidate = new MediumAI(population[i]);
            let totalFitness = 0;

            for (let sim = 0; sim < params.simsPerBatch; sim++) {
                if (signal?.aborted) break;

                // Alternate who goes first
                if (sim % 2 === 0) {
                    totalFitness += await playMatch(candidate, baseline, currentMaxMoves);
                } else {
                    totalFitness -= await playMatch(baseline, candidate, currentMaxMoves);
                }
            }

            fitnesses.push(totalFitness / params.simsPerBatch);
        }

        // Sort population by fitness
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

        // Build next generation
        const nextPop: MediumAIConfig[] = [];

        // Elites survive unchanged
        for (let i = 0; i < Math.min(params.eliteCount, indexed.length); i++) {
            nextPop.push({ ...indexed[i]!.cfg });
        }

        // Fill rest with offspring
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
