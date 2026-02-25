export {};

declare global {
    interface Window {
        game: import("./game.ts").Game;
    }
}