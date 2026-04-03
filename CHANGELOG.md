# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0-alpha] - 2026-04-03

### ⚠️ Breaking Changes

- **Single package**: All packages (`@clawswarm/core`, `@clawswarm/bridge`, `@clawswarm/cli`) have been merged into a single `clawswarm` package. Update your imports:
  - Before: `import { ClawSwarm } from '@clawswarm/core'`
  - After: `import { ClawSwarm } from 'clawswarm'`
- `clawswarm init` is now an interactive wizard — use `--yes` to skip prompts and use defaults

### Added

- **`clawswarm run "<goal>"` CLI command** — Execute any goal directly from the terminal. Reads `clawswarm.config.ts` from CWD (or uses defaults). Shows real-time progress and prints deliverables at the end.
  ```bash
  clawswarm run "Research the top 5 AI frameworks in 2026"
  ```
- **Interactive `clawswarm init` wizard** — Powered by `enquirer`. Guides users through:
  - Project name selection
  - LLM provider multi-select (Anthropic, OpenAI, Google)
  - Default model per provider
  - Bridge server configuration
  - API key collection with live validation (test calls to provider APIs)
  - Generates `.env` with actual keys (not just `.env.example`)
  - Generates `clawswarm.config.ts` based on selections
  - Runs `npm init -y` + `npm install clawswarm` if no `package.json` exists
- **Single-package architecture** — Entire codebase (core + bridge + CLI) consolidated into `src/` at repo root
  - `src/core/` — Agent, ClawSwarm, ChiefReviewer, GoalManager, TaskManager
  - `src/bridge/` — BridgeServer, TaskRouter
  - `src/cli/` — CLI entry point and commands
  - `src/index.ts` — unified public API entry point
- **Vitest config** at repo root replacing per-package configs
- **Simplified CI** — single `npm ci` + `npm run build` + `npm test` (no workspace orchestration)

### Removed

- Monorepo workspace structure (`packages/` directory)
- `@clawswarm/core`, `@clawswarm/bridge`, `@clawswarm/cli` package names (replaced by `clawswarm`)
- Turborepo cache step in CI (no longer needed for single package)

---

## [0.2.0-alpha] - 2026-04-03

### ⚠️ Breaking Changes

- `swarm.execute()` now accepts a goal object directly instead of requiring `swarm.createGoal()` first
- Bridge server auth configuration changed from hardcoded tokens to environment-variable-based (`BRIDGE_AUTH_TOKENS`)
- Minimum Node.js version is now 18.x (dropped 16.x support)

### Added

- **Hierarchical Chief Review System** — 3-tier quality gate with configurable thresholds:
  - Score ≥ 8: auto-approve
  - Score 5–7: human review escalation
  - Score < 5: auto-reject with rework feedback
  - Configurable `maxReworkCycles` (default: 3)
- **Bridge Health Endpoint** — `GET /health` and `/healthz` on configurable `healthPort` (default: WS port + 1)
- **Graceful Shutdown** — bridge handles SIGTERM/SIGINT cleanly: drains WebSocket connections, flushes pending messages, force-terminates after timeout
- **Connection Limits** — configurable `maxConnections` with automatic rejection when limit is reached
- **Comprehensive Test Suite** — 166 tests across 6 test files covering agent, chief, goal, task, swarm, and integration scenarios
- **GitHub Actions CI** — automated build, lint, and test on Node 18/20/22 matrix for every push and PR
- **Examples with READMEs** — each example directory now includes a README explaining what it demonstrates and how to run it
- **Bridge Realtime Example** — new `examples/bridge-realtime/` showing WebSocket-based live agent monitoring
- **Community Templates** — issue templates (bug report, feature request), PR template, and SECURITY.md
- **`.env.example`** — documents all configuration environment variables across packages
- **Cost Tracking** — per-agent, per-task token usage and cost monitoring
- **Typed Event System** — fully typed `BridgeServerEvents` for monitoring, logging, and custom integrations

### Changed

- README completely overhauled with mermaid architecture diagram, quick start guide, and feature highlights
- Bridge auth is now environment-variable-driven (`BRIDGE_AUTH_TOKENS` comma-separated) instead of hardcoded
- All configuration options can be set via environment variables (see `.env.example`)
- ESLint config updated to support `destructuredArrayIgnorePattern` for cleaner iteration code
- `.gitignore` hardened: covers `.env*`, `*.tsbuildinfo`, `coverage/`, `.turbo/`

### Fixed

- Bridge `healthPort` type error — was `undefined` when `Required<>` type demanded `number`; now defaults to `port + 1`
- Unused variable lint errors in bridge graceful shutdown loops

## [0.1.0-alpha] - 2026-03-17

### Added

- Initial release of `@clawswarm/core` — multi-agent orchestration engine
- Initial release of `@clawswarm/bridge` — WebSocket bridge for agent communication
- Initial release of `@clawswarm/cli` — project scaffolding and bridge management
- Agent types: Research, Code, Ops with configurable models
- Goal decomposition and task assignment pipeline
- Basic chief review scoring
- Monorepo structure with npm workspaces

[0.2.0-alpha]: https://github.com/trietphan/clawswarm/compare/v0.1.0-alpha...v0.2.0-alpha
[0.1.0-alpha]: https://github.com/trietphan/clawswarm/releases/tag/v0.1.0-alpha
