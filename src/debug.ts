import type { Game } from "./game.ts";
import type { DebugPhase } from "./ai/types.ts";
import { IDEAL_SPACING, SCALE, WIN_D_MAX } from "./consts.ts";

export interface DebugSettings {
    showLineGroups: boolean;
    showWinEvaluation: boolean;
    showAIPhases: boolean;
}

export class DebugDrawer {
    private _enabled = false;
    private currentPhase: DebugPhase | null = null;
    private phaseQueue: DebugPhase[] = [];
    private phaseIndex = -1;
    private stepResolve: (() => void) | null = null;

    readonly settings: DebugSettings = {
        showLineGroups: true,
        showWinEvaluation: false,
        showAIPhases: true,
    };

    get enabled(): boolean { return this._enabled; }

    toggle(): void {
        this._enabled = !this._enabled;
        if (!this._enabled && this.stepResolve) {
            const resolve = this.stepResolve;
            this.stepResolve = null;
            resolve();
        }
    }

    toggleSetting(key: keyof DebugSettings): void {
        this.settings[key] = !this.settings[key];
    }

    get isStepping(): boolean {
        return this.stepResolve !== null;
    }

    async stepThroughPhases(phases: DebugPhase[]): Promise<void> {
        if (!this._enabled || !this.settings.showAIPhases || phases.length === 0) return;

        this.phaseQueue = phases;

        for (let i = 0; i < phases.length; i++) {
            if (!this._enabled) break;
            this.phaseIndex = i;
            this.currentPhase = phases[i]!;
            await new Promise<void>(resolve => {
                this.stepResolve = resolve;
            });
        }

        this.currentPhase = null;
        this.phaseQueue = [];
        this.phaseIndex = -1;
    }

    advance(): boolean {
        if (!this.stepResolve) return false;
        const resolve = this.stepResolve;
        this.stepResolve = null;
        resolve();
        return true;
    }

    /**
     * Draw debug overlay. World-space elements use the current ctx transform (set by renderer).
     * Screen-space HUD is drawn after resetting the transform.
     */
    draw(
        ctx: CanvasRenderingContext2D,
        game: Game,
        canvasWidth: number,
        canvasHeight: number,
        translateX: number,
        translateY: number,
        viewScale: number,
    ): void {
        if (!this._enabled) return;

        // ── World-space overlays (transform is already set by renderer) ──

        if (this.settings.showLineGroups) {
            this.drawLineGroups(ctx, game, 0, "rgba(0, 100, 255, 0.5)");
            this.drawLineGroups(ctx, game, 1, "rgba(255, 50, 50, 0.5)");
        }

        if (this.settings.showWinEvaluation) {
            this.drawWinEvaluation(ctx, game);
        }

        // Draw current debug phase markers and lines (world coordinates)
        if (this.currentPhase) {
            for (const line of this.currentPhase.lines) {
                ctx.strokeStyle = line.color;
                if (line.dashed) ctx.setLineDash([4, 4]);
                else ctx.setLineDash([]);
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(line.x1, line.y1);
                ctx.lineTo(line.x2, line.y2);
                ctx.stroke();
            }
            ctx.setLineDash([]);
            ctx.lineWidth = 1;

            for (const marker of this.currentPhase.markers) {
                ctx.fillStyle = marker.color;
                ctx.globalAlpha = 0.7;
                ctx.beginPath();
                ctx.arc(marker.x, marker.y, marker.radius ?? 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1.0;

                if (marker.label) {
                    ctx.fillStyle = marker.color;
                    ctx.font = "9px monospace";
                    ctx.fillText(marker.label, marker.x + (marker.radius ?? 5) + 3, marker.y - 3);
                }
            }
        }

        // ── Screen-space HUD ──
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        const lines: string[] = [];
        lines.push(`[DEBUG]  \`  toggle  |  N  step  |  1  linegroups: ${this.settings.showLineGroups ? "ON" : "OFF"}  |  2  win eval: ${this.settings.showWinEvaluation ? "ON" : "OFF"}  |  3  AI phases: ${this.settings.showAIPhases ? "ON" : "OFF"}`);
        if (this.currentPhase) {
            lines.push(`Phase ${this.phaseIndex + 1}/${this.phaseQueue.length}: ${this.currentPhase.title}`);
            lines.push(this.currentPhase.description);
        }

        const lineHeight = 18;
        const hudHeight = lines.length * lineHeight + 6;
        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.fillRect(0, 0, canvasWidth, hudHeight);

        ctx.font = "13px monospace";
        for (let i = 0; i < lines.length; i++) {
            ctx.fillStyle = i === 0 ? "#00ff00" : i === 1 ? "#ffff00" : "#cccccc";
            ctx.fillText(lines[i]!, 10, lineHeight * (i + 1));
        }

        ctx.restore();
    }

    private drawLineGroups(ctx: CanvasRenderingContext2D, game: Game, player: 0 | 1, color: string): void {
        const groups = game.getLineGroups(player);
        for (const group of groups) {
            if (group.projections.length < 2) continue;

            const minProj = group.projections[0]!;
            const maxProj = group.projections[group.projections.length - 1]!;

            const x1 = (group.originX + group.dirX * minProj) / SCALE;
            const y1 = (group.originY + group.dirY * minProj) / SCALE;
            const x2 = (group.originX + group.dirX * maxProj) / SCALE;
            const y2 = (group.originY + group.dirY * maxProj) / SCALE;

            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            ctx.fillStyle = color;
            ctx.font = "10px monospace";
            ctx.fillText(`${group.stones.size}`, mx + 5, my - 5);
        }
        ctx.lineWidth = 1;
    }

    private drawWinEvaluation(ctx: CanvasRenderingContext2D, game: Game): void {
        for (const player of [0, 1] as const) {
            const color = player === 0 ? "rgba(0, 0, 200, 0.8)" : "rgba(200, 0, 0, 0.8)";
            const groups = game.getLineGroups(player);

            for (const group of groups) {
                const projections = group.projections;
                if (projections.length < 2) continue;

                // count longest consecutive run
                let maxRun = 1;
                let currentRun = 1;
                for (let i = 0; i < projections.length - 1; i++) {
                    const delta = projections[i + 1]! - projections[i]!;
                    if (delta <= WIN_D_MAX) {
                        currentRun++;
                        maxRun = Math.max(maxRun, currentRun);
                    } else {
                        currentRun = 1;
                    }
                }
                if (maxRun < 2) continue;

                // check open ends
                const minProj = projections[0]!;
                const maxProj = projections[projections.length - 1]!;
                const spacing = IDEAL_SPACING * SCALE;

                const ext1X = (group.originX + group.dirX * (minProj - spacing)) / SCALE;
                const ext1Y = (group.originY + group.dirY * (minProj - spacing)) / SCALE;
                const ext2X = (group.originX + group.dirX * (maxProj + spacing)) / SCALE;
                const ext2Y = (group.originY + group.dirY * (maxProj + spacing)) / SCALE;

                let openEnds = 0;
                if (game.isValidMove(ext1X, ext1Y)) openEnds++;
                if (game.isValidMove(ext2X, ext2Y)) openEnds++;

                // draw open end indicators
                ctx.globalAlpha = 0.5;
                if (game.isValidMove(ext1X, ext1Y)) {
                    ctx.strokeStyle = "#00ff00";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(ext1X, ext1Y, 4, 0, Math.PI * 2);
                    ctx.stroke();
                }
                if (game.isValidMove(ext2X, ext2Y)) {
                    ctx.strokeStyle = "#00ff00";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(ext2X, ext2Y, 4, 0, Math.PI * 2);
                    ctx.stroke();
                }
                ctx.globalAlpha = 1.0;

                // label at midpoint with run length, open ends, and threat level
                const mx = (group.originX + group.dirX * ((minProj + maxProj) / 2)) / SCALE;
                const my = (group.originY + group.dirY * ((minProj + maxProj) / 2)) / SCALE;

                const threatLevel = maxRun >= 5 ? "WIN" : maxRun >= 4 ? "CRITICAL" : maxRun >= 3 ? "THREAT" : "low";
                const label = `run=${maxRun} open=${openEnds} [${threatLevel}]`;

                ctx.fillStyle = color;
                ctx.font = "9px monospace";
                ctx.fillText(label, mx + 8, my + 12);
            }
        }
    }
}
