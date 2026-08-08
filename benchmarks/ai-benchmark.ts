import { performance } from "node:perf_hooks";
import { cpus, platform, arch } from "node:os";
import { createAI, AI_DIFFICULTIES, type AIDifficulty } from "../src/ai/factory.ts";
import { SeededRandom } from "../src/ai/random.ts";
import { playMatch } from "../src/ai/match-utils.ts";
import { Game } from "../src/game.ts";
import { SCALE } from "../src/consts.ts";

function numberArg(name: string, fallback: number): number {
    const prefix = `--${name}=`;
    const raw = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid --${name} value`);
    return Math.round(value);
}

const gamesPerPair = numberArg("games", 4);
const maxMoves = numberArg("max-moves", 50);
const latencySamples = numberArg("latency-samples", 5);
const insaneTimeMs = numberArg("insane-ms", 350);
const insanePriorDepth = numberArg("insane-prior-depth", 2);
const insanePriorVisits = numberArg("insane-prior-visits", 128);
const insaneEvaluationScale = numberArg("insane-evaluation-scale", 5_000);
const baseSeed = numberArg("seed", 0xC0FFEE);
const difficultyArg = process.argv.find(argument => argument.startsWith("--difficulties="))?.slice("--difficulties=".length);
const benchmarkDifficulties: AIDifficulty[] = difficultyArg
    ? difficultyArg.split(",").map(value => {
        if (!(AI_DIFFICULTIES as readonly string[]).includes(value)) throw new Error(`Unknown difficulty: ${value}`);
        return value as AIDifficulty;
    })
    : [...AI_DIFFICULTIES];

function makeAI(difficulty: AIDifficulty, seed: number) {
    const config = difficulty === "insane" ? {
        searchTimeMs: insaneTimeMs,
        minimaxPriorDepth: insanePriorDepth,
        minimaxPriorVisits: insanePriorVisits,
        evaluationScale: insaneEvaluationScale,
    } : undefined;
    return createAI(difficulty, { config, random: new SeededRandom(seed) });
}

function benchmarkPosition(): Game {
    const p = (x: number, y: number, player: 0 | 1) => ({ x: x * SCALE, y: y * SCALE, player });
    return Game.fromPoints([
        p(300, 300, 0), p(328, 300, 1), p(300, 328, 0), p(328, 328, 1),
        p(356, 300, 0), p(356, 328, 1), p(328, 356, 0), p(300, 356, 1),
    ]);
}

console.log(`# AI benchmark\n`);
console.log(`runtime=Bun ${Bun.version} node=${process.version} platform=${platform()}/${arch()} cpu=${cpus()[0]?.model ?? "unknown"} logicalCores=${cpus().length}`);
console.log(`execution=direct (no browser workers) seed=${baseSeed} games/pair=${gamesPerPair} maxMoves=${maxMoves} insaneBudget=${insaneTimeMs}ms priorDepth=${insanePriorDepth} priorVisits=${insanePriorVisits} evaluationScale=${insaneEvaluationScale}\n`);
console.log("## Move latency");
console.log("| Difficulty | Mean ms | Min ms | Max ms |");
console.log("|---|---:|---:|---:|");

for (const [index, difficulty] of benchmarkDifficulties.entries()) {
    const samples: number[] = [];
    for (let sample = 0; sample < latencySamples; sample++) {
        const ai = makeAI(difficulty, baseSeed + index * 10_000 + sample);
        const game = benchmarkPosition();
        const start = performance.now();
        await ai.getMove(game, 0);
        samples.push(performance.now() - start);
    }
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    console.log(`| ${difficulty} | ${mean.toFixed(2)} | ${Math.min(...samples).toFixed(2)} | ${Math.max(...samples).toFixed(2)} |`);
}

console.log("\n## Seeded head-to-head fitness");
console.log("Positive/tied/negative counts are from the row AI's perspective; unfinished games use the existing bounded position evaluation.");
console.log("| Pair | Positive | Tied | Negative | Mean fitness |");
console.log("|---|---:|---:|---:|---:|");

let matchIndex = 0;
for (let leftIndex = 0; leftIndex < benchmarkDifficulties.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < benchmarkDifficulties.length; rightIndex++) {
        const left = benchmarkDifficulties[leftIndex]!;
        const right = benchmarkDifficulties[rightIndex]!;
        const scores: number[] = [];
        for (let gameIndex = 0; gameIndex < gamesPerPair; gameIndex++) {
            const seed = baseSeed + matchIndex * 1000 + gameIndex;
            const leftFirst = gameIndex % 2 === 0;
            const ai0 = makeAI(leftFirst ? left : right, seed * 2);
            const ai1 = makeAI(leftFirst ? right : left, seed * 2 + 1);
            const raw = await playMatch(ai0, ai1, maxMoves, undefined, new SeededRandom(seed));
            scores.push(leftFirst ? raw : -raw);
        }
        const positive = scores.filter(score => score > 1e-9).length;
        const negative = scores.filter(score => score < -1e-9).length;
        const tied = scores.length - positive - negative;
        const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
        console.log(`| ${left} vs ${right} | ${positive} | ${tied} | ${negative} | ${mean.toFixed(3)} |`);
        matchIndex++;
    }
}
