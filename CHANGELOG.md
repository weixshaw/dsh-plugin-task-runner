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

## [0.3.0] — 2026-09-03

### Added
- **验收 + Replan 循环**（Planner → Worker → Reviewer → Replan）：每次收到 worker
  结果先过三问（信息够不够 / 有无报错 / 是否冲突），不过就返工——缺信息补拆、
  有错 repair（可走 fallback）、冲突派 reviewer 子任务交叉核对。
- **派活纪律**：子任务一旦派给 worker，主代理绝不自己执行（即使本地模型很慢）；
  等待只做计划与整理，超时走 Replan，不自己上手。
- 新配置：`maxReplanRounds`（返工上限，默认 2）、`workerTimeoutMinutes`（超时阈值，
  默认 30），设置面板同步新增两个字段。

### Fixed
- README 依赖声明修正：没有 dsh-plugin-subagent-director 时内置 `subagent` 无法
  路由到本地模型（无 provider/model 参数），本地路由会丢失。

## [0.4.0] — 2026-09-03

### Added
- **Worker 小结带宽预算 `maxWorkerResultTokens`**（默认 2000）：每个 worker 返回给
  主代理的小结 token 上限，超出部分必须落盘（小结只留路径+要点）。这是主代理
  上下文不随 worker 数量线性膨胀的关键防线（N×2K 封顶，而非 N×8K）。
- 设置面板新增对应字段；sanitize 边界 200–50000。

### Verified
- 上下文隔离实测通过：在父会话上下文放置 `THE_SECRET_CODE_IS_739251` 后派
  spawn worker，worker 完全无法感知该密钥（只看到自己的 prompt 与系统注入），
  确认子代理是全新会话、无历史透传。
- orchestrator 自动压缩确认在组合中就位：`compaction-basic` +
  `tool-result-pruner`（阈值 8192 字符）对工具结果（含子代理结果）做硬截断。

## [0.5.0] — 2026-09-03

### Added
- **状态落盘（外部记忆）**：`.task-runner/` 工作区目录成为长期记忆层——`state.json`
  / `tasks.json` / `findings/` / `artifacts/`。会话开始可恢复延续任务；worker 验收后、
  Replan、里程碑时写回状态；上下文变重时先落盘再只留紧凑摘要；结束时留 summary.md
  供下次接力。模型只负责当前推理，「记忆」交给结构化文件。
- **worker 上下文目标值**：maxWorkerContextTokens 明确为 ceiling 不是 target——普通
  worker 拆成 5–20K、复杂 20–30K 的工作单元，接近 40K 说明拆太大要再拆。

## [0.6.0] — 2026-09-03

### Added
- **`task_worker` 执行层强制工具**（仅任务拆解模式会话可见，通过 preset 挂载）：
  - **并发信号量**：超过 `maxConcurrentWorkers` 直接拒绝（`busy`），不再靠模型自觉；
  - **prompt 尺寸门禁**：派发前 token 估算，超 `maxWorkerContextTokens` 拒绝并提示
    「拆分或走 fallback」（按用户选择：拒绝，不自动切模型）；
  - **结果带宽硬截断**：worker 输出超 `maxWorkerResultTokens` 时 host 层保头截断，
    全文自动落盘 `.task-runner/artifacts/worker-<id>.txt` 并返回路径（截断不丢信息）。
- persona 派活改为：普通 worker 一律走 `task_worker`；reviewer/architect 等角色任务
  仍走 `subagent_role`；`busy`/超预算返回有明确的处置指令。
- 纯函数测试覆盖估算/截断/信号量（共 16 项，全过）。

### Verified
- 子代理契约核对：`ctx.subagents.start` + `settleRun`（result + dispose 双 allSettled）
  与 director 同源，`exec.agent`/`exec.signal`/`agentOptions` 用法一致。
