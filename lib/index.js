// dsh-plugin-task-runner v0.2.0
//
// 1) Bootstrap: on host start, installs the bundled `presets/task-runner` agent
//    preset into <dshHome>/.agent-presets/task-runner when absent. Idempotent —
//    never overwrites an existing preset directory (delete it to reinstall).
// 2) Settings bridge: a `/task-runner` Connection RPC channel (view/mutate) that
//    backs the graphical settings section in the Web settings panel. The JSON
//    config file under the preset directory stays the single source of truth so
//    the task-runner persona (which reads config.json at session start) always
//    sees the latest values.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const name = 'dsh-plugin-task-runner';

/** The dsh home directory (defaults to ~/.dsh, honors DSH_HOME). */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/** Where the bundled preset lives inside this package. */
export function presetSource() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'presets', 'task-runner');
}

/** Where the preset is installed for the roster to discover. */
export function presetDestination() {
  return join(dshHome(), '.agent-presets', 'task-runner');
}

/** The config file the persona reads at session start. */
export function configPath() {
  return join(presetDestination(), 'config.json');
}

/** Fallback values used when config.json is missing or partially malformed. */
export const DEFAULTS = Object.freeze({
  maxConcurrentWorkers: 1,
  orchestrator: { provider: '', model: '' },
  worker: { provider: 'omlx', model: 'root4k/Huihui-Qwen3.8-27B-abliterated-oQ4e-mtp' },
  fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  maxWorkerContextTokens: 40000,
});

/** Read the installed config, or the defaults when absent/unreadable. */
export function readConfig() {
  try {
    const raw = readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/** Validate + coerce one incoming config payload into a safe shape. */
export function sanitizeConfig(input) {
  const cfg = {
    maxConcurrentWorkers: DEFAULTS.maxConcurrentWorkers,
    orchestrator: { ...DEFAULTS.orchestrator },
    worker: { ...DEFAULTS.worker },
    fallback: { ...DEFAULTS.fallback },
    maxWorkerContextTokens: DEFAULTS.maxWorkerContextTokens,
  };
  if (input && typeof input === 'object') {
    if (Number.isInteger(input.maxConcurrentWorkers) && input.maxConcurrentWorkers >= 1 && input.maxConcurrentWorkers <= 8) {
      cfg.maxConcurrentWorkers = input.maxConcurrentWorkers;
    }
    if (Number.isInteger(input.maxWorkerContextTokens) && input.maxWorkerContextTokens >= 1000 && input.maxWorkerContextTokens <= 1000000) {
      cfg.maxWorkerContextTokens = input.maxWorkerContextTokens;
    }
    for (const key of ['orchestrator', 'worker', 'fallback']) {
      const src = input[key];
      if (src && typeof src === 'object') {
        cfg[key] = {
          provider: typeof src.provider === 'string' ? src.provider.trim() : '',
          model: typeof src.model === 'string' ? src.model.trim() : '',
        };
      }
    }
  }
  return cfg;
}

/** Persist a sanitized config back to config.json. */
export function writeConfig(cfg) {
  const dest = presetDestination();
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  return cfg;
}

export function apply(ctx) {
  // 1) Install the bundled preset when the target does not exist yet.
  const source = presetSource();
  const dest = presetDestination();
  if (existsSync(source)) {
    try {
      if (!existsSync(dest)) {
        mkdirSync(dest, { recursive: true });
        cpSync(source, dest, { recursive: true });
        ctx.logger.info(`[task-runner] installed agent preset to ${dest}`);
      }
    } catch (error) {
      ctx.logger.warn(`[task-runner] failed to install agent preset: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 2) Settings bridge backing the Web settings section. Headless profiles have
  //    no Connection service, in which case the section simply never mounts.
  const connection = ctx.get('connection');
  if (connection === undefined) return;
  // authority: 'loopback' — only the loopback browser may edit this machine's
  // local config. The options argument is REQUIRED: register() reads
  // options.authority immediately, so omitting it throws and the bridge never
  // mounts (the settings page then gets HTTP 405 from the SPA fallback).
  connection.rpc.handle(
    '/task-runner',
    async (endpoint, payload) => {
      if (endpoint === 'view') {
        return { ok: true, config: readConfig(), path: configPath() };
      }
      if (endpoint === 'mutate') {
        const cfg = sanitizeConfig(payload?.config);
        writeConfig(cfg);
        return { ok: true, config: cfg };
      }
      throw new Error(`unknown endpoint ${endpoint}`);
    },
    { authority: 'loopback' }
  );
}
