import type { Game, Player } from "../game.ts";

export enum Difficulty {
    EASY = "easy",
    NORMAL = "normal",
    HARD = "hard",
    INSANE = "insane",
}

export interface AI {
    getMove(game: Game, player: Player): { x: number; y: number };
}
