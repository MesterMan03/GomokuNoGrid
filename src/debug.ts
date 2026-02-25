import type { Game } from "./game.ts";
import type { DebugPhase } from "./ai/types.ts";
import { SCALE } from "./consts.ts";

export class DebugDrawer {
    private _enabled = false;
    private currentPhase: DebugPhase | null = null;
    private phaseQueue: DebugPhase[] = [];
    private phaseIndex = -1;
    private stepResolve: (() => void) | null = null;

    get enabled(): boolean { return this._enabled; }

    toggle(): void {
        this._enabled = !this._enabled;
        if (!this._enabled && this.stepResolve) {
            const resolve = this.stepResolve;
            this.stepResolve = null;
            resolve();
        }
    }

    get isStepping(): boolean {
        return this.stepResolve !== null;
    }

    /**
     * Load phases and step through them one at a time.
     * Resolves when the user has stepped past the last phase.
     */
    async stepThroughPhases(phases: DebugPhase[]): Promise<void> {
        if (!this._enabled || phases.length === 0) return;

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

    /**
     * Advance to the next phase. Called on key press.
     * Returns true if a step was consumed.
     */
    advance(): boolean {
        if (!this.stepResolve) return false;
        const resolve = this.stepResolve;
        this.stepResolve = null;
        resolve();
        return true;
    }

    /**
     * Draw debug overlay on the canvas.
     * Must be called inside the draw loop while world-coordinate transforms are active.
     */
    draw(ctx: CanvasRenderingContext2D, game: Game, canvasWidth: number, canvasHeight: number): void {
        if (!this._enabled) return;

        // Always-on overlay: line groups for both players
        this.drawLineGroups(ctx, game, 0, "rgba(0, 100, 255, 0.5)");
        this.drawLineGroups(ctx, game, 1, "rgba(255, 50, 50, 0.5)");

        // Draw current debug phase markers and lines
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

        // HUD in screen coordinates
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        const hudHeight = this.currentPhase ? 60 : 30;
        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.fillRect(0, 0, canvasWidth, hudHeight);

        ctx.fillStyle = "#00ff00";
        ctx.font = "14px monospace";
        ctx.fillText("[DEBUG ON]  `  toggle  |  N  advance step", 10, 20);

        if (this.currentPhase) {
            ctx.fillStyle = "#ffff00";
            ctx.fillText(
                `Phase ${this.phaseIndex + 1}/${this.phaseQueue.length}: ${this.currentPhase.title}`,
                10, 38,
            );
            ctx.fillStyle = "#cccccc";
            ctx.fillText(this.currentPhase.description, 10, 54);
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

            // Label with group size
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            ctx.fillStyle = color;
            ctx.font = "10px monospace";
            ctx.fillText(`${group.stones.size}`, mx + 5, my - 5);
        }
        ctx.lineWidth = 1;
    }
}
