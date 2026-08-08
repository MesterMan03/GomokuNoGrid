import { EasyAI } from "./easy.ts";
import { MediumAI } from "./medium.ts";
import { HardAI } from "./hard.ts";
import { InsaneAI } from "./insane.ts";
import type { MCTSWorkerPool, MinimaxWorkerPool } from "./worker-pool.ts";
import {
    DEFAULT_EASY_CONFIG,
    DEFAULT_HARD_CONFIG,
    DEFAULT_INSANE_CONFIG,
    DEFAULT_MEDIUM_CONFIG,
    normalizeEasyConfig,
    normalizeHardConfig,
    normalizeInsaneConfig,
    normalizeMediumConfig,
    type AI,
} from "./types.ts";
import type { RandomSource } from "./random.ts";

export const AI_DIFFICULTIES = ["easy", "normal", "hard", "insane"] as const;
export type AIDifficulty = typeof AI_DIFFICULTIES[number];

export interface CreateAIOptions {
    config?: Record<string, number>;
    minimaxPool?: MinimaxWorkerPool;
    mctsPool?: MCTSWorkerPool;
    random?: RandomSource;
}

export function isAIDifficulty(value: string): value is AIDifficulty {
    return (AI_DIFFICULTIES as readonly string[]).includes(value);
}

export function getDefaultAIConfig(difficulty: AIDifficulty): Record<string, number> {
    switch (difficulty) {
        case "easy": return DEFAULT_EASY_CONFIG;
        case "normal": return DEFAULT_MEDIUM_CONFIG;
        case "hard": return DEFAULT_HARD_CONFIG;
        case "insane": return DEFAULT_INSANE_CONFIG;
    }
}

export function normalizeAIConfig(difficulty: AIDifficulty, config: Record<string, number>): Record<string, number> {
    switch (difficulty) {
        case "easy": return normalizeEasyConfig(config);
        case "normal": return normalizeMediumConfig(config);
        case "hard": return normalizeHardConfig(config);
        case "insane": return normalizeInsaneConfig(config);
    }
}

export function createAI(difficulty: AIDifficulty, options: CreateAIOptions = {}): AI {
    switch (difficulty) {
        case "easy": return new EasyAI(options.config, options.random);
        case "normal": return new MediumAI(options.config, options.minimaxPool, options.random);
        case "hard": return new HardAI(options.config, options.minimaxPool, options.random);
        case "insane": return new InsaneAI(options.config, options.mctsPool, options.random);
    }
}
