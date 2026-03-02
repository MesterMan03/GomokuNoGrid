import { GameState, type Point } from "./game.ts";
import { getAIDefinition } from "./ai/evolution.ts";
import { playMatch } from "./ai/match-utils.ts";

/// <reference lib="webworker" />
export {};

self.onmessage = async (e: MessageEvent) => {
    const msg = e.data;

    if (msg.type === "play") {
        try {
            const def = getAIDefinition(msg.difficulty as string);
            if (!def) {
                self.postMessage({ type: "error", id: msg.id, message: `Unknown difficulty: ${msg.difficulty}` });
                return;
            }

            const candidateAI = def.createAI(msg.candidateConfig);
            const baselineAI = def.createAI(msg.baselineConfig);

            const ai0 = msg.candidateIsPlayer0 ? candidateAI : baselineAI;
            const ai1 = msg.candidateIsPlayer0 ? baselineAI : candidateAI;

            const onUpdate = msg.sendUpdates
                ? (points: Point[], state: GameState) => {
                    self.postMessage({
                        type: "game_update",
                        id: msg.id,
                        individualIndex: msg.individualIndex,
                        points: points.map(p => ({ x: p.x, y: p.y, player: p.player })),
                        state: state as number,
                        gen: msg.gen,
                    });
                }
                : undefined;

            const rawFitness = await playMatch(ai0, ai1, msg.maxMoves, onUpdate);
            // Flip fitness when candidate is player 1 (fitness is from player 0's perspective)
            const fitness = msg.candidateIsPlayer0 ? rawFitness : -rawFitness;

            self.postMessage({ type: "result", id: msg.id, fitness });
        } catch (err) {
            self.postMessage({ type: "error", id: msg.id, message: String(err) });
        }
    }
};
