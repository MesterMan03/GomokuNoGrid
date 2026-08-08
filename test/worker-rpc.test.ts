import { describe, expect, test } from "bun:test";
import { WorkerRpcClient, type WorkerLike } from "../src/ai/worker-rpc.ts";

class FakeWorker implements WorkerLike {
    readonly sent: any[] = [];
    terminated = false;
    private readonly messageListeners = new Set<(event: MessageEvent) => void>();
    private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

    postMessage(message: unknown): void {
        this.sent.push(message);
    }

    addEventListener(type: "message" | "error", listener: ((event: MessageEvent) => void) | ((event: ErrorEvent) => void)): void {
        if (type === "message") this.messageListeners.add(listener as (event: MessageEvent) => void);
        else this.errorListeners.add(listener as (event: ErrorEvent) => void);
    }

    removeEventListener(type: "message" | "error", listener: ((event: MessageEvent) => void) | ((event: ErrorEvent) => void)): void {
        if (type === "message") this.messageListeners.delete(listener as (event: MessageEvent) => void);
        else this.errorListeners.delete(listener as (event: ErrorEvent) => void);
    }

    terminate(): void {
        this.terminated = true;
    }

    respond(data: unknown): void {
        for (const listener of this.messageListeners) listener({ data } as MessageEvent);
    }
}

describe("WorkerRpcClient", () => {
    test("correlates concurrent replies by request id", async () => {
        const worker = new FakeWorker();
        const client = new WorkerRpcClient(worker, 100);
        const first = client.request<{ value: string }>({ type: "work", value: "first" });
        const second = client.request<{ value: string }>({ type: "work", value: "second" });

        worker.respond({ type: "result", id: worker.sent[1].id, value: "B" });
        worker.respond({ type: "result", id: worker.sent[0].id, value: "A" });

        expect(await first).toMatchObject({ value: "A" });
        expect(await second).toMatchObject({ value: "B" });
        client.terminate();
    });

    test("rejects pending work immediately on termination", async () => {
        const worker = new FakeWorker();
        const client = new WorkerRpcClient(worker, 10_000);
        const pending = client.request({ type: "work" });
        client.terminate();

        await expect(pending).rejects.toThrow("terminated");
        expect(worker.terminated).toBe(true);
    });
});
