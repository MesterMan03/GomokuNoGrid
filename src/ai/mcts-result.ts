import { SCALE } from "../consts.ts";
import type { DebugPhase, MoveReason, ScoredMove } from "./types.ts";

export const MCTS_SCORE_SCALE = 100_000;

export interface MCTSRootStat {
    x: number;
    y: number;
    reason: MoveReason;
    visits: number;
    totalReward: number;
}

export interface MCTSSearchReport {
    kind: "search" | "immediate_win" | "forced_move" | "fallback";
    rootStats: MCTSRootStat[];
    debugPhases: DebugPhase[];
}

export interface AggregatedMCTSResult extends ScoredMove {
    visits: number;
    totalReward: number;
    debugPhases: DebugPhase[];
}

/** UCB1 from a fixed AI reward perspective; opponent nodes invert exploitation only. */
export function ucb1Score(
    averageReward: number,
    visits: number,
    parentVisits: number,
    explorationC: number,
    maximizing: boolean,
): number {
    if (visits === 0) return Infinity;
    const exploitation = maximizing ? averageReward : -averageReward;
    return exploitation + explorationC * Math.sqrt(Math.log(Math.max(1, parentVisits)) / visits);
}

function moveKey(x: number, y: number): string {
    return `${Math.round(x * SCALE)},${Math.round(y * SCALE)}`;
}

/** Merge independent root trees by summing the evidence for each root move. */
export function aggregateMCTSReports(reports: readonly MCTSSearchReport[]): AggregatedMCTSResult {
    if (reports.length === 0) throw new Error("No MCTS search reports available");

    const immediateWin = reports
        .filter(report => report.kind === "immediate_win")
        .flatMap(report => report.rootStats)[0];
    if (immediateWin) {
        return {
            x: immediateWin.x,
            y: immediateWin.y,
            reason: immediateWin.reason,
            score: MCTS_SCORE_SCALE,
            visits: immediateWin.visits,
            totalReward: immediateWin.totalReward,
            debugPhases: reports.find(report => report.kind === "immediate_win")?.debugPhases ?? [],
        };
    }

    const forcedMove = reports
        .filter(report => report.kind === "forced_move")
        .flatMap(report => report.rootStats)[0];
    if (forcedMove) {
        return {
            x: forcedMove.x,
            y: forcedMove.y,
            reason: forcedMove.reason,
            score: MCTS_SCORE_SCALE / 2,
            visits: forcedMove.visits,
            totalReward: forcedMove.totalReward,
            debugPhases: reports.find(report => report.kind === "forced_move")?.debugPhases ?? [],
        };
    }

    const aggregated = new Map<string, MCTSRootStat>();
    for (const report of reports) {
        for (const stat of report.rootStats) {
            const key = moveKey(stat.x, stat.y);
            const current = aggregated.get(key);
            if (current) {
                current.visits += stat.visits;
                current.totalReward += stat.totalReward;
            } else {
                aggregated.set(key, { ...stat });
            }
        }
    }

    let best: MCTSRootStat | undefined;
    for (const stat of aggregated.values()) {
        if (!best) {
            best = stat;
            continue;
        }
        const mean = stat.visits === 0 ? -Infinity : stat.totalReward / stat.visits;
        const bestMean = best.visits === 0 ? -Infinity : best.totalReward / best.visits;
        if (stat.visits > best.visits || (stat.visits === best.visits && mean > bestMean)) {
            best = stat;
        }
    }

    if (!best) throw new Error("MCTS reports contained no legal root moves");

    const averageReward = best.visits === 0 ? 0 : best.totalReward / best.visits;
    const debugPhases = reports[0]?.debugPhases.slice() ?? [];
    if (reports.length > 1) {
        debugPhases.push({
            title: "Root Parallel Aggregation",
            description: `Merged ${reports.length} independent trees; selected ${best.visits} combined visits`,
            markers: [...aggregated.values()].map(stat => ({
                x: stat.x,
                y: stat.y,
                color: moveKey(stat.x, stat.y) === moveKey(best!.x, best!.y) ? "#ffff00" : "#00ccff",
                label: `v=${stat.visits} r=${(stat.visits === 0 ? 0 : stat.totalReward / stat.visits).toFixed(2)}`,
                radius: moveKey(stat.x, stat.y) === moveKey(best!.x, best!.y) ? 8 : 5,
            })),
            lines: [],
        });
    }

    return {
        x: best.x,
        y: best.y,
        reason: best.reason,
        score: averageReward * MCTS_SCORE_SCALE,
        visits: best.visits,
        totalReward: best.totalReward,
        debugPhases,
    };
}
