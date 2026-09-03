# Changelog

All notable changes to dsh-plugin-task-runner.

## [0.2.2] — 2026-09-03

### Fixed
- **Settings bridge now actually mounts.** Two-layer fix:
  1. `connection.rpc.handle` requires the third `{ authority: 'loopback' }` options
     argument — omitting it throws inside `register()` and the bridge silently
     never mounted (settings page got `HTTP 405` on view/mutate).
  2. The Connection service is provided asynchronously (client-connection waits
     on `webRuntime`), so the plugin now declares `inject: ['connection']`
     instead of a plain `ctx.get('connection')` at apply time, which could read
     `undefined` during early boot and skip registration.
- Removed temporary diagnostic marker.

## [0.2.1] — 2026-09-03

### Fixed
- Pass the required `{ authority: 'loopback' }` to `connection.rpc.handle` so
  the `/task-runner` bridge registers (previous build silently skipped it).

## [0.2.0] — 2026-09-03

### Added
- **Graphical settings UI** in the Web settings panel (`settings.section`,
  "任务拆解模式"): concurrency cap, all-local (orchestrator = worker) switch,
  worker / fallback / orchestrator provider+model, worker context budget.
- Host `/task-runner` Connection RPC bridge (view/mutate) persisting to the
  preset's `config.json` — the single source of truth the persona reads.
- `orchestrator` config field + persona self-check via `{{model}}`: when the
  session runs on the configured orchestrator model (all-local mode), the
  orchestrator enters stricter context discipline.

## [0.1.0] — 2026-09-03

### Added
- "任务拆解模式" agent preset: main agent decomposes tasks, dispatches to
  subagents (default local model) and synthesizes results.
- `config.json` per-machine configuration (concurrency, worker, fallback,
  context budget), with per-project `task-runner.config.json` override.
- Bootstrap host plugin that idempotently installs the preset into
  `~/.dsh/.agent-presets/task-runner` (never overwrites user edits).
