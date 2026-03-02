import { Game } from "./game.ts";
import { MediumAI } from "./ai/medium.ts";
import type { MediumAIConfig } from "./ai/types.ts";

/// <reference lib="webworker" />
export {};

let ai: MediumAI | null = null;

self.onmessage = (e: MessageEvent) => {
    const msg = e.data;

    if (msg.type === "init") {
        ai = new MediumAI(msg.config as Partial<MediumAIConfig>);
    } else if (msg.type === "evaluate") {
        if (!ai) {
            self.postMessage({ type: "error", id: msg.id, message: "AI not initialized" });
            return;
        }

        // Reconstruct game from serialized points (already in scaled coordinates)
        const game = Game.fromPoints(msg.points as Array<{ x: number; y: number; player: 0 | 1 }>);

        const result = ai.evaluateCandidate(game, msg.candidate, msg.player);
        self.postMessage({
            type: "result",
            id: msg.id,
            score: result.score,
            immediateWin: result.immediateWin,
        });
    }
};
