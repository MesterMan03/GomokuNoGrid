# AI architecture

The four difficulties share the same non-negotiable tactical contract: return a legal move, never mutate the supplied `Game`, take an immediate win, and block a unique loss in one. Difficulty changes planning depth and predictability rather than allowing basic rule failures.

## Difficulty ladder

- **Easy** uses tactical candidate generation, noisy heuristic scoring, and randomized top-candidate selection. It remains intentionally fallible after forced one-ply tactics are handled.
- **Normal** ranks tactical candidates and evaluates them with a fixed-depth alpha-beta minimax search.
- **Hard** adds threat tiers, selective extensions, quiescence search, fork evaluation, and a node budget. Its worker and local paths receive the same root search depth.
- **Insane** uses adversarial MCTS with guided rollouts and shallow deterministic minimax priors. The prior supplies tactical grounding while MCTS explores longer continuations. AI nodes maximize AI reward, opponent nodes minimize it, and independent worker trees are combined by summing root visits and rewards before selecting the robust child.

`src/ai/factory.ts` owns difficulty construction and configuration normalization. UI, evolution, workers, tests, and benchmarks should use it instead of maintaining separate difficulty switches.

## Determinism

AI implementations accept a `RandomSource`. Production defaults to `Math.random`; tests and benchmarks use `SeededRandom`. MCTS tests should set `searchTimeMs` to `0` so `maxIterations`, rather than machine timing, controls the run.

## Workers

Normal and Hard distribute root candidates to dedicated minimax workers. Insane sends the complete position to every MCTS worker. Workers return per-root visit and reward statistics; the pool aggregates matching moves across trees. A failed MCTS worker is tolerated as long as another worker completes.

`WorkerRpcClient` provides request correlation, timeout handling, and immediate rejection of pending requests during termination. Worker-backed execution must preserve the same search semantics as direct execution.

## Verification

```bash
bun run typecheck
bun test
bun run build
bun run benchmark:ai --games=4 --max-moves=50 --seed=12648430
```

Benchmark reports must state the CPU, browser/runtime, worker count, MCTS time budget, seed, games per pairing, and maximum moves. Compare both move latency and seeded head-to-head fitness; a faster search is not an improvement if playing strength regresses.
