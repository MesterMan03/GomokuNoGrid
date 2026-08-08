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
    lineWeight3: 584.6029944106157,
    lineWeight4: 7847.080916233621,
    openFactor: 3.933452422563696,
    opponentBias: 2.0312118704472395,
    clusteringDecay: 12.387100940574896,
    clusteringWeight: 3.3064919420686194,
    criticalBlockScore: 390.3643476579421,
    defensiveBlockScore: 340.2562647043141,
    offensiveExtensionScore: 114.37821121982894,
    threatSizeWeight: 19.475277313373727,
    clusterQuickWeight: 7.573255522127518,
    maxCandidates: 15,
    baseDepth: 2,
    maxDepth: 4,
    forkBonus: 584.0185863171791,
    defensePenalty: 5554.478997888204
};

/** Configurable weights for the insane AI (MCTS + heuristic hybrid). */
export interface InsaneAIConfig {
    [key: string]: number;
    /** UCB1 exploration constant (lower = more exploitation) */
    explorationC: number;
    /** Maximum MCTS iterations */
    maxIterations: number;
    /** Root-level candidate limit */
    rootCandidateLimit: number;
    /** Internal node candidate limit */
    internalCandidateLimit: number;
    /** Guided rollout depth (plies) */
    rolloutDepth: number;
    /** Softmax temperature for rollout move selection */
    rolloutTemperature: number;
    /** Selective deepening bonus for critical positions */
    depthExtension: number;
    /** Maximum search depth (for selective deepening) */
    maxSearchDepth: number;
    /** Per-worker wall-clock search budget in milliseconds */
    searchTimeMs: number;
    /** Heuristic score scale used to squash non-terminal rollout rewards */
    evaluationScale: number;
    /** Virtual root visits seeded from a shallow deterministic minimax search */
    minimaxPriorVisits: number;
    /** Depth of the deterministic root prior search */
    minimaxPriorDepth: number;
    /** Threat score: open-4 */
    threatOpen4: number;
    /** Threat score: double threat (fork) */
    threatDoubleThreat: number;
    /** Threat score: open-3 */
    threatOpen3: number;
    /** Bonus for fork formations */
    forkBonus: number;
    /** Line weight for 2-stone groups */
    lineWeight2: number;
    /** Line weight for 3-stone groups */
    lineWeight3: number;
    /** Line weight for 4-stone groups */
    lineWeight4: number;
    /** Open-end multiplier */
    openFactor: number;
    /** Opponent evaluation bias */
    opponentBias: number;
    /** Clustering decay */
    clusteringDecay: number;
    /** Clustering weight */
    clusteringWeight: number;
    /** Defense penalty for opponent open-4 */
    defensePenalty: number;
}

export const DEFAULT_INSANE_CONFIG: InsaneAIConfig = {
    explorationC: 0.3438321493082562,
    maxIterations: 26_251,
    rootCandidateLimit: 9,
    internalCandidateLimit: 7,
    rolloutDepth: 8,
    rolloutTemperature: 0.4103547389693806,
    depthExtension: 2,
    maxSearchDepth: 7,
    searchTimeMs: 350,
    evaluationScale: 5_000,
    minimaxPriorVisits: 128,
    minimaxPriorDepth: 2,
    threatOpen4: 9342.881064859303,
    threatDoubleThreat: 2002.1018256359378,
    threatOpen3: 596.8044364124684,
    forkBonus: 1365.6973891064354,
    lineWeight2: 9.088217729596282,
    lineWeight3: 248.65297042746437,
    lineWeight4: 2719.142410901761,
    openFactor: 3.45935999403989,
    opponentBias: 1.5439876445772607,
    clusteringDecay: 18.979814984465463,
    clusteringWeight: 5.144948903040648,
    defensePenalty: 5269.7397677654435
};

function finiteOr(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) ? value! : fallback;
}

function integerAtLeast(value: number | undefined, fallback: number, minimum: number): number {
    return Math.max(minimum, Math.round(finiteOr(value, fallback)));
}

export function normalizeEasyConfig(config?: Partial<EasyAIConfig>): EasyAIConfig {
    const merged = { ...DEFAULT_EASY_CONFIG, ...config } as EasyAIConfig;
    merged.topK = integerAtLeast(merged.topK, DEFAULT_EASY_CONFIG.topK, 1);
    merged.nearbyRandomCount = integerAtLeast(merged.nearbyRandomCount, DEFAULT_EASY_CONFIG.nearbyRandomCount, 0);
    return merged;
}

export function normalizeMediumConfig(config?: Partial<MediumAIConfig>): MediumAIConfig {
    const merged = { ...DEFAULT_MEDIUM_CONFIG, ...config } as MediumAIConfig;
    merged.maxCandidates = integerAtLeast(merged.maxCandidates, DEFAULT_MEDIUM_CONFIG.maxCandidates, 1);
    return merged;
}

export function normalizeHardConfig(config?: Partial<HardAIConfig>): HardAIConfig {
    const merged = { ...DEFAULT_HARD_CONFIG, ...config } as HardAIConfig;
    merged.maxCandidates = integerAtLeast(merged.maxCandidates, DEFAULT_HARD_CONFIG.maxCandidates, 1);
    merged.baseDepth = integerAtLeast(merged.baseDepth, DEFAULT_HARD_CONFIG.baseDepth, 1);
    merged.maxDepth = integerAtLeast(merged.maxDepth, DEFAULT_HARD_CONFIG.maxDepth, merged.baseDepth);
    return merged;
}

export function normalizeInsaneConfig(config?: Partial<InsaneAIConfig>): InsaneAIConfig {
    const merged = { ...DEFAULT_INSANE_CONFIG, ...config } as InsaneAIConfig;
    merged.maxIterations = integerAtLeast(merged.maxIterations, DEFAULT_INSANE_CONFIG.maxIterations, 1);
    merged.rootCandidateLimit = integerAtLeast(merged.rootCandidateLimit, DEFAULT_INSANE_CONFIG.rootCandidateLimit, 1);
    merged.internalCandidateLimit = integerAtLeast(merged.internalCandidateLimit, DEFAULT_INSANE_CONFIG.internalCandidateLimit, 1);
    merged.rolloutDepth = integerAtLeast(merged.rolloutDepth, DEFAULT_INSANE_CONFIG.rolloutDepth, 1);
    merged.depthExtension = integerAtLeast(merged.depthExtension, DEFAULT_INSANE_CONFIG.depthExtension, 0);
    merged.maxSearchDepth = integerAtLeast(merged.maxSearchDepth, DEFAULT_INSANE_CONFIG.maxSearchDepth, merged.rolloutDepth);
    merged.searchTimeMs = Math.max(0, finiteOr(merged.searchTimeMs, DEFAULT_INSANE_CONFIG.searchTimeMs));
    merged.evaluationScale = Math.max(1, finiteOr(merged.evaluationScale, DEFAULT_INSANE_CONFIG.evaluationScale));
    merged.minimaxPriorVisits = integerAtLeast(merged.minimaxPriorVisits, DEFAULT_INSANE_CONFIG.minimaxPriorVisits, 0);
    merged.minimaxPriorDepth = integerAtLeast(merged.minimaxPriorDepth, DEFAULT_INSANE_CONFIG.minimaxPriorDepth, 1);
    return merged;
}

/** Registry entry for an evolvable AI difficulty. */
export interface AIDefinition {
    defaultConfig: Record<string, number>;
    normalizeConfig(config: Record<string, number>): Record<string, number>;
    createAI(config: Record<string, number>): AI;
}

export interface AI {
    getMove(game: Game, player: Player): Promise<ScoredMove>;
    getLastDebugPhases?(): DebugPhase[];
}
