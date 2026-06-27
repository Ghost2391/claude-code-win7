# AGENTS.md — OpenCode session guide

This repo is a **reverse-engineered / decompiled** Claude Code CLI. TypeScript strict, tsc must pass zero errors.

## Essential commands

```bash
bun install              # install dependencies (Bun, not npm/pnpm)
bun run dev              # dev mode with all features enabled
bun run build            # Bun.build → dist/cli.js + chunks
bun test                 # run all tests (bun:test framework)
bun test path/to/file.test.ts  # single test file
bun run typecheck        # tsc --noEmit strict check
bun run precheck         # final gate: typecheck + lint:fix + test
bun run lint:fix         # biome auto-fix
bun run format           # biome format all src/
```

## Critical constraints

- **Runtime**: Bun (not Node.js). All imports, builds, execution use Bun APIs. Build output also runs on Node.
- **Feature flags**: `import { feature } from 'bun:bundle'`. Only call in `if(...)` or ternary — **never** in arrow functions, `&&` chains, or assigned to variables (Bun compiler restriction). Enable with `FEATURE_<NAME>=1` env var.
- **React Compiler**: Decompiled components have `_c()` memoization boilerplate everywhere — this is normal, don't fight it.
- **Biome rules**: 42+ rules disabled for decompiled code. `.tsx` files: 120 col width + forced semicolons. Other files: 80 col, semicolons as-needed.
- **`@ts-expect-error`**: If tsc now passes the line, remove the directive. Keep when MACRO inlines produce permanent dead comparisons.
- **tsc vs Biome conflict**: If declaring a property for type correctness but Biome flags `noUnusedPrivateClassMembers`, suppress with `// biome-ignore lint/correctness/noUnusedPrivateClassMembers: <reason>`.
- **Configuration**: `.env` files are not supported. Use `settings.json` `env` field instead (in `~/.claude/settings.json` global or `.claude/settings.json` project-level).

## Architecture skeleton

- **Entry**: `src/entrypoints/cli.tsx` (fast paths for --version, --computer-use-mcp, daemon, bridge, etc.) → `src/main.tsx` (Commander.js CLI)
- **Core loop**: `src/query.ts` → `src/QueryEngine.ts` → `src/screens/REPL.tsx`
- **Ink UI**: `packages/@ant/ink/` (forked), not `src/ink/`. Components in `src/components/`.
- **Workspaces**: 19 packages in `packages/` resolved via `workspace:*`. Key ones: `builtin-tools/` (60 tools), `acp-link/`, `mcp-client/`, `agent-tools/`, `remote-control-server/`.
- **Path alias**: `src/` maps to `./src/` in tsconfig. `@claude-code-best/builtin-tools` → `./packages/builtin-tools/src/`.
- **MACRO defines**: Only edit `scripts/defines.ts` for version bumps / build constants.
- **Dist vendor resolution**: `src/utils/distRoot.ts` provides shared `distRoot()` via `import.meta.url` scanning. Vendor binaries (ripgrep, audio-capture) copy to `dist/vendor/` during build.

## Testing

- `bun:test` framework (built-in, no Jest/vitest)
- **Unit tests**: `src/**/__tests__/<module>.test.ts`. **Integration**: `tests/integration/`.
- **Shared mocks**: `tests/mocks/log.ts` and `tests/mocks/debug.ts` — import and use via `mock.module("src/utils/log.ts", logMock)`. Never inline mock these.
- **Mock rules**: mock only side-effect chains (log, debug, bun:bundle, settings, config, auth, network). Don't mock pure functions.
- **`mock.module` is process-global**: last-write-wins, not per-file. Mock HTTP layer (axios), not the business module above it. Same-directory tests share mock state — verify with `bun test path/to/suspect.test.ts` in isolation.

## FYI: existing relevant files

- `CLAUDE.md` — comprehensive reference (architecture, all commands, full workspace table, design context)
- `.impeccable.md` — design system context for Web UI work
- `docs/testing-spec.md` — detailed testing spec and coverage plans
- `.claude/agents/`, `.claude/skills/` — repo-local OpenCode agents and skills
- `docs/features/remote-control-self-hosting.md` — RCS deployment docs
