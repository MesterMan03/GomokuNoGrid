import { SCALE } from "./consts.ts";
import { Game, GameState, type Player } from "./game.ts";
import type { AI } from "./ai/types.ts";
import { EasyAI } from "./ai/easy.ts";
import { MediumAI } from "./ai/medium.ts";
import { DebugDrawer } from "./debug.ts";
import { Renderer } from "./renderer.ts";
import { runEvolution, DEFAULT_EVOLUTION_PARAMS, type EvolutionParams } from "./ai/evolution.ts";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const modeSelect = document.getElementById("mode-select") as HTMLDivElement;
const trainingPanel = document.getElementById("training-panel") as HTMLDivElement;

let game = new Game();
let ai: AI | null = null;
let aiThinking = false;

const debugDrawer = new DebugDrawer();
const renderer = new Renderer(canvas, debugDrawer);

let currentPlayer: Player = 0;

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

    renderer.translateX += panX;
    renderer.translateY += panY;

    renderer.draw(game, currentPlayer, mouse);
    requestAnimationFrame(draw);
}

// ---------- ZOOM TO MOUSE ----------
canvas.addEventListener("wheel", (event) => {
    event.preventDefault();

    const mouseX = event.offsetX;
    const mouseY = event.offsetY;

    const zoom = event.deltaY < 0 ? scaleAmount : 1 / scaleAmount;

    const newScale = Math.min(Math.max(renderer.scale * zoom, MIN_SCALE), MAX_SCALE);

    renderer.translateX = mouseX - (mouseX - renderer.translateX) * (newScale / renderer.scale);
    renderer.translateY = mouseY - (mouseY - renderer.translateY) * (newScale / renderer.scale);

    renderer.scale = newScale;
});

// ---------- KEYBOARD ----------
window.addEventListener("keydown", (event) => {
    const code = event.code;

    if (code === "Backquote") {
        debugDrawer.toggle();
        event.preventDefault();
        return;
    }
    if (code === "KeyN") {
        if (debugDrawer.advance()) {
            event.preventDefault();
            return;
        }
    }
    // Debug toggle keys 1, 2, 3
    if (debugDrawer.enabled) {
        if (code === "Digit1") { debugDrawer.toggleSetting("showLineGroups"); event.preventDefault(); return; }
        if (code === "Digit2") { debugDrawer.toggleSetting("showWinEvaluation"); event.preventDefault(); return; }
        if (code === "Digit3") { debugDrawer.toggleSetting("showAIPhases"); event.preventDefault(); return; }
    }

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
    if (aiThinking) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    const worldX = (screenX - renderer.translateX) / renderer.scale;
    const worldY = (screenY - renderer.translateY) / renderer.scale;

    const move = game.addMove(worldX, worldY, currentPlayer);
    if (!move) return;

    currentPlayer = currentPlayer === 0 ? 1 : 0;

    if (ai && currentPlayer === 1 && game.getState() === GameState.ONGOING) {
        aiThinking = true;
        await new Promise(r => setTimeout(r, 300));

        const maxRetries = 5;
        let moveAccepted = false;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const aiMove = await ai!.getMove(game, 1);

            const phases = ai!.getLastDebugPhases?.() ?? [];
            if (phases.length > 0) {
                await debugDrawer.stepThroughPhases(phases);
            }

            if (game.addMove(aiMove.x, aiMove.y, 1)) {
                moveAccepted = true;
                break;
            }
        }

        if (!moveAccepted) {
            console.warn("AI failed to produce a valid move, placing random fallback.");
            const points = game.getPoints();
            for (let attempt = 0; attempt < 100; attempt++) {
                const target = points[Math.floor(Math.random() * points.length)]!;
                const angle = Math.random() * Math.PI * 2;
                const dist = 25 + Math.random() * 15;
                const fx = target.x / SCALE + Math.cos(angle) * dist;
                const fy = target.y / SCALE + Math.sin(angle) * dist;
                if (game.addMove(fx, fy, 1)) {
                    break;
                }
            }
        }

        currentPlayer = 0;
        aiThinking = false;
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
    } else if (mode === "normal") {
        ai = new MediumAI();
    } else if (mode === "training") {
        modeSelect.style.display = "none";
        trainingPanel.style.display = "block";
        return;
    } else {
        return; // disabled modes
    }

    modeSelect.style.display = "none";
    canvas.style.display = "block";
    game = new Game();
    currentPlayer = 0;
    requestAnimationFrame(draw);
});

// ---------- TRAINING UI ----------
const trainStartBtn = document.getElementById("train-start") as HTMLButtonElement;
const trainStopBtn = document.getElementById("train-stop") as HTMLButtonElement;
const trainLog = document.getElementById("train-log") as HTMLDivElement;
const trainResult = document.getElementById("train-result") as HTMLPreElement;

let trainAbort: AbortController | null = null;

trainStartBtn?.addEventListener("click", async () => {
    const params: EvolutionParams = {
        simsPerBatch: parseInt((document.getElementById("train-sims") as HTMLInputElement).value) || DEFAULT_EVOLUTION_PARAMS.simsPerBatch,
        batches: parseInt((document.getElementById("train-batches") as HTMLInputElement).value) || DEFAULT_EVOLUTION_PARAMS.batches,
        startingMoves: parseInt((document.getElementById("train-start-moves") as HTMLInputElement).value) || DEFAULT_EVOLUTION_PARAMS.startingMoves,
        extraMovesPerGen: parseInt((document.getElementById("train-extra-moves") as HTMLInputElement).value) || DEFAULT_EVOLUTION_PARAMS.extraMovesPerGen,
        mutationRate: parseFloat((document.getElementById("train-mutation-rate") as HTMLInputElement).value) || DEFAULT_EVOLUTION_PARAMS.mutationRate,
        mutationStrength: parseFloat((document.getElementById("train-mutation-strength") as HTMLInputElement).value) || DEFAULT_EVOLUTION_PARAMS.mutationStrength,
        eliteCount: DEFAULT_EVOLUTION_PARAMS.eliteCount,
        populationSize: DEFAULT_EVOLUTION_PARAMS.populationSize,
    };

    trainAbort = new AbortController();
    trainStartBtn.disabled = true;
    trainStopBtn.disabled = false;
    trainLog.innerHTML = "";
    trainResult.textContent = "Running...";

    try {
        const best = await runEvolution(params, (result) => {
            const line = document.createElement("div");
            line.textContent = result.log;
            trainLog.appendChild(line);
            trainLog.scrollTop = trainLog.scrollHeight;
        }, trainAbort.signal);

        trainResult.textContent = JSON.stringify(best, null, 2);
    } catch (e) {
        trainResult.textContent = `Error: ${e}`;
    } finally {
        trainStartBtn.disabled = false;
        trainStopBtn.disabled = true;
        trainAbort = null;
    }
});

trainStopBtn?.addEventListener("click", () => {
    trainAbort?.abort();
});

// Back button
document.getElementById("train-back")?.addEventListener("click", () => {
    trainingPanel.style.display = "none";
    modeSelect.style.display = "flex";
});