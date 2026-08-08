import { Game } from "./game.ts";
import { MediumAI } from "./ai/medium.ts";
import { HardAI } from "./ai/hard.ts";
import type { MediumAIConfig, HardAIConfig } from "./ai/types.ts";

/// <reference lib="webworker" />
export {};

interface EvaluableAI {
    evaluateCandidate(
        game: Game,
        candidate: { x: number; y: number },
        player: 0 | 1,
        searchDepth?: number,
    ): { score: number; immediateWin: boolean };
}

let ai: EvaluableAI | null = null;

self.onmessage = (e: MessageEvent) => {
    const msg = e.data;

    if (msg.type === "init") {
        const difficulty = msg.difficulty ?? "normal";
        if (difficulty === "hard") {
            ai = new HardAI(msg.config as Partial<HardAIConfig>);
        } else if (difficulty === "normal") {
            ai = new MediumAI(msg.config as Partial<MediumAIConfig>);
        } else {
            ai = null;
        }
    } else if (msg.type === "evaluate") {
        if (!ai) {
            self.postMessage({ type: "error", id: msg.id, message: "AI not initialized" });
            return;
        }

        try {
            // Reconstruct game from serialized points (already in scaled coordinates)
            const game = Game.fromPoints(msg.points as Array<{ x: number; y: number; player: 0 | 1 }>);
            const result = ai.evaluateCandidate(game, msg.candidate, msg.player, msg.searchDepth);
            self.postMessage({
                type: "result",
                id: msg.id,
                score: result.score,
                immediateWin: result.immediateWin,
            });
        } catch (error) {
            self.postMessage({ type: "error", id: msg.id, message: String(error) });
        }
    }
};
