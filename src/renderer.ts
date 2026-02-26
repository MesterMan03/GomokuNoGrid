import { MAX_PLACEMENT_DISTANCE, SCALE, SYMBOL_RADIUS, WIN_D_MAX } from "./consts.ts";
import { Game, GameState, type Player } from "./game.ts";
import { DebugDrawer } from "./debug.ts";

export class Renderer {
    private readonly ctx: CanvasRenderingContext2D;
    private readonly indicatorCanvas: HTMLCanvasElement;
    private readonly indicatorCtx: CanvasRenderingContext2D;

    translateX = 0;
    translateY = 0;
    scale = 1;

    constructor(
        private readonly canvas: HTMLCanvasElement,
        public readonly debugDrawer: DebugDrawer,
    ) {
        this.ctx = canvas.getContext("2d")!;
        this.indicatorCanvas = document.createElement("canvas");
        this.indicatorCanvas.width = canvas.width;
        this.indicatorCanvas.height = canvas.height;
        this.indicatorCtx = this.indicatorCanvas.getContext("2d")!;
    }

    get width(): number { return this.canvas.width; }
    get height(): number { return this.canvas.height; }

    draw(game: Game, currentPlayer: Player, mouse: { x: number; y: number }): void {
        const ctx = this.ctx;

        ctx.setTransform(this.scale, 0, 0, this.scale, this.translateX, this.translateY);
        ctx.clearRect(
            -this.translateX / this.scale,
            -this.translateY / this.scale,
            this.canvas.width / this.scale,
            this.canvas.height / this.scale,
        );

        // background
        ctx.fillStyle = "white";
        ctx.fillRect(
            -this.translateX / this.scale,
            -this.translateY / this.scale,
            this.canvas.width / this.scale,
            this.canvas.height / this.scale,
        );

        const points = game.getPoints();

        // draw placement indicator
        const iCtx = this.indicatorCtx;
        iCtx.fillStyle = "aqua";
        for (const point of points) {
            iCtx.beginPath();
            iCtx.arc(point.x / SCALE, point.y / SCALE, MAX_PLACEMENT_DISTANCE, 0, Math.PI * 2);
            iCtx.fill();
        }
        iCtx.fillStyle = "white";
        for (const point of points) {
            iCtx.beginPath();
            iCtx.arc(point.x / SCALE, point.y / SCALE, SYMBOL_RADIUS * 2, 0, Math.PI * 2);
            iCtx.fill();
        }

        ctx.globalAlpha = 0.4;
        ctx.drawImage(this.indicatorCanvas, 0, 0);
        ctx.globalAlpha = 1.0;

        // draw all points
        for (const point of points) {
            if (point.player === 0) {
                ctx.strokeStyle = "black";
                ctx.beginPath();
                ctx.moveTo(point.x / SCALE - SYMBOL_RADIUS, point.y / SCALE - SYMBOL_RADIUS);
                ctx.lineTo(point.x / SCALE + SYMBOL_RADIUS, point.y / SCALE + SYMBOL_RADIUS);
                ctx.moveTo(point.x / SCALE + SYMBOL_RADIUS, point.y / SCALE - SYMBOL_RADIUS);
                ctx.lineTo(point.x / SCALE - SYMBOL_RADIUS, point.y / SCALE + SYMBOL_RADIUS);
                ctx.stroke();
            } else {
                ctx.strokeStyle = "red";
                ctx.beginPath();
                ctx.arc(point.x / SCALE, point.y / SCALE, SYMBOL_RADIUS, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        if (game.getState() === GameState.ONGOING) {
            // ghost indicator for the current player's potential move
            const worldX = (mouse.x - this.translateX) / this.scale;
            const worldY = (mouse.y - this.translateY) / this.scale;

            if (currentPlayer === 0) {
                ctx.strokeStyle = "black";
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.moveTo(worldX - SYMBOL_RADIUS, worldY - SYMBOL_RADIUS);
                ctx.lineTo(worldX + SYMBOL_RADIUS, worldY + SYMBOL_RADIUS);
                ctx.moveTo(worldX + SYMBOL_RADIUS, worldY - SYMBOL_RADIUS);
                ctx.lineTo(worldX - SYMBOL_RADIUS, worldY + SYMBOL_RADIUS);
                ctx.stroke();
                ctx.globalAlpha = 1.0;
            } else {
                ctx.strokeStyle = "red";
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.arc(worldX, worldY, SYMBOL_RADIUS, 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = 1.0;
            }

            // green line if distance is below WIN_D_MAX
            const closestPoints = game.getClosestPlayerPoint(
                { x: worldX * SCALE, y: worldY * SCALE, player: currentPlayer }, 3,
            ) ?? [];
            for (const closestPoint of closestPoints) {
                const dx = closestPoint.x / SCALE - worldX;
                const dy = closestPoint.y / SCALE - worldY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance > WIN_D_MAX / SCALE) continue;
                ctx.strokeStyle = "green";
                ctx.beginPath();
                ctx.moveTo(worldX, worldY);
                ctx.lineTo(closestPoint.x / SCALE, closestPoint.y / SCALE);
                ctx.stroke();
            }
        } else {
            // draw a line between the winning points
            const winPoints = game.getWinPoints();
            const point1 = winPoints[0]!;
            const point2 = winPoints[1]!;
            ctx.strokeStyle = "green";
            ctx.beginPath();
            ctx.moveTo(point1.x / SCALE, point1.y / SCALE);
            ctx.lineTo(point2.x / SCALE, point2.y / SCALE);
            ctx.stroke();
        }

        // debug overlay — drawn in world coordinates (respects pan/zoom)
        this.debugDrawer.draw(ctx, game, this.canvas.width, this.canvas.height, this.translateX, this.translateY, this.scale);

        // reset transform for screen-space elements
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        if (game.getState() !== GameState.ONGOING) {
            ctx.fillStyle = "black";
            ctx.font = "48px sans-serif";
            const text = game.getState() === GameState.WIN_0 ? "Player X wins!" : "Player O wins!";
            const textWidth = ctx.measureText(text).width;
            ctx.fillText(text, (this.canvas.width - textWidth) / 2, this.canvas.height / 2);
        }

        // mouse coords
        ctx.fillStyle = "black";
        ctx.font = "16px monospace";
        ctx.fillText(`Mouse: (${mouse.x}, ${mouse.y})`, 10, this.canvas.height - 10);
    }
}
