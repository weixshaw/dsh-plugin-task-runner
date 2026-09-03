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
  "maxWorkerContextTokens": 40000
}
```

| 字段 | 含义 | 建议 |
|---|---|---|
| `maxConcurrentWorkers` | 同时运行的子代理数上限 | 内存小的机器设 **1**（严格串行）；内存充裕可设 2–3 |
| `worker.provider` / `worker.model` | 默认 worker 模型（本地优先） | 换成你本机可用的任意 pi-ai 路由 |
| `fallback.provider` / `fallback.model` | 子任务超出本地能力时改用的云端模型 | 建议留强模型兜底 |
| `maxWorkerContextTokens` | 本地 worker 上下文预算 | 本地模型 contextWindow 的 ~60–80% |

会话开始时主代理会读取配置并汇报生效值（并发数 / worker / fallback），方便确认当前机器跑的是什么参数。

## 依赖

- DeepSeek Harness（`subagent_role` 工具来自 [dsh-plugin-subagent-director](https://github.com/SeverusZh/dsh-plugin-subagent-director)，建议一并安装；没有它本模式退化为用内置 `subagent`，路由遵循调用参数仍可用）。
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
