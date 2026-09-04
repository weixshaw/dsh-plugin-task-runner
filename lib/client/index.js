// dsh-plugin-task-runner — Web settings section (Task Runner 任务拆解模式).
//
// Pre-built client bundle in the DSH ModuleLoader format. Renders a
// settings.section form that edits the preset's config.json through the
// /task-runner Connection RPC channel (view/mutate). No build step: written
// as plain JS using React.createElement (no JSX).
window.__ModuleLoader__.load({
  id: "dsh-plugin-task-runner",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { useState, useEffect, useCallback } = React;

    const CHANNEL = "/task-runner";

    const FIELD_LABELS = {
      maxConcurrentWorkers: "同时运行的子代理数（并发上限）",
      worker: "子代理默认模型（worker）",
      fallback: "超限 fallback 模型",
      orchestrator: "主代理（拆解器）模型",
      maxWorkerContextTokens: "worker 上下文预算（tokens）",
    };

    const inputStyle = {
      width: "100%",
      boxSizing: "border-box",
      padding: "6px 8px",
      borderRadius: 6,
      border: "1px solid var(--border, #444)",
      background: "var(--bg-2, #1c1c1c)",
      color: "var(--fg, #eee)",
      fontSize: 13,
    };
    const labelStyle = {
      display: "block",
      fontSize: 12,
      color: "var(--fg-2, #999)",
      margin: "10px 0 4px",
    };
    const rowStyle = { display: "flex", gap: 8 };
    const colStyle = { flex: 1, minWidth: 0 };

    function TextField({ label, value, onChange, placeholder }) {
      return React.createElement(
        "label",
        { style: labelStyle },
        label,
        React.createElement("input", {
          style: inputStyle,
          type: "text",
          value: value || "",
          placeholder: placeholder || "",
          onChange: (e) => onChange(e.target.value),
        })
      );
    }

    function TaskRunnerSection({ rpc }) {
      const [config, setConfig] = useState(null);
      const [allLocal, setAllLocal] = useState(false);
      const [status, setStatus] = useState("");
      const [error, setError] = useState("");
      const [path, setPath] = useState("");

      const refresh = useCallback(() => {
        if (!rpc) return;
        rpc
          .call(CHANNEL, "view", {})
          .then((res) => {
            if (res && res.ok) {
              const cfg = res.config || {};
              setConfig(cfg);
              setPath(res.path || "");
              const o = cfg.orchestrator || {};
              setAllLocal(
                !!(o.provider && cfg.worker && o.provider === cfg.worker.provider && o.model === cfg.worker.model)
              );
            }
          })
          .catch((err) => setError(String(err && err.message ? err.message : err)));
      }, [rpc]);

      useEffect(() => {
        refresh();
      }, [refresh]);

      if (!rpc) {
        return React.createElement(
          "div",
          { style: { color: "#e88" } },
          "任务拆解模式设置桥接不可用（Connection RPC 通道未就绪）。请刷新页面或重启应用。"
        );
      }
      if (!config) {
        return React.createElement(
          "div",
          { style: { color: "var(--fg-2, #999)" } },
          error ? `读取配置失败：${error}` : "加载配置中…"
        );
      }

      const setWorker = (field, value) =>
        setConfig((c) => {
          const next = { ...c, worker: { ...(c.worker || {}), [field]: value } };
          if (allLocal) next.orchestrator = { provider: next.worker.provider, model: next.worker.model };
          return next;
        });
      const setFallback = (field, value) =>
        setConfig((c) => ({ ...c, fallback: { ...(c.fallback || {}), [field]: value } }));
      const setOrchestrator = (field, value) =>
        setConfig((c) => ({ ...c, orchestrator: { ...(c.orchestrator || {}), [field]: value } }));

      const toggleAllLocal = (checked) => {
        setAllLocal(checked);
        if (checked) {
          setConfig((c) => ({
            ...c,
            orchestrator: { provider: (c.worker || {}).provider, model: (c.worker || {}).model },
          }));
        }
      };

      const save = () => {
        setStatus("");
        setError("");
        rpc
          .call(CHANNEL, "mutate", { config })
          .then((res) => {
            if (res && res.ok) {
              setConfig(res.config);
              setStatus("已保存 ✓ 下次任务拆解模式会话生效。");
            } else {
              setError("保存失败：服务器未返回 ok。");
            }
          })
          .catch((err) => setError(String(err && err.message ? err.message : err)));
      };

      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { style: { fontSize: 13, color: "var(--fg-2, #999)", marginBottom: 4 } },
          "主代理（云端）拆解任务，子代理（默认本地模型）并行执行。改动保存到 ",
          React.createElement("code", null, path || "config.json"),
          "，下一个任务拆解模式会话生效。"
        ),

        React.createElement(
          "label",
          { style: labelStyle },
          FIELD_LABELS.maxConcurrentWorkers,
          React.createElement("input", {
            style: inputStyle,
            type: "number",
            min: 1,
            max: 8,
            value: config.maxConcurrentWorkers || 1,
            onChange: (e) =>
              setConfig((c) => ({ ...c, maxConcurrentWorkers: parseInt(e.target.value, 10) || 1 })),
          })
        ),

        React.createElement(
          "label",
          { style: { display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 13 } },
          React.createElement("input", {
            type: "checkbox",
            checked: allLocal,
            onChange: (e) => toggleAllLocal(e.target.checked),
          }),
          "全本地模式：主代理（拆解器）也用 worker 模型（注意：本会话需手动把模型切到本地才生效）"
        ),

        React.createElement(
          "div",
          { style: rowStyle },
          React.createElement(
            "div",
            { style: colStyle },
            React.createElement(TextField, {
              label: FIELD_LABELS.worker + " · provider",
              value: (config.worker || {}).provider,
              onChange: (v) => setWorker("provider", v),
              placeholder: "omlx",
            })
          ),
          React.createElement(
            "div",
            { style: colStyle },
            React.createElement(TextField, {
              label: FIELD_LABELS.worker + " · model",
              value: (config.worker || {}).model,
              onChange: (v) => setWorker("model", v),
              placeholder: "本地模型 id",
            })
          )
        ),

        React.createElement(
          "div",
          { style: rowStyle },
          React.createElement(
            "div",
            { style: colStyle },
            React.createElement(TextField, {
              label: FIELD_LABELS.fallback + " · provider",
              value: (config.fallback || {}).provider,
              onChange: (v) => setFallback("provider", v),
              placeholder: "deepseek-official",
            })
          ),
          React.createElement(
            "div",
            { style: colStyle },
            React.createElement(TextField, {
              label: FIELD_LABELS.fallback + " · model",
              value: (config.fallback || {}).model,
              onChange: (v) => setFallback("model", v),
              placeholder: "deepseek-v4-flash",
            })
          )
        ),

        React.createElement(
          "div",
          { style: rowStyle },
          React.createElement(
            "div",
            { style: colStyle },
            React.createElement(TextField, {
              label: FIELD_LABELS.orchestrator + " · provider",
              value: (config.orchestrator || {}).provider,
              onChange: (v) => setOrchestrator("provider", v),
              placeholder: "留空 = 跟随会话模型（云端）",
            })
          ),
          React.createElement(
            "div",
            { style: colStyle },
            React.createElement(TextField, {
              label: FIELD_LABELS.orchestrator + " · model",
              value: (config.orchestrator || {}).model,
              onChange: (v) => setOrchestrator("model", v),
              placeholder: "留空 = 跟随会话模型",
            })
          )
        ),

        React.createElement(
          "label",
          { style: labelStyle },
          FIELD_LABELS.maxWorkerContextTokens,
          React.createElement("input", {
            style: inputStyle,
            type: "number",
            min: 1000,
            step: 1000,
            value: config.maxWorkerContextTokens || 40000,
            onChange: (e) =>
              setConfig((c) => ({ ...c, maxWorkerContextTokens: parseInt(e.target.value, 10) || 40000 })),
          })
        ),

        React.createElement(
          "div",
          { style: rowStyle },
          React.createElement(
            "div",
            { style: colStyle },
            React.createElement(
              "label",
              { style: labelStyle },
              "每个子任务返工上限（maxReplanRounds）",
              React.createElement("input", {
                style: inputStyle,
                type: "number",
                min: 0,
                max: 5,
                value: config.maxReplanRounds === undefined ? 2 : config.maxReplanRounds,
                onChange: (e) =>
                  setConfig((c) => ({ ...c, maxReplanRounds: parseInt(e.target.value, 10) || 2 })),
              })
            )
          ),
          React.createElement(
            "div",
            { style: colStyle },
            React.createElement(
              "label",
              { style: labelStyle },
              "worker 超时（分钟）",
              React.createElement("input", {
                style: inputStyle,
                type: "number",
                min: 5,
                max: 240,
                value: config.workerTimeoutMinutes === undefined ? 30 : config.workerTimeoutMinutes,
                onChange: (e) =>
                  setConfig((c) => ({ ...c, workerTimeoutMinutes: parseInt(e.target.value, 10) || 30 })),
              })
            )
          )
        ),

        React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 12, marginTop: 14 } },
          React.createElement(
            "button",
            {
              onClick: save,
              style: {
                padding: "7px 18px",
                borderRadius: 6,
                border: "none",
                background: "var(--accent, #4a7dff)",
                color: "#fff",
                fontSize: 13,
                cursor: "pointer",
              },
            },
            "保存配置"
          ),
          status && React.createElement("span", { style: { color: "#6c6" } }, status),
          error && React.createElement("span", { style: { color: "#e88" } }, error)
        )
      );
    }

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      const connection = ctx.get("connection");
      const rpc = connection === undefined ? undefined : connection.rpc;
      slots.inject("settings.section", () =>
        slots.register(
          {
            name: "settings.section",
            id: "task-runner",
            order: 21,
            label: "任务拆解模式",
          },
          () => React.createElement(TaskRunnerSection, { rpc })
        )
      );
    }

    exports.name = "dsh-plugin-task-runner";
    exports.apply = apply;
    exports.inject = ["slots", "connection"];

    return module.exports;
  },
});
