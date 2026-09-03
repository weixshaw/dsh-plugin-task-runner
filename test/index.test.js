// Unit tests for dsh-plugin-task-runner host logic.
// Run with: DSH_HOME=$(mktemp -d) node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempHome = mkdtempSync(join(tmpdir(), 'dsh-tr-test-'));
process.env.DSH_HOME = tempHome;

const mod = await import('../lib/index.js');

test('sanitizeConfig coerces bad input to safe defaults', () => {
  const out = mod.sanitizeConfig({
    maxConcurrentWorkers: 99,
    maxWorkerContextTokens: 'not-a-number',
    worker: { provider: 'omlx', model: 'm1' },
    evil: 'dropped',
  });
  assert.equal(out.maxConcurrentWorkers, 1); // out of range -> default
  assert.equal(out.worker.provider, 'omlx');
  assert.equal(out.worker.model, 'm1');
  assert.equal('evil' in out, false);
});

test('sanitizeConfig accepts in-range integers and trims strings', () => {
  const out = mod.sanitizeConfig({
    maxConcurrentWorkers: 3,
    worker: { provider: '  omlx  ', model: 'M' },
    fallback: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    orchestrator: { provider: 'omlx', model: 'M' },
    maxWorkerContextTokens: 20000,
  });
  assert.equal(out.maxConcurrentWorkers, 3);
  assert.equal(out.worker.provider, 'omlx');
  assert.equal(out.fallback.model, 'deepseek-v4-pro');
  assert.equal(out.orchestrator.model, 'M');
  assert.equal(out.maxWorkerContextTokens, 20000);
});

test('writeConfig then readConfig round-trips', () => {
  const cfg = mod.sanitizeConfig({ maxConcurrentWorkers: 2 });
  mod.writeConfig(cfg);
  const back = mod.readConfig();
  assert.equal(back.maxConcurrentWorkers, 2);
  assert.ok(readFileSync(mod.configPath(), 'utf8').includes('maxConcurrentWorkers'));
});

test('readConfig falls back to DEFAULTS when file is missing', () => {
  rmSync(mod.configPath(), { force: true });
  const back = mod.readConfig();
  assert.equal(back.maxConcurrentWorkers, 1);
});

test('apply registers the /task-runner bridge with loopback authority', async () => {
  let handler;
  let options;
  const fakeCtx = {
    connection: { rpc: { handle: (ch, h, o) => { handler = h; options = o; } } },
    logger: { info() {}, warn() {} },
  };
  mod.apply(fakeCtx);
  assert.deepEqual(options, { authority: 'loopback' });
  const view = await handler('view', {});
  assert.equal(view.ok, true);
  const mutate = await handler('mutate', { config: { maxConcurrentWorkers: 4 } });
  assert.equal(mutate.config.maxConcurrentWorkers, 4);
  await assert.rejects(() => handler('bogus', {}), /unknown endpoint/);
});

test('orchestrator defaults to empty (follow session) when not supplied', () => {
  const out = mod.sanitizeConfig({ worker: { provider: 'omlx', model: 'm' } });
  assert.equal(out.orchestrator.provider, '');
  assert.equal(out.orchestrator.model, '');
});

test('maxWorkerContextTokens is bounded (>=1000)', () => {
  const out = mod.sanitizeConfig({ maxWorkerContextTokens: 500 });
  assert.equal(out.maxWorkerContextTokens, 40000); // below floor -> default
  const ok = mod.sanitizeConfig({ maxWorkerContextTokens: 12000 });
  assert.equal(ok.maxWorkerContextTokens, 12000);
});
