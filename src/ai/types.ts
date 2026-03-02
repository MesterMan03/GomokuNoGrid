import type { Game, Player } from "../game.ts";

export enum MoveReason {
    CRITICAL_BLOCK = "critical_block",
    DEFENSIVE_BLOCK = "defensive_block",
    OFFENSIVE_EXTENSION = "offensive_extension",
    NEARBY_RANDOM = "nearby_random",
    FALLBACK = "fallback",
}

export interface ScoredMove {
    x: number;
    y: number;
    score: number;
    reason: MoveReason;
}

export interface DebugMarker {
    x: number;
    y: number;
    color: string;
    label?: string;
    radius?: number;
}

export interface DebugLine {
    x1: number; y1: number;
    x2: number; y2: number;
    color: string;
    dashed?: boolean;
}

export interface DebugPhase {
    title: string;
    description: string;
    markers: DebugMarker[];
    lines: DebugLine[];
}

/** Configurable weights for the easy AI. */
export interface EasyAIConfig {
    [key: string]: number;
    topK: number;
    noiseAmount: number;
    criticalBlockScore: number;
    defensiveBlockScore: number;
    offensiveWeight: number;
    clusteringDecay: number;
    nearbyRandomCount: number;
}

export const DEFAULT_EASY_CONFIG: EasyAIConfig = {
    topK: 6,
    noiseAmount: 19,
    criticalBlockScore: 661,
    defensiveBlockScore: 161,
    offensiveWeight: 10,
    clusteringDecay: 22,
    nearbyRandomCount: 2
};

/** Configurable weights for the medium AI evaluation. */
export interface MediumAIConfig {
    [key: string]: number;
    lineWeight2: number;
    lineWeight3: number;
    lineWeight4: number;
    openFactor: number;
    opponentBias: number;
    clusteringDecay: number;
    clusteringWeight: number;
    criticalBlockScore: number;
    defensiveBlockScore: number;
    offensiveExtensionScore: number;
    threatSizeWeight: number;
    clusterQuickWeight: number;
    maxCandidates: number;
}

export const DEFAULT_MEDIUM_CONFIG: MediumAIConfig = {
    lineWeight2: 11.90820398991699,
    lineWeight3: 255.37020940648523,
    lineWeight4: 4333.66949709354,
    openFactor: 3.4778954833830795,
    opponentBias: 2.211059939890869,
    clusteringDecay: 32.51875801424919,
    clusteringWeight: 5.613639759379915,
    criticalBlockScore: 389.51654507337855,
    defensiveBlockScore: 152.32298545313324,
    offensiveExtensionScore: 50,
    threatSizeWeight: 31.02628123999485,
    clusterQuickWeight: 5.749356049663743,
    maxCandidates: 9,
};

/** Configurable weights for the hard AI evaluation. */
export interface HardAIConfig {
    [key: string]: number;
    lineWeight2: number;
    lineWeight3: number;
    lineWeight4: number;
    openFactor: number;
    opponentBias: number;
    clusteringDecay: number;
    clusteringWeight: number;
    criticalBlockScore: number;
    defensiveBlockScore: number;
    offensiveExtensionScore: number;
    threatSizeWeight: number;
    clusterQuickWeight: number;
    maxCandidates: number;
    baseDepth: number;
    maxDepth: number;
    forkBonus: number;
    defensePenalty: number;
}

export const DEFAULT_HARD_CONFIG: HardAIConfig = {
    lineWeight2: 12,
    lineWeight3: 500,
    lineWeight4: 10000,
    openFactor: 3.5,
    opponentBias: 2.2,
    clusteringDecay: 32,
    clusteringWeight: 5.6,
    criticalBlockScore: 500,
    defensiveBlockScore: 200,
    offensiveExtensionScore: 80,
    threatSizeWeight: 40,
    clusterQuickWeight: 6,
    maxCandidates: 12,
    baseDepth: 4,
    maxDepth: 6,
    forkBonus: 800,
    defensePenalty: 5000,
};

/** Registry entry for an evolvable AI difficulty. */
export interface AIDefinition {
    defaultConfig: Record<string, number>;
    createAI(config: Record<string, number>): AI;
}

export interface AI {
    getMove(game: Game, player: Player): Promise<ScoredMove>;
    getLastDebugPhases?(): DebugPhase[];
}
