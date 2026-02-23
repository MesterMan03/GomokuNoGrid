export {};

declare global {
    interface Window {
        game: import("./index.ts").Game;
    }
}