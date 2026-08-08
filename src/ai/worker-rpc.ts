export interface WorkerLike {
    postMessage(message: unknown): void;
    addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
    addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
    removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
    removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
    terminate(): void;
}

interface PendingRequest {
    resolve(value: unknown): void;
    reject(reason: Error): void;
    timeout: ReturnType<typeof setTimeout>;
}

/** One listener and one pending-request table per Worker, shared by all pool calls. */
export class WorkerRpcClient {
    private nextId = 0;
    private readonly pending = new Map<number, PendingRequest>();
    private terminated = false;

    constructor(
        private readonly worker: WorkerLike,
        private readonly timeoutMs = 30_000,
    ) {
        worker.addEventListener("message", this.onMessage);
        worker.addEventListener("error", this.onError);
    }

    post(message: unknown): void {
        if (this.terminated) throw new Error("Worker client has been terminated");
        this.worker.postMessage(message);
    }

    request<T>(message: Record<string, unknown>): Promise<T> {
        if (this.terminated) return Promise.reject(new Error("Worker client has been terminated"));
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Worker request timed out for id=${id}`));
            }, this.timeoutMs);
            this.pending.set(id, {
                resolve: value => resolve(value as T),
                reject,
                timeout,
            });
            try {
                this.worker.postMessage({ ...message, id });
            } catch (error) {
                clearTimeout(timeout);
                this.pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    terminate(): void {
        if (this.terminated) return;
        this.terminated = true;
        this.rejectAll(new Error("Worker client terminated"));
        this.worker.removeEventListener("message", this.onMessage);
        this.worker.removeEventListener("error", this.onError);
        this.worker.terminate();
    }

    private readonly onMessage = (event: MessageEvent): void => {
        const data = event.data;
        if (!data || typeof data.id !== "number") return;
        const request = this.pending.get(data.id);
        if (!request) return;
        clearTimeout(request.timeout);
        this.pending.delete(data.id);
        if (data.type === "error") {
            const message = typeof data.message === "string"
                ? data.message
                : typeof data.error === "string" ? data.error : "Worker reported an error";
            request.reject(new Error(message));
        } else {
            request.resolve(data);
        }
    };

    private readonly onError = (event: ErrorEvent): void => {
        if (this.terminated) return;
        this.terminated = true;
        this.rejectAll(event.error instanceof Error ? event.error : new Error(event.message || "Worker error"));
        this.worker.removeEventListener("message", this.onMessage);
        this.worker.removeEventListener("error", this.onError);
        this.worker.terminate();
    };

    private rejectAll(error: Error): void {
        for (const request of this.pending.values()) {
            clearTimeout(request.timeout);
            request.reject(error);
        }
        this.pending.clear();
    }
}
