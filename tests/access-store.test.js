import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccessStore } from '../server/access-store.js';

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 14, 12);
const PRIVATE_ID = 'a'.repeat(48);

function fixture(t) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const directory = mkdtempSync(path.join(root, 'access-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(`${path.resolve(root)}${path.sep}access-test-`)) throw new Error('Refusing cleanup outside the fixture.');
    rmSync(resolved, { recursive: true, force: true });
  });
  return path.join(directory, 'subscriptions.json');
}

test('access store gives stable public identity and stores only a hash of private browser identity', () => {
  const store = createAccessStore();
  const first = store.identity(PRIVATE_ID, START);
  const second = store.identity(PRIVATE_ID, START + 61_000);
  assert.match(first.accessId, /^TF-[A-F0-9]{12}$/);
  assert.equal(second.accessId, first.accessId);
  assert.equal(second.createdAt, START);
  assert.equal(second.lastSeenAt, START + 61_000);
  assert.ok(!JSON.stringify(store.list()).includes(PRIVATE_ID));
  const listed = store.list();
  listed[0].manualExpiresAt = START + DAY;
  assert.equal(store.getByAccessId(first.accessId).manualExpiresAt, null);
});

test('grant extension follows its previous expiry and revoke removes entitlement', () => {
  const store = createAccessStore();
  const { accessId } = store.identity(PRIVATE_ID, START);
  store.grant(accessId, 30, START);
  assert.equal(store.getByAccessId(accessId).manualExpiresAt, START + 30 * DAY);
  store.grant(accessId, 10, START + DAY);
  assert.equal(store.getByAccessId(accessId).manualExpiresAt, START + 40 * DAY);
  store.revoke(accessId);
  assert.equal(store.getByAccessId(accessId).manualExpiresAt, null);
});

test('file store persists grants and demo configuration while keeping private cookie out of disk', t => {
  const filePath = fixture(t);
  const first = createAccessStore({ filePath });
  const { accessId } = first.identity(PRIVATE_ID, START);
  first.grant(accessId, 30, START);
  first.setDemoEnabled(false);
  const second = createAccessStore({ filePath });
  assert.equal(second.getByAccessId(accessId).manualExpiresAt, START + 30 * DAY);
  assert.equal(second.settings().demoUpgradeEnabled, false);
  assert.equal(second.identity(PRIVATE_ID, START + 2000).accessId, accessId);
  const serialized = readFileSync(filePath, 'utf8');
  assert.ok(!serialized.includes(PRIVATE_ID));
  assert.ok(!serialized.includes('OPENAI_API_KEY'));
  assert.ok(!serialized.includes('profile'));
  assert.ok(!serialized.includes('conversation'));
});

test('corrupt persistent storage fails closed and leaves the original file intact', t => {
  const filePath = fixture(t);
  const corrupt = '{broken-subscription-record';
  writeFileSync(filePath, corrupt);
  assert.throws(() => createAccessStore({ filePath }));
  assert.equal(readFileSync(filePath, 'utf8'), corrupt);
});

test('failed atomic persistence does not grant access only in memory', t => {
  const filePath = fixture(t);
  const store = createAccessStore({ filePath });
  // An occupied destination prevents atomic rename without changing OS settings.
  mkdirSync(filePath);
  assert.throws(() => store.identity(PRIVATE_ID, START), error => error.code === 'ACCESS_STORAGE_UNAVAILABLE');
  assert.deepEqual(store.list(), []);
});
