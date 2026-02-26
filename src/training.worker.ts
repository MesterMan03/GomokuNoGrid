import { runEvolution, type EvolutionParams, type GameUpdate, type EvolutionResult } from "./ai/evolution.ts";

/// <reference lib="webworker" />
export {};

let abortController: AbortController | null = null;

self.onmessage = async (e: MessageEvent) => {
    const msg = e.data;

    if (msg.type === "start") {
        abortController = new AbortController();

        try {
            const bestConfig = await runEvolution(
                msg.params as EvolutionParams,
                msg.difficulty as string,
                (result: EvolutionResult) => {
                    self.postMessage({ type: "progress", result });
                },
                (update: GameUpdate) => {
                    self.postMessage({ type: "game_update", ...update });
                },
                abortController.signal,
            );
            self.postMessage({ type: "done", bestConfig });
        } catch (err) {
            self.postMessage({ type: "error", message: String(err) });
        }
    } else if (msg.type === "stop") {
        abortController?.abort();
    }
};
