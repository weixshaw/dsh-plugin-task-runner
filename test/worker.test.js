// Unit tests for the task_worker enforcement helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, truncateHead, outputToText, createSemaphore, readConfig } from '../lib/worker/index.js';

test('estimateTokens counts CJK ~1/char and ASCII ~1/4', () => {
  // 10 CJK chars -> ~10; 40 ascii chars -> ~10
  assert.equal(estimateTokens('一二三四五六七八九十'), 10);
  assert.equal(estimateTokens('a'.repeat(40)), 10);
  assert.ok(estimateTokens('x'.repeat(100)) >= 25);
});

test('truncateHead keeps head and flags truncation', () => {
  const long = 'z'.repeat(10000);
  const [head, truncated] = truncateHead(long, 2000);
  assert.equal(truncated, true);
  assert.ok(head.length < 10000);
  assert.ok(head.length > 0);
  const short = 'hello';
  const [s, t] = truncateHead(short, 2000);
  assert.equal(t, false);
  assert.equal(s, 'hello');
});

test('outputToText joins text blocks only', () => {
  assert.equal(outputToText([{ type: 'text', text: 'a' }, { type: 'tool', }, { type: 'text', text: 'b' }]), 'ab');
  assert.equal(outputToText([]), '');
  assert.equal(outputToText(null), '');
});

test('semaphore enforces the cap per session', () => {
  const sem = createSemaphore();
  const r1 = sem.acquire('s1', 1);
  assert.ok(r1 !== null);
  assert.equal(sem.acquire('s1', 1), null); // at cap
  assert.ok(sem.acquire('s2', 1) !== null); // other session unaffected
  r1();
  assert.ok(sem.acquire('s1', 1) !== null); // slot freed
});

test('semaphore allows up to max concurrent', () => {
  const sem = createSemaphore();
  const releases = [];
  for (let i = 0; i < 2; i++) releases.push(sem.acquire('s1', 2));
  assert.ok(releases[0] !== null && releases[1] !== null);
  assert.equal(sem.acquire('s1', 2), null);
  releases.forEach((r) => r());
  assert.equal(sem.count('s1'), 0);
});

test('readConfig falls back to defaults without a config file', () => {
  const cfg = readConfig(); // real DSH_HOME; the file exists -> has values
  assert.ok(cfg.maxConcurrentWorkers >= 1);
  assert.ok(cfg.maxWorkerResultTokens >= 200);
});
