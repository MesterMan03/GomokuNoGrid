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

export interface AI {
    getMove(game: Game, player: Player): Promise<ScoredMove>;
    getLastDebugPhases?(): DebugPhase[];
}
