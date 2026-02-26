import { runEvolution, type EvolutionParams, type GameUpdate, type EvolutionResult } from "./ai/evolution.ts";

const workerCtx = globalThis as unknown as {
    onmessage: ((e: MessageEvent) => void) | null;
    postMessage(message: unknown): void;
};

let abortController: AbortController | null = null;

workerCtx.onmessage = async (e: MessageEvent) => {
    const msg = e.data;

    if (msg.type === "start") {
        abortController = new AbortController();

        try {
            const bestConfig = await runEvolution(
                msg.params as EvolutionParams,
                msg.difficulty as string,
                (result: EvolutionResult) => {
                    workerCtx.postMessage({ type: "progress", result });
                },
                (update: GameUpdate) => {
                    workerCtx.postMessage({ type: "game_update", ...update });
                },
                abortController.signal,
            );
            workerCtx.postMessage({ type: "done", bestConfig });
        } catch (err) {
            workerCtx.postMessage({ type: "error", message: String(err) });
        }
    } else if (msg.type === "stop") {
        abortController?.abort();
    }
};
