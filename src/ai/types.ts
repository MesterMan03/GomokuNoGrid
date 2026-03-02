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
    lineWeight3: 269.6910527799687,
    lineWeight4: 4506.031031762293,
    openFactor: 2.90469228115494,
    opponentBias: 2.211059939890869,
    clusteringDecay: 31.453351772302383,
    clusteringWeight: 6.830837121206099,
    criticalBlockScore: 389.51654507337855,
    defensiveBlockScore: 135.29753513870904,
    offensiveExtensionScore: 43.06817114509394,
    threatSizeWeight: 31.595952626095404,
    clusterQuickWeight: 4.36622372923175,
    maxCandidates: 10
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
    lineWeight2: 7.750615056232228,
    lineWeight3: 569.4295677988202,
    lineWeight4: 10035.777969929675,
    openFactor: 3.8081154712672176,
    opponentBias: 1.7387607586509222,
    clusteringDecay: 15.411647304176638,
    clusteringWeight: 3.2913220139887587,
    criticalBlockScore: 433.51121825439196,
    defensiveBlockScore: 238.75426784713076,
    offensiveExtensionScore: 86.39703416259381,
    threatSizeWeight: 19.12639845598633,
    clusterQuickWeight: 7.423852541437384,
    maxCandidates: 16,
    baseDepth: 2.198183560686725,
    maxDepth: 4.568205486611596,
    forkBonus: 595.7194884814768,
    defensePenalty: 4645.708741366953
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
