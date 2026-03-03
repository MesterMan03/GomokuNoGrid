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
    lineWeight2: 8.81000035008037,
    lineWeight3: 690.7686154704872,
    lineWeight4: 6927.370074552344,
    openFactor: 3.933452422563696,
    opponentBias: 1.7828667896756278,
    clusteringDecay: 11.648783789799175,
    clusteringWeight: 3.6871787218774967,
    criticalBlockScore: 390.3643476579421,
    defensiveBlockScore: 274.32574377869173,
    offensiveExtensionScore: 87.74356011551403,
    threatSizeWeight: 17.96402963855924,
    clusterQuickWeight: 8.55773036520702,
    maxCandidates: 14,
    baseDepth: 1.8707001227174642,
    maxDepth: 3.7111414228486588,
    forkBonus: 584.0185863171791,
    defensePenalty: 4752.618878313149
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
