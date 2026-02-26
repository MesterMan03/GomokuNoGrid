import type { Game, Player } from "../game.ts";

export enum Difficulty {
    EASY = "easy",
    NORMAL = "normal",
    HARD = "hard",
    INSANE = "insane",
}

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
    topK: 3,
    noiseAmount: 15,
    criticalBlockScore: 500,
    defensiveBlockScore: 150,
    offensiveWeight: 20,
    clusteringDecay: 30,
    nearbyRandomCount: 2,
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
    lineWeight2: 15,
    lineWeight3: 200,
    lineWeight4: 5000,
    openFactor: 3.0,
    opponentBias: 1.3,
    clusteringDecay: 30,
    clusteringWeight: 5,
    criticalBlockScore: 500,
    defensiveBlockScore: 150,
    offensiveExtensionScore: 50,
    threatSizeWeight: 30,
    clusterQuickWeight: 10,
    maxCandidates: 10,
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
