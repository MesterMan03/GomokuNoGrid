import { describe, expect, test } from "bun:test";
import { aggregateMCTSReports, ucb1Score, type MCTSSearchReport } from "../src/ai/mcts-result.ts";
import { MoveReason } from "../src/ai/types.ts";

function report(rootStats: MCTSSearchReport["rootStats"]): MCTSSearchReport {
    return { kind: "search", rootStats, debugPhases: [] };
}

describe("adversarial MCTS", () => {
    test("opponent nodes prefer lower AI rewards", () => {
        const exploration = 0.4;
        const favorableToAI = ucb1Score(0.8, 20, 100, exploration, false);
        const favorableToOpponent = ucb1Score(-0.4, 20, 100, exploration, false);
        expect(favorableToOpponent).toBeGreaterThan(favorableToAI);
    });

    test("root parallelism merges visits instead of choosing a lucky worker", () => {
        const result = aggregateMCTSReports([
            report([
                { x: 10, y: 10, reason: MoveReason.OFFENSIVE_EXTENSION, visits: 100, totalReward: 40 },
                { x: 20, y: 20, reason: MoveReason.DEFENSIVE_BLOCK, visits: 50, totalReward: 30 },
            ]),
            report([
                { x: 10, y: 10, reason: MoveReason.OFFENSIVE_EXTENSION, visits: 100, totalReward: 40 },
                // A lucky one-simulation outlier must not beat 200 combined visits.
                { x: 20, y: 20, reason: MoveReason.DEFENSIVE_BLOCK, visits: 1, totalReward: 1 },
            ]),
        ]);

        expect(result.x).toBe(10);
        expect(result.y).toBe(10);
        expect(result.visits).toBe(200);
        expect(result.score).toBeCloseTo(40_000, 5);
    });

    test("an immediate win dominates statistical reports", () => {
        const result = aggregateMCTSReports([
            report([{ x: 10, y: 10, reason: MoveReason.OFFENSIVE_EXTENSION, visits: 500, totalReward: 499 }]),
            {
                kind: "immediate_win",
                rootStats: [{ x: 30, y: 30, reason: MoveReason.OFFENSIVE_EXTENSION, visits: 1, totalReward: 1 }],
                debugPhases: [],
            },
        ]);
        expect(result.x).toBe(30);
        expect(result.score).toBe(100_000);
    });
});
