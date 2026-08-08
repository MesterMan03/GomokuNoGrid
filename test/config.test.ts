import { describe, expect, test } from "bun:test";
import { normalizeEasyConfig, normalizeHardConfig, normalizeInsaneConfig } from "../src/ai/types.ts";

describe("AI config normalization", () => {
    test("rounds discrete search parameters and preserves depth ordering", () => {
        const hard = normalizeHardConfig({ baseDepth: 2.2, maxDepth: 1.1, maxCandidates: 7.7 });
        expect(hard.baseDepth).toBe(2);
        expect(hard.maxDepth).toBe(2);
        expect(hard.maxCandidates).toBe(8);

        const insane = normalizeInsaneConfig({
            maxIterations: 100.7,
            rootCandidateLimit: 5.8,
            internalCandidateLimit: 4.2,
            rolloutDepth: 6.6,
            maxSearchDepth: 3.1,
        });
        expect(insane.maxIterations).toBe(101);
        expect(insane.rootCandidateLimit).toBe(6);
        expect(insane.internalCandidateLimit).toBe(4);
        expect(insane.rolloutDepth).toBe(7);
        expect(insane.maxSearchDepth).toBe(7);
    });

    test("repairs invalid and non-finite values", () => {
        const easy = normalizeEasyConfig({ topK: 0, nearbyRandomCount: -5 });
        expect(easy.topK).toBe(1);
        expect(easy.nearbyRandomCount).toBe(0);

        const insane = normalizeInsaneConfig({ maxIterations: Number.NaN, searchTimeMs: -1 });
        expect(Number.isFinite(insane.maxIterations)).toBe(true);
        expect(insane.searchTimeMs).toBe(0);
    });
});
