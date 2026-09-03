# Architecture: settings bridge

The plugin's Web settings section is a thin form over `config.json`; this page
explains how the pieces connect and why the code looks the way it does.

## Data flow

```
Web settings panel ("任务拆解模式" section)
        │  client bundle (lib/client/index.js)
        │  connection.rpc.call('/task-runner', 'view' | 'mutate', payload)
        ▼
Host Connection RPC channel  /task-runner
        │  lib/index.js  apply() → connection.rpc.handle(...)
        ▼
config.json  (~/.dsh/.agent-presets/task-runner/config.json)
        │  read at session start by the task-runner persona
        ▼
task-runner agent preset (decompose → dispatch → synthesize)
```

`config.json` is deliberately the **single source of truth**: the persona reads
it at session start, so a save in the settings panel takes effect on the next
task-runner session without any extra wiring.

## Why `inject: ['connection']`

The Connection service is provided asynchronously: `@deepseek-ai/dsh-client-connection`
declares `inject: ['webRuntime']` and only provides `connection` once the web
runtime is up. A composition row that calls `ctx.get('connection')` inside
`apply()` can therefore read `undefined` during early boot and — if the code
silently returns — the bridge never mounts while the boot still succeeds
(requests then hit the SPA fallback as `HTTP 405`).

The fix is a hard dependency declaration:

```js
export const inject = ['connection'];
```

Cordis then re-applies the row once `connection` is provided, and `ctx.connection`
is guaranteed present inside `apply()`.

## Why `{ authority: 'loopback' }` is required

`connection.rpc.handle(channel, handler, options)` reads `options.authority`
immediately inside `register()`. Omitting the options object throws, which
again kills the bridge. `authority: 'loopback'` is also the right trust fence
here: only a loopback browser may edit the machine's local config.

## File map

| Path | Responsibility |
|---|---|
| `lib/index.js` | Host: preset bootstrap install + `/task-runner` RPC bridge (view/mutate, sanitize, persist) |
| `lib/client/index.js` | Browser: `settings.section` form (pre-built ModuleLoader bundle, no build step) |
| `presets/task-runner/` | The agent preset the roster mounts (`agent.cordis.yml` + `preset.yml` + `config.json`) |
| `test/index.test.js` | Host-logic unit tests (`DSH_HOME=$(mktemp -d) node --test test/index.test.js`) |
