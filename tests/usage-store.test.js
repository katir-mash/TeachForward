import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUsageStore } from '../server/usage-store.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const IP = '1'.repeat(64);
const OTHER_IP = '2'.repeat(64);
const NOW = Date.UTC(2026, 10, 15, 12);
const DAY = 86_400_000;
const testsRoot = path.dirname(fileURLToPath(import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(path.join(testsRoot, 'usage-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(`${path.resolve(testsRoot)}${path.sep}usage-test-`)) throw new Error('Refusing cleanup outside the quota test fixture.');
    rmSync(resolved, { recursive: true, force: true });
  });
  return { directory, filePath: path.join(directory, 'usage.json') };
}

function reserve(store, overrides = {}) {
  return store.reserve({ identityHash: A, ipHash: IP, limit: 3, now: NOW, attemptSlots: 1, ...overrides });
}

const rejectsCode = (action, code) => assert.throws(action, error => error.code === code);

test('quota reservations immediately consume visitor slots and successful usage persists', () => {
  const store = createUsageStore();
  assert.deepEqual(store.usage(A, 3, NOW), { used: 0, limit: 3, remaining: 3, resetsAt: Date.UTC(2026, 10, 16) });
  const reservation = reserve(store, { limit: 1 });
  assert.equal(Object.isFrozen(reservation), true);
  assert.match(reservation.id, /^[a-f0-9]{32}$/);
  assert.equal(store.usage(A, 3, NOW).used, 1);
  rejectsCode(() => reserve(store, { limit: 1 }), 'VISITOR_DAILY_LIMIT');
  assert.equal(store.finish(reservation, { success: true }), true);
  assert.equal(store.usage(A, 3, NOW).used, 1);
  assert.equal(store.finish(reservation, { success: false }), false);
  assert.equal(store.usage(A, 3, NOW).used, 1);
});

test('new browser identities cannot bypass the network provider-attempt budget', () => {
  const store = createUsageStore({ dayLimit: 20, ipDayLimit: 3 });
  const first = reserve(store, { attemptSlots: 2 });
  assert.equal(store.finish(first, { success: false }), true);
  assert.equal(store.usage(A, 3, NOW).used, 0);
  rejectsCode(() => reserve(store, { identityHash: B, attemptSlots: 2 }), 'IP_DAILY_LIMIT');
  const second = reserve(store, { identityHash: B });
  store.finish(second, { success: false });
  rejectsCode(() => reserve(store, { identityHash: C }), 'IP_DAILY_LIMIT');
  assert.equal(store.usage(B, 3, NOW).used, 0);
});

test('global provider budget applies across identities and IPs even after failures', () => {
  const store = createUsageStore({ dayLimit: 3, ipDayLimit: 20 });
  const first = reserve(store, { attemptSlots: 2 });
  store.finish(first, { success: false });
  rejectsCode(() => reserve(store, { identityHash: B, ipHash: OTHER_IP, attemptSlots: 2 }), 'GLOBAL_DAILY_LIMIT');
  const second = reserve(store, { identityHash: B, ipHash: OTHER_IP });
  store.finish(second, { success: false });
  rejectsCode(() => reserve(store, { identityHash: C, ipHash: OTHER_IP }), 'GLOBAL_DAILY_LIMIT');
});

test('reopening the disk store preserves completed usage and outstanding reservations', t => {
  const { filePath } = fixture(t);
  const first = createUsageStore({ filePath, dayLimit: 3, ipDayLimit: 3 });
  const completed = reserve(first);
  first.finish(completed, { success: true });
  const pending = reserve(first, { identityHash: B, attemptSlots: 2 });

  const reopened = createUsageStore({ filePath, dayLimit: 3, ipDayLimit: 3 });
  assert.equal(reopened.usage(A, 3, NOW).used, 1);
  assert.equal(reopened.usage(B, 3, NOW).used, 1);
  rejectsCode(() => reserve(reopened, { identityHash: C }), 'IP_DAILY_LIMIT');
  assert.equal(reopened.finish(pending, { success: false }), true);
  assert.equal(reopened.usage(B, 3, NOW).used, 0);
  const again = createUsageStore({ filePath, dayLimit: 3, ipDayLimit: 3 });
  assert.equal(again.usage(B, 3, NOW).used, 0);
  rejectsCode(() => reserve(again, { identityHash: C, ipHash: OTHER_IP }), 'GLOBAL_DAILY_LIMIT');
});

test('UTC rollover starts fresh counters and retains only the current and previous day', t => {
  const { filePath } = fixture(t);
  const store = createUsageStore({ filePath, dayLimit: 1, ipDayLimit: 1 });
  const beforeMidnight = Date.UTC(2026, 10, 15, 23, 59, 59);
  const first = reserve(store, { now: beforeMidnight });
  const nextDay = Date.UTC(2026, 10, 16);
  assert.equal(store.usage(A, 3, nextDay).used, 0);
  const second = reserve(store, { now: nextDay });
  // Finishing yesterday's request never refunds a slot from today's allowance.
  store.finish(first, { success: false });
  assert.equal(store.usage(A, 3, nextDay).used, 1);
  store.finish(second, { success: true });
  reserve(store, { now: nextDay + DAY });
  const persisted = JSON.parse(readFileSync(filePath, 'utf8'));
  assert.deepEqual(Object.keys(persisted.days).sort(), ['2026-11-16', '2026-11-17']);
  assert.equal(store.finish(first, { success: false }), false);
});

test('invalid digests, limits, attempt counts and forged reservations cannot mutate usage', () => {
  const store = createUsageStore();
  for (const overrides of [{ identityHash: 'raw-browser-cookie' }, { ipHash: '127.0.0.1' }, { limit: 0 }, { now: NaN }, { attemptSlots: 0 }, { attemptSlots: 3 }]) {
    assert.throws(() => reserve(store, overrides), TypeError);
  }
  assert.throws(() => store.usage(A, -1, NOW), TypeError);
  assert.throws(() => createUsageStore({ dayLimit: 0 }), TypeError);
  assert.throws(() => createUsageStore({ ipDayLimit: 100_001 }), TypeError);
  assert.equal(store.usage(A, 3, NOW).used, 0);
  const reservation = reserve(store);
  assert.throws(() => store.finish({ ...reservation, identityHash: B }, { success: false }), TypeError);
  assert.throws(() => store.finish(reservation, { success: 'false' }), TypeError);
  assert.equal(store.usage(A, 3, NOW).used, 1);
});

test('corrupt or internally inconsistent disk data fails closed without overwriting the file', t => {
  const { filePath } = fixture(t);
  const invalidDocuments = [
    '{broken',
    JSON.stringify({ version: 0, days: {} }),
    JSON.stringify({ version: 1, days: { '2026-11-15': { attemptSlots: 1, visitors: {}, ips: {}, pending: {} } } }),
    JSON.stringify({ version: 1, days: { '2026-11-15': { attemptSlots: 0, visitors: { [A]: 1 }, ips: {}, pending: {} } } }),
    JSON.stringify({ version: 1, days: { '2026-99-99': { attemptSlots: 0, visitors: {}, ips: {}, pending: {} } } }),
    JSON.stringify({ version: 1, days: {}, accidentalPrivateData: 'DO_NOT_PERSIST_EXTRA_FIELDS' }),
    JSON.stringify({ version: 1, days: { '2026-11-15': { attemptSlots: 0, visitors: {}, ips: {}, pending: {}, chat: 'DO_NOT_PERSIST_EXTRA_FIELDS' } } }),
  ];
  for (const original of invalidDocuments) {
    writeFileSync(filePath, original);
    rejectsCode(() => createUsageStore({ filePath }), 'USAGE_STORAGE_UNAVAILABLE');
    assert.equal(readFileSync(filePath, 'utf8'), original);
  }
});

test('a failed atomic reservation write cannot grant an in-memory provider slot', t => {
  const { directory } = fixture(t);
  const blockedParent = path.join(directory, 'not-a-directory');
  const filePath = path.join(blockedParent, 'usage.json');
  const store = createUsageStore({ filePath });
  writeFileSync(blockedParent, 'User file preserved');
  rejectsCode(() => reserve(store), 'USAGE_STORAGE_UNAVAILABLE');
  assert.equal(store.usage(A, 3, NOW).used, 0);
  assert.equal(readFileSync(blockedParent, 'utf8'), 'User file preserved');
  assert.equal(existsSync(filePath), false);
});

test('the durable document contains only digests, counts and reservation identifiers', t => {
  const { filePath } = fixture(t);
  const store = createUsageStore({ filePath });
  const reservation = reserve(store, { attemptSlots: 2 });
  store.finish(reservation, { success: false });
  const persisted = JSON.parse(readFileSync(filePath, 'utf8'));
  const day = persisted.days['2026-11-15'];
  assert.deepEqual(Object.keys(day).sort(), ['attemptSlots', 'ips', 'pending', 'visitors']);
  assert.equal(day.attemptSlots, 2);
  assert.equal(day.ips[IP], 2);
  assert.equal(day.visitors[A], 0);
  assert.deepEqual(day.pending, {});
  assert.deepEqual(Object.keys(persisted).sort(), ['days', 'version']);
});

test('a failed completion write retains the reserved visitor allowance until a durable refund succeeds', t => {
  const { directory, filePath } = fixture(t);
  const store = createUsageStore({ filePath });
  const reservation = reserve(store);
  const backup = path.join(directory, 'saved-usage.json');
  renameSync(filePath, backup);
  mkdirSync(filePath);
  rejectsCode(() => store.finish(reservation, { success: false }), 'USAGE_STORAGE_UNAVAILABLE');
  assert.equal(store.usage(A, 3, NOW).used, 1);
  assert.equal(createUsageStore({ filePath: backup }).usage(A, 3, NOW).used, 1);
  // Restore only the empty test directory and fixture file created above.
  rmdirSync(filePath);
  renameSync(backup, filePath);
  assert.equal(store.finish(reservation, { success: false }), true);
  assert.equal(createUsageStore({ filePath }).usage(A, 3, NOW).used, 0);
});

test('storage paths outside the project are rejected before any write', () => {
  assert.throws(() => createUsageStore({ filePath: path.resolve(testsRoot, '..', '..', 'outside-usage.json') }), /inside the project/);
});
