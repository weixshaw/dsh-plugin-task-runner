// dsh-plugin-task-runner /worker — the execution-enforced delegation tool.
//
// `task_worker` is a model-facing tool mounted ONLY by the task-runner preset,
// turning three budgets from prompt discipline into execution-level facts:
//
//   1. Concurrency cap  (maxConcurrentWorkers)  — a real per-session semaphore;
//      dispatching beyond the cap returns a `busy` refusal, not a silent start.
//   2. Prompt size gate (maxWorkerContextTokens) — the prompt is token-estimated
//      before start; an over-budget prompt is refused with a "split or fallback"
//      instruction (the user-chosen behavior: refuse, never auto-switch models).
//   3. Result budget    (maxWorkerResultTokens) — the worker's final output is
//      head-truncated at the host before the orchestrator ever sees it, and the
//      full text is persisted to `.task-runner/artifacts/worker-<id>.txt` so no
//      information is lost (truncation = bandwidth control, not data loss).
//
// Ordinary workers should go through this tool; role-templated reviewer /
// architect tasks may still use `subagent_role`.
import { defineTool } from '@deepseek-ai/dsh-tools';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const name = 'dsh-plugin-task-runner/worker';
export const inject = ['tools', 'subagents'];

const TOOL_NAME = 'task_worker';
const PROVIDER = 'spawn';

/** Fallback configuration when config.json is unreadable. */
export const DEFAULTS = Object.freeze({
  maxConcurrentWorkers: 1,
  worker: { provider: 'omlx', model: 'root4k/Huihui-Qwen3.8-27B-abliterated-oQ4e-mtp' },
  fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  maxWorkerContextTokens: 40000,
  maxReplanRounds: 2,
  workerTimeoutMinutes: 30,
  maxWorkerResultTokens: 2000,
});

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

export function configPath() {
  return join(dshHome(), '.agent-presets', 'task-runner', 'config.json');
}

export function readConfig() {
  try {
    const raw = readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...DEFAULTS, ...parsed } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Rough token estimator: CJK characters count ~1 token each, other characters
 * ~1 token per 4. Good enough for enforcement gates; not a billing meter.
 */
export function estimateTokens(text) {
  let cjk = 0;
  let ascii = 0;
  for (const ch of String(text)) {
    if (ch.codePointAt(0) > 0x2e80) cjk += 1;
    else ascii += 1;
  }
  return Math.ceil(cjk + ascii / 4);
}

/** Join the text blocks of a subagent result output. */
export function outputToText(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/** Head-truncate `text` to roughly `budgetTokens` tokens, returning [head, truncated]. */
export function truncateHead(text, budgetTokens) {
  const maxChars = Math.max(200, Math.floor(budgetTokens * 3));
  if (text.length <= maxChars) return [text, false];
  return [text.slice(0, maxChars), true];
}

/**
 * Per-session concurrency semaphore. Keyed by the calling agent's session id;
 * counts are decremented when a run settles (result resolved + disposed).
 */
export function createSemaphore() {
  const active = new Map();
  return {
    /** Try to acquire a slot. Returns a release function, or `null` at cap. */
    acquire(sessionKey, max) {
      const current = active.get(sessionKey) ?? 0;
      if (current >= max) return null;
      active.set(sessionKey, current + 1);
      return () => {
        const n = (active.get(sessionKey) ?? 1) - 1;
        if (n <= 0) active.delete(sessionKey);
        else active.set(sessionKey, n);
      };
    },
    count(sessionKey) {
      return active.get(sessionKey) ?? 0;
    },
  };
}

/** Settle a run (await result + always dispose) without swallowing a result failure. */
export async function settleRun(run) {
  const [execution] = await Promise.allSettled([run.result]);
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())]);
  if (execution.status === 'rejected') {
    throw disposal.status === 'rejected' ? new AggregateError([execution.reason, disposal.reason]) : execution.reason;
  }
  if (disposal.status === 'rejected') throw disposal.reason;
  return execution.value;
}

export function apply(ctx) {
  const semaphore = createSemaphore();

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: TOOL_NAME,
          description:
            'Dispatch one subtask to a worker subagent with execution-level enforcement: ' +
            'concurrency cap (maxConcurrentWorkers, refuses when busy), prompt size gate ' +
            '(maxWorkerContextTokens, refuses over-budget prompts with a "split or fallback" hint) ' +
            'and result token budget (maxWorkerResultTokens — the returned text is head-truncated and ' +
            'the full output is saved to .task-runner/artifacts/). Use for ordinary workers; use ' +
            'subagent_role for role-templated reviewer/architect tasks. This call waits for the worker.',
          parameters: {
            description: { type: 'string', required: true, description: 'A short (3-5 word) description of the delegated task, for display.' },
            prompt: { type: 'string', required: true, description: 'The complete, self-contained task for the worker. The worker does not share this conversation, so include everything it needs — keep it within maxWorkerContextTokens.' },
            provider: { type: 'string', description: 'Worker provider override (default: the configured worker provider).' },
            model: { type: 'string', description: 'Worker model id override (default: the configured worker model).' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ok: { type: 'boolean', required: true },
                text: { type: 'string' },
                message: { type: 'string' },
                artifactPath: { type: 'string' },
                active: { type: 'number' },
                max: { type: 'number' },
              },
            },
            render: (_args, value) => [
              { type: 'text', text: value.ok ? value.text : `[task_worker] ${value.message}` },
            ],
          },
          isConcurrencySafe: () => true,
          async execute(args, exec) {
            const parent = exec.agent;
            if (!parent) throw new Error('task_worker requires a calling agent (exec.agent was undefined)');
            const cfg = readConfig();
            const worker = cfg.worker ?? DEFAULTS.worker;
            const sessionKey = String(parent.session?.id ?? parent.id ?? 'global');
            const active = semaphore.count(sessionKey);

            // 1) Prompt size gate — refuse, never auto-switch models.
            const promptTokens = estimateTokens(args.prompt);
            if (promptTokens > cfg.maxWorkerContextTokens) {
              return {
                ok: false,
                message: `prompt ~${promptTokens} tokens exceeds maxWorkerContextTokens (${cfg.maxWorkerContextTokens}). Split the subtask into smaller work units (target 5–20K), or run it through the fallback provider explicitly.`,
                active,
                max: cfg.maxConcurrentWorkers,
              };
            }

            // 2) Concurrency cap — refuse when busy.
            const release = semaphore.acquire(sessionKey, cfg.maxConcurrentWorkers);
            if (release === null) {
              return {
                ok: false,
                message: `at concurrency cap (${active}/${cfg.maxConcurrentWorkers}). Wait for a current worker to finish before dispatching the next one.`,
                active,
                max: cfg.maxConcurrentWorkers,
              };
            }

            const cwd = parent.session?.cwd ?? parent.options?.cwd ?? process.cwd();
            try {
              const provider = ctx.subagents.getProvider(PROVIDER);
              if (!provider) throw new Error(`subagent transport provider "${PROVIDER}" is not registered`);
              const agentOptions = {
                provider: (args.provider || worker.provider),
                model: (args.model || worker.model),
              };
              const run = await ctx.subagents.start(PROVIDER, {
                label: args.description,
                prompt: [{ type: 'text', text: args.prompt }],
                parent,
                agentOptions,
                signal: exec.signal,
              });
              const result = await settleRun(run);
              if (result.stopReason && result.stopReason !== 'completed') {
                return {
                  ok: false,
                  message: `worker ended with stopReason=${result.stopReason}${result.diagnostic ? `: ${result.diagnostic}` : ''}. Treat as a failed subtask (repair/Replan), do not process it yourself.`,
                  active: semaphore.count(sessionKey),
                  max: cfg.maxConcurrentWorkers,
                };
              }
              const fullText = outputToText(result.output);
              const [text, truncated] = truncateHead(fullText, cfg.maxWorkerResultTokens);
              if (!truncated) {
                return { ok: true, text, active: semaphore.count(sessionKey), max: cfg.maxConcurrentWorkers };
              }
              // Persist the full output so truncation never loses information.
              const artifactDir = join(cwd, '.task-runner', 'artifacts');
              mkdirSync(artifactDir, { recursive: true });
              const artifactPath = join(artifactDir, `worker-${run.id}.txt`);
              writeFileSync(artifactPath, fullText, 'utf8');
              return {
                ok: true,
                text: `${text}\n\n[task_worker] 输出已按预算截断（完整输出 ~${estimateTokens(fullText)} tokens > maxWorkerResultTokens ${cfg.maxWorkerResultTokens}）；全文已保存：${artifactPath}`,
                artifactPath,
                active: semaphore.count(sessionKey),
                max: cfg.maxConcurrentWorkers,
              };
            } catch (error) {
              return {
                ok: false,
                message: `task_worker failed: ${error instanceof Error ? error.message : String(error)}`,
                active: semaphore.count(sessionKey),
                max: cfg.maxConcurrentWorkers,
              };
            } finally {
              release();
            }
          },
        }),
        'task-runner: task_worker tool'
      ),
    'task-runner: task_worker tool'
  );
}
