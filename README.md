# 🧩 dsh-plugin-task-runner — 任务拆解模式

> DeepSeek Harness 的「任务拆解模式」agent preset：主代理把大任务拆成独立子任务，派给子代理执行并综合结果。**每个子代理都在全新短上下文中独立干活**，所以即使本地模型只有 64K 上下文（如 48GB Mac 上 omlx 部署的 Qwen3.8-27B），也能处理很大的任务。并发数、worker 模型、超限 fallback 模型均可按机器自定义。

## 为什么需要它

本地大模型跑长上下文很容易内存溢出或质量崩坏。本模式的架构是：

```
用户大任务
  └─▶ 主代理（云端，负责拆解+综合，上下文只装「计划+结果摘要」）
        ├─▶ subagent 1（全新短上下文，默认本地模型）
        ├─▶ subagent 2（全新短上下文，默认本地模型）
        └─▶ ... 并发数受 maxConcurrentWorkers 限制
        └─▶ 汇总结果，交付最终答案
```

主代理的上下文只累积「计划 + 每个子代理返回的紧凑小结」，原始材料由各子代理在自己的短上下文里消化——整件事不需要任何单个上下文装下全部细节。

## 安装

```bash
dsh plugin --profile web add dsh-plugin-task-runner
```

安装后重启 web（或刷新页面），在模式选择器里选 **「任务拆解模式」** 即可。

安装时会自动把 preset 拷到 `~/.dsh/.agent-presets/task-runner/`（已存在则跳过，不会覆盖你的修改；想恢复出厂就删掉该目录再重启一次）。

## 配置（按机器自定义）

preset 目录下 `config.json`（或项目根目录放一份 `task-runner.config.json` 做项目级覆盖）：

```json
{
  "maxConcurrentWorkers": 1,
  "worker": {
    "provider": "omlx",
    "model": "root4k/Huihui-Qwen3.8-27B-abliterated-oQ4e-mtp"
  },
  "fallback": {
    "provider": "deepseek-official",
    "model": "deepseek-v4-flash"
  },
  "maxWorkerContextTokens": 40000,
  "maxReplanRounds": 2,
  "workerTimeoutMinutes": 30,
  "maxWorkerResultTokens": 2000
}
```

| 字段 | 含义 | 建议 |
|---|---|---|
| `maxConcurrentWorkers` | 同时运行的子代理数上限 | 内存小的机器设 **1**（严格串行）；内存充裕可设 2–3 |
| `worker.provider` / `worker.model` | 默认 worker 模型（本地优先） | 换成你本机可用的任意 pi-ai 路由 |
| `fallback.provider` / `fallback.model` | 子任务超出本地能力时改用的云端模型 | 建议留强模型兜底 |
| `maxWorkerContextTokens` | 本地 worker 上下文预算 | 本地模型 contextWindow 的 ~60–80% |
| `maxReplanRounds` | 每个子任务返工上限（验收不过→补拆/修复/复核） | 默认 2；0 = 一次通过就综合 |
| `workerTimeoutMinutes` | worker 超时阈值 | 默认 30；超时走 Replan，绝不自己上手 |
| `maxWorkerResultTokens` | **worker 小结带宽预算**：每个 worker 返回给主代理的上限 | 默认 2000，这是主上下文不随 worker 数线性膨胀的防线 |

会话开始时主代理会读取配置并汇报生效值（并发数 / worker / fallback），方便确认当前机器跑的是什么参数。

## 依赖

- DeepSeek Harness。**worker 按模型路由依赖 [dsh-plugin-subagent-director](https://github.com/SeverusZh/dsh-plugin-subagent-director)** 提供的 `subagent_role` 工具（它支持每次委派显式传 `provider/model`）。⚠️ 没有它时**无法**把 worker 路由到本地模型：内置 `subagent` 工具没有 provider/model 参数，退化后 worker 只会继承主会话路由（云端），本地路由丢失。此时要么装 director，要么改用 `workflow` 的 `agent(provider/model)` 显式指定本地模型。
- 本地模型走 OpenAI 兼容端点（如 omlx `http://127.0.0.1:8000/v1`），在 `settings.yaml` 的 `llm-pi-ai.providers` 里配置 provider。

## 开发

```
dsh-plugin-task-runner/
├── package.json          # npm 包清单（dsh.bundle.patch 指向 cordis.patch.yml）
├── cordis.patch.yml      # 注入 bootstrap 行
├── lib/index.js          # 启动时把 presets/ 拷进 ~/.dsh/.agent-presets/
└── presets/task-runner/  # 实际的 agent preset（agent.cordis.yml + preset.yml + config.json）
```

本地调试：`dsh plugin --profile web add link:/path/to/dsh-plugin-task-runner`

## 发布到插件市场

1. 建 GitHub 仓库 `dsh-plugin-task-runner`，把本目录推上去
2. 在仓库 **Topics** 添加 `dsh-plugin`（市场扫描器按此 topic 发现并收录）
3. （可选）`npm publish` 发布到 npm，别人就能 `dsh plugin add dsh-plugin-task-runner` 直接安装
4. 在仓库 Description 写清用途（评分含 description 质量），加 MIT License

## License

MIT

---

## v0.2.0：图形化设置界面

安装/更新后，在 Web 界面的 **设置 → 任务拆解模式** 页面可以可视化配置：

- **同时运行的子代理数**（并发上限，1–8）
- **全本地模式开关**：勾选后主代理（拆解器）也使用 worker 模型
- **worker / fallback / orchestrator 的 provider + model**
- **worker 上下文预算**（tokens）

保存即写入 `~/.dsh/.agent-presets/task-runner/config.json`，下一个任务拆解模式会话生效（无需重启、无需改 JSON）。

> 全本地模式提示：勾选后仍需把「该会话的模型」在模型选择器里手动切到本地模型，拆解器才会真的跑在本地（persona 会自动检测并进入全本地纪律）。

配置也可继续直接编辑 `config.json`（或项目根目录放 `task-runner.config.json` 做项目级覆盖），优先级：项目覆盖 > 本机 config.json。

## FAQ / 排查

- **设置页显示「读取配置失败：HTTP 405」**：桥接未挂载。升级到 v0.2.2+ 并重启应用即可；若仍出现，检查启动终端有无 `[task-runner]` 相关报错。
- **改了并发但没生效**：配置在**下一个任务拆解模式会话**开始时读取，当前会话不受影响；也可以直接在 `~/.dsh/.agent-presets/task-runner/config.json` 改。
- **本地 worker 又内存溢出了**：把「同时运行的子代理数」降到 1（严格串行），或在项目根目录放 `task-runner.config.json` 里的 `maxConcurrentWorkers: 1`。
- **全本地模式没生效**：除了勾选开关，还要把**该会话的模型**在模型选择器里手动切到本地模型——persona 检测到后才会进入全本地纪律。

## 上下文隔离：已实测验证

v0.4.0 起附带实测结论：在父会话上下文放置密钥 `THE_SECRET_CODE_IS_739251` 后
派 spawn worker，worker 完全无法感知该密钥——子代理是**全新会话**（只有自己的
prompt + 系统注入），父会话历史不传递。配合两条防线：

- **语义预算** `maxWorkerResultTokens`：worker 小结 ≤2K token，超限落盘只回路径；
- **硬截断** `tool-result-pruner`（composition 自带，阈值 8192 字符）：无论 worker
  返回多长，主代理实际收到的工具结果都会被 head/tail 截断。

orchestrator 侧自动压缩（`compaction-basic`）同样由 composition 提供，长任务下
主代理上下文不会线性膨胀。
