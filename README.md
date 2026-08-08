# gomokunogrid

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run dev
```

## AI development

The difficulty contracts, worker model, and deterministic testing approach are documented in [docs/AI.md](docs/AI.md). Current measurements and reproduction commands are in [docs/AI-BENCHMARKS.md](docs/AI-BENCHMARKS.md).

```bash
bun run typecheck
bun test
bun run build
bun run benchmark:ai
```

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
