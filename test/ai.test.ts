import { describe, expect, test } from "bun:test";
import { SCALE } from "../src/consts.ts";
import { EasyAI } from "../src/ai/easy.ts";
import { MediumAI } from "../src/ai/medium.ts";
import { HardAI } from "../src/ai/hard.ts";
import { InsaneAI } from "../src/ai/insane.ts";
import { SeededRandom } from "../src/ai/random.ts";
import { Game, type Player } from "../src/game.ts";
import type { AI } from "../src/ai/types.ts";
import type { CandidateTask, MinimaxWorkerPool } from "../src/ai/worker-pool.ts";

function point(x: number, y: number, player: Player) {
    return { x: x * SCALE, y: y * SCALE, player };
}

function winningMoveGame(player: Player): Game {
    const opponent: Player = player === 0 ? 1 : 0;
    return Game.fromPoints([
        point(200, 200, player),
        point(228, 200, player),
        point(256, 200, player),
        point(284, 200, player),
        point(200, 260, opponent),
    ]);
}

function forcedBlockGame(player: Player): Game {
    const opponent: Player = player === 0 ? 1 : 0;
    return Game.fromPoints([
        point(200, 200, opponent),
        point(228, 200, opponent),
        point(256, 200, opponent),
        point(284, 200, opponent),
        // Close the left end, leaving exactly one legal winning endpoint to block.
        point(172, 200, player),
    ]);
}

function ais(seed: number): Array<[string, AI]> {
    return [
        ["easy", new EasyAI(undefined, new SeededRandom(seed))],
        ["medium", new MediumAI(undefined, undefined, new SeededRandom(seed))],
        ["hard", new HardAI({ baseDepth: 1, maxDepth: 2 }, undefined, new SeededRandom(seed))],
        ["insane", new InsaneAI({
            maxIterations: 1_024,
            searchTimeMs: 0,
            rolloutDepth: 3,
            maxSearchDepth: 4,
        }, undefined, new SeededRandom(seed))],
    ];
}

describe("difficulty tactical contract", () => {
    for (const [name, ai] of ais(999)) {
        test(`${name} returns a legal center opening`, async () => {
            const game = new Game();
            const move = await ai.getMove(game, 0);
            expect(game.getPoints()).toHaveLength(0);
            expect(game.isValidMove(move.x, move.y)).toBe(true);
            expect(move.x).toBe(400);
            expect(move.y).toBe(400);
        });
    }

    for (const [name, ai] of ais(1234)) {
        test(`${name} takes an immediate win without mutating the position`, async () => {
            const game = winningMoveGame(0);
            const before = game.dump();
            const move = await ai.getMove(game, 0);

            expect(game.dump()).toEqual(before);
            expect(game.isValidMove(move.x, move.y)).toBe(true);

            const result = game.clone();
            expect(result.addMove(move.x, move.y, 0)).not.toBeNull();
            expect(result.getState()).toBe(1);
        });
    }

    for (const [name, ai] of ais(5678)) {
        test(`${name} blocks a unique loss in one`, async () => {
            const game = forcedBlockGame(0);
            const move = await ai.getMove(game, 0);
            expect(move.x).toBeCloseTo(312, 3);
            expect(move.y).toBeCloseTo(200, 3);
        });
    }
});

describe("Hard worker parity", () => {
    test("passes selective root-depth extensions to workers", async () => {
        let captured: CandidateTask[] = [];
        const pool = {
            async evaluateCandidates(_points: unknown, candidates: CandidateTask[]) {
                captured = candidates;
                return candidates.map(() => ({ score: 0, immediateWin: false }));
            },
        } as unknown as MinimaxWorkerPool;
        const ai = new HardAI({ baseDepth: 1, maxDepth: 2 }, pool, new SeededRandom(42));
        const game = Game.fromPoints([
            point(200, 200, 0), point(228, 200, 0), point(256, 200, 0),
            point(200, 260, 1),
        ]);

        await ai.getMove(game, 0);
        expect(captured.length).toBeGreaterThan(1);
        expect(captured.some(candidate => candidate.searchDepth === 2)).toBe(true);
    });
});
