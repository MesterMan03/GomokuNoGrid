/** Small injectable RNG surface used to make AI decisions reproducible in tests and benchmarks. */
export interface RandomSource {
    next(): number;
}

export const SYSTEM_RANDOM: RandomSource = {
    next: () => Math.random(),
};

/** Deterministic Mulberry32 generator. Suitable for simulations, not cryptography. */
export class SeededRandom implements RandomSource {
    private state: number;

    constructor(seed: number) {
        this.state = seed >>> 0;
    }

    next(): number {
        let value = this.state += 0x6D2B79F5;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
    }
}

export function randomIndex(length: number, random: RandomSource): number {
    if (length <= 0) throw new RangeError("Cannot choose from an empty collection");
    return Math.floor(random.next() * length);
}
