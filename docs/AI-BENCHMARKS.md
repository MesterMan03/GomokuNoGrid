# AI benchmark notes

## 2026-08-08 architecture baseline

Runtime: Bun 1.3.14 on Linux/x64, AMD EPYC 9V74, nine logical cores exposed to the process. Searches ran directly without browser worker parallelism. Each pairing alternated the first player, used a maximum of 40 moves, and used Insane's production 350 ms search budget.

The match harness returns `±1` for completed games and a bounded position fitness for unfinished games. The counts below therefore describe positive-fitness outcomes rather than claiming every sample ended in a win.

| Pairing | Samples | First AI positive | Second AI positive | Mean fitness for first AI |
|---|---:|---:|---:|---:|
| Normal vs Hard | 4 | 0 | 4 | -0.830 |
| Normal vs Insane | 12 across two seeds | 2 | 10 | -0.549 |
| Hard vs Insane | 12 across two seeds | 4 | 8 | -0.190 |

The two Insane validation seeds were `12648430` and `987654321`. Insane used a depth-two minimax prior with 128 virtual visits per root candidate, followed by adversarial MCTS for the remainder of the fixed deadline.

Representative direct-search latency on this runner:

| Difficulty | Typical move latency |
|---|---:|
| Easy | 1–3 ms |
| Normal | 10–20 ms |
| Hard | 14–25 ms |
| Insane | 353–359 ms |

These samples validate the intended ordering but are not a statistically final rating. Before calling the tuning stable, run at least 100 games per adjacent pairing across several seeds and test the production browser worker pool on representative desktop and mobile hardware. Record terminal wins separately from unfinished position fitness.

## Reproduction

```bash
bun run benchmark:ai --games=8 --max-moves=40 --seed=12648430
bun run benchmark:ai --difficulties=hard,insane --games=8 --max-moves=40 --seed=987654321
```
