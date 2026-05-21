# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This is a monorepo with two main packages:

- **`packages/browseros-agent/`** — The AI agent server (TypeScript/Bun). This is the primary active development target. Has its own detailed `CLAUDE.md`.
- **`packages/browseros/`** — The Chromium fork build system (Python). Produces signed browser binaries. Requires ~100GB disk and full Chromium toolchain to build.

The agent package is itself a monorepo with Bun workspaces:
- `apps/server/` — MCP server, HTTP API, browser tools, ACL engine
- `apps/agent/` — Browser extension (sidebar/new tab UI)
- `apps/cli/` — `browseros-cli` command-line tool
- `apps/eval/` — Evaluation harness
- `packages/shared/` — Shared constants, types, ACL matchers
- `packages/cdp-protocol/` — CDP type definitions

## Common Commands

All commands run from `packages/browseros-agent/` using Bun:

```bash
# Development
bun run start                    # Start server (loads .env.dev)
bun run dev:watch                # Dev server with file watching

# Testing
bun run test                     # All tests (requires BrowserOS running)
bun run test:integration         # Integration tests
bun --env-file=.env.development test apps/server/tests/path/to/file.test.ts  # Single file

# Linting / type checking
bun run lint                     # Biome check
bun run lint:fix                 # Biome auto-fix
bun run typecheck                # TypeScript build check

# Build
bun run build                   # Build server + agent
bun run build:server            # Server only (all targets)
bun run build:agent             # Agent extension only
```

For the Chromium build system (`packages/browseros/`):
```bash
pip install -e .   # or: uv pip install -e .
python -m build    # Build CLI entry point
```

## Architecture

### Agent Server (`apps/server/src/`)

**Entry:** `index.ts` → `main.ts`

**Key layers:**
- `api/` — Hono HTTP server. Routes in `api/routes/`, business logic in `api/services/`
- `tools/` — MCP tool definitions. Each tool has a thin handler in `tools/` and browser implementation in `browser/`
- `browser/` — CDP-based browser primitives (DOM, snapshot, input, mouse, keyboard, history)
- `agent/` — AI agent loop (provider factory, session store, compaction, prompt construction)
- `lib/` — Cross-cutting utilities (logger, db, soul, identity, container/VM, port binding)
- `skills/` — Skills loading and execution
- `monitoring/` — Observability

**Tool execution flow:**
```
MCP client → HTTP (Hono) → tool handler (tools/) → ACL guard → browser layer (browser/) → CDP
```

### ACL Engine (`tools/acl/`)

Blocks guarded browser actions (click, fill, hover, etc.) against user-defined rules. Three-signal scoring pipeline: exact substring (25%) + fuzzy edit-distance (25%) + semantic embeddings via ONNX (50%). Threshold: confidence ≥ 0.4 blocks. Model: BAAI/bge-small-en-v1.5 (auto-downloaded, ~33MB). Override with `ACL_EMBEDDING_MODEL` env var.

### Chromium Fork (`packages/browseros/`)

Patches applied on top of ungoogled-chromium. Patch series in `series_patches/series` (plus platform variants). New files (not patches) in `chromium_files/`. The Python build CLI (`build/`) handles fetch → patch → compile → sign → package.

## Docs Image Workflow

When updating documentation with new screenshots:

1. Prompt the user to copy the image to their clipboard (Cmd+C)
2. Run: `python scripts/save_clipboard.py <target_path>`
3. Example: `python scripts/save_clipboard.py docs/images/agent-step.png`
