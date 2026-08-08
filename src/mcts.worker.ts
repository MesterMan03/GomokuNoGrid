import { Game } from "./game.ts";
import { InsaneAI } from "./ai/insane.ts";
import type { InsaneAIConfig } from "./ai/types.ts";

/// <reference lib="webworker" />
export {};

let ai: InsaneAI | null = null;

self.onmessage = async (e: MessageEvent) => {
    const msg = e.data;

    if (msg.type === "init") {
        // Create InsaneAI without a worker pool — it runs MCTS locally in this worker
        ai = new InsaneAI(msg.config as Partial<InsaneAIConfig>);
    } else if (msg.type === "search") {
        if (!ai) {
            self.postMessage({ type: "error", id: msg.id, message: "AI not initialized" });
            return;
        }

        try {
            const game = Game.fromPoints(msg.points as Array<{ x: number; y: number; player: 0 | 1 }>);
            const report = ai.searchRoot(game, msg.player);
            self.postMessage({
                type: "result",
                id: msg.id,
                report,
            });
        } catch (err) {
            self.postMessage({ type: "error", id: msg.id, message: String(err) });
        }
    }
};
