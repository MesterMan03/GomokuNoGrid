import {MAX_PLACEMENT_DISTANCE, SCALE, SYMBOL_RADIUS, WIN_D_MAX} from "./consts.ts";
import {Game, GameState, type Player} from "./game.ts";
import type {AI} from "./ai/types.ts";
import {EasyAI} from "./ai/easy.ts";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const modeSelect = document.getElementById("mode-select") as HTMLDivElement;

let game = new Game();
let ai: AI | null = null;
let aiThinking = false;

const indicatorCanvas = document.createElement("canvas");
indicatorCanvas.width = canvas.width;
indicatorCanvas.height = canvas.height;
const indicatorCtx = indicatorCanvas.getContext("2d")!;

let currentPlayer: Player = 0;

let translateX = 0;
let translateY = 0;
let scale = 1;
const scaleAmount = 1.05;

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

const mouse = { x: 0, y: 0 };

const PAN_SPEED = 10;
const activePanKeys = new Set<string>();

const PAN_UP = new Set(["KeyW", "ArrowUp"]);
const PAN_DOWN = new Set(["KeyS", "ArrowDown"]);
const PAN_LEFT = new Set(["KeyA", "ArrowLeft"]);
const PAN_RIGHT = new Set(["KeyD", "ArrowRight"]);

function isAnyPressed(keys: Set<string>) {
    for (const key of keys) {
        if (activePanKeys.has(key)) return true;
    }
    return false;
}

function draw() {
    const moveUp = isAnyPressed(PAN_UP);
    const moveDown = isAnyPressed(PAN_DOWN);
    const moveLeft = isAnyPressed(PAN_LEFT);
    const moveRight = isAnyPressed(PAN_RIGHT);

    let panX = 0;
    let panY = 0;

    if (moveUp) panY += PAN_SPEED;
    if (moveDown) panY -= PAN_SPEED;
    if (moveLeft) panX += PAN_SPEED;
    if (moveRight) panX -= PAN_SPEED;

    if (panX !== 0 && panY !== 0) {
        const invDiag = 1 / Math.SQRT2;
        panX *= invDiag;
        panY *= invDiag;
    }

    translateX += panX;
    translateY += panY;

    ctx.setTransform(scale, 0, 0, scale, translateX, translateY);
    ctx.clearRect(
        -translateX / scale,
        -translateY / scale,
        canvas.width / scale,
        canvas.height / scale
    );

    // background
    ctx.fillStyle = "white";
    ctx.fillRect(-translateX / scale,
        -translateY / scale,
        canvas.width / scale,
        canvas.height / scale);

    const points = game.getPoints();

    // draw placement indicator
    indicatorCtx.fillStyle = "aqua";
    for(const point of points) {
        indicatorCtx.beginPath();
        indicatorCtx.arc(point.x / SCALE, point.y / SCALE, MAX_PLACEMENT_DISTANCE, 0, Math.PI * 2);
        indicatorCtx.fill();
    }

    indicatorCtx.fillStyle = "white";
    for(const point of points) {
        indicatorCtx.beginPath();
        indicatorCtx.arc(point.x / SCALE, point.y / SCALE, SYMBOL_RADIUS * 2, 0, Math.PI * 2);
        indicatorCtx.fill();
    }

    ctx.globalAlpha = 0.4;
    ctx.drawImage(indicatorCanvas, 0, 0);
    ctx.globalAlpha = 1.0;

    // draw all points
    for(const point of points) {
        // for player 0, draw an x, for player 1, draw an arc
        if(point.player === 0) {
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

    if(game.getState() === GameState.ONGOING) {
        // draw a ghost indicator for the current player's potential move
        const worldX = (mouse.x - translateX) / scale;
        const worldY = (mouse.y - translateY) / scale;

        if(currentPlayer === 0) {
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

        // draw a green line if the distance is below WIN_D_MAX
        const closestPoints = game.getClosestPlayerPoint({ x: worldX * SCALE, y: worldY * SCALE, player: currentPlayer }, 3) ?? [];
        for(const closestPoint of closestPoints) {
            const dx = closestPoint.x / SCALE - worldX;
            const dy = closestPoint.y / SCALE - worldY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if(distance > WIN_D_MAX / SCALE) {
                continue;
            }
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

        // write a big text in the middle of the screen saying which player won
        ctx.setTransform(1,0,0,1,0,0);
        ctx.fillStyle = "black";
        ctx.font = "48px sans-serif";
        const text = game.getState() === GameState.WIN_0 ? "Player X wins!" : "Player O wins!";
        const textWidth = ctx.measureText(text).width;
        ctx.fillText(text, (canvas.width - textWidth) /2, canvas.height /2);
    }

    // write the mouse x and y in the bottom left corner
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = "black";
    ctx.font = "16px monospace";
    ctx.fillText(`Mouse: (${mouse.x}, ${mouse.y})`, 10, canvas.height - 10);

    requestAnimationFrame(draw);
}

// ---------- ZOOM TO MOUSE ----------
canvas.addEventListener("wheel", (event) => {
    event.preventDefault();

    const mouseX = event.offsetX;
    const mouseY = event.offsetY;

    const zoom = event.deltaY < 0 ? scaleAmount : 1 / scaleAmount;

    const newScale = Math.min(Math.max(scale * zoom, MIN_SCALE), MAX_SCALE);

    // Adjust translation so zoom is centered on mouse
    translateX = mouseX - (mouseX - translateX) * (newScale / scale);
    translateY = mouseY - (mouseY - translateY) * (newScale / scale);

    scale = newScale;
});

// ---------- ARROW KEY PANNING ----------
window.addEventListener("keydown", (event) => {
    const code = event.code;
    if (PAN_UP.has(code) || PAN_DOWN.has(code) || PAN_LEFT.has(code) || PAN_RIGHT.has(code)) {
        activePanKeys.add(code);
        event.preventDefault();
    }
});

window.addEventListener("keyup", (event) => {
    const code = event.code;
    if (PAN_UP.has(code) || PAN_DOWN.has(code) || PAN_LEFT.has(code) || PAN_RIGHT.has(code)) {
        activePanKeys.delete(code);
        event.preventDefault();
    }
});

canvas.addEventListener("click", async (event) => {
    if (aiThinking) return; // ignore clicks while AI is computing

    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    const worldX = (screenX - translateX) / scale;
    const worldY = (screenY - translateY) / scale;

    const move = game.addMove(worldX, worldY, currentPlayer);
    if(!move) return; // if move is invalid, do not switch player

    currentPlayer = currentPlayer === 0 ? 1 : 0; // switch player

    // if playing against AI and it's the AI's turn
    if (ai && currentPlayer === 1 && game.getState() === GameState.ONGOING) {
        aiThinking = true;
        // small delay so the human can see their own move
        setTimeout(() => {
            const aiMove = ai!.getMove(game, 1);
            game.addMove(aiMove.x, aiMove.y, 1);
            currentPlayer = 0;
            aiThinking = false;
        }, 300);
    }
});

canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();

    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
});

// ---------- MODE SELECTION ----------
modeSelect.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.tagName !== "BUTTON") return;
    const mode = target.dataset["mode"];

    if (mode === "pvp") {
        ai = null;
    } else if (mode === "easy") {
        ai = new EasyAI();
    } else {
        return; // disabled modes
    }

    modeSelect.style.display = "none";
    canvas.style.display = "block";
    game = new Game();
    currentPlayer = 0;
    requestAnimationFrame(draw);
});