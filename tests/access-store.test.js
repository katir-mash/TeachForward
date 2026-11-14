import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createAccessStore } from '../server/access-store.js';

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 14, 12);
const PRIVATE_ID = 'a'.repeat(48);
const id = number => number.toString(16).padStart(48, '0');
const ipHash = number => number.toString(16).padStart(64, '0');

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

test('inactive cleanup protects active grants and keeps recently expired access for the full retention period', () => {
  const store = createAccessStore();
  const free = store.identity(id(1), START);
  const active = store.identity(id(2), START);
  const recentlyExpired = store.identity(id(3), START);
  const recentlySeen = store.identity(id(4), START);
  store.grant(active.accessId, 90, START);
  store.grant(recentlyExpired.accessId, 5, START);
  store.identity(id(4), START + 20 * DAY);
  assert.deepEqual(store.cleanup(START + 31 * DAY), { removed: 1, remaining: 3 });
  assert.equal(store.getByAccessId(free.accessId), null);
  assert.equal(store.getIdentity(id(2), START + 31 * DAY).accessId, active.accessId);
  assert.equal(store.getIdentity(id(3), START + 31 * DAY).accessId, recentlyExpired.accessId);
  assert.equal(store.getIdentity(id(4), START + 31 * DAY).accessId, recentlySeen.accessId);
  assert.equal(store.getIdentity(id(3), START + 35 * DAY), null);
  assert.equal(store.getIdentity(id(2), START + 119 * DAY).accessId, active.accessId);
  assert.equal(store.getIdentity(id(2), START + 120 * DAY), null);
});

test('returning after inactivity creates a new Access ID without a noncreating lookup mutating disk', t => {
  const filePath = fixture(t);
  const store = createAccessStore({ filePath, inactiveTtlMs: 1000 });
  const first = store.identity(PRIVATE_ID, START);
  const beforeLookup = readFileSync(filePath, 'utf8');
  assert.equal(store.getIdentity(PRIVATE_ID, START + 1000), null);
  assert.equal(readFileSync(filePath, 'utf8'), beforeLookup);
  assert.equal(store.list().length, 1);
  const replacement = store.identity(PRIVATE_ID, START + 1001);
  assert.notEqual(replacement.accessId, first.accessId);
  assert.equal(store.list().length, 1);
  assert.equal(store.getByAccessId(first.accessId), null);
});

test('expired-grant retention follows the later of the last visit and expiry', () => {
  const store = createAccessStore();
  const visitor = store.identity(PRIVATE_ID, START);
  store.grant(visitor.accessId, 10, START);
  store.identity(PRIVATE_ID, START + 20 * DAY);
  assert.equal(store.getIdentity(PRIVATE_ID, START + 49 * DAY).accessId, visitor.accessId);
  assert.equal(store.getIdentity(PRIVATE_ID, START + 50 * DAY), null);
});

test('full capacity rejects only new visitors, then reclaims stale free records without evicting a grant', () => {
  const store = createAccessStore({ maxVisitors: 2 });
  const protectedVisitor = store.identity(id(1), START);
  store.grant(protectedVisitor.accessId, 100, START);
  store.identity(id(2), START);
  assert.throws(() => store.identity(id(3), START), error => error.code === 'ACCESS_STORAGE_FULL' && error.retryAfter === 300);
  assert.equal(store.list().length, 2);
  assert.equal(store.identity(id(1), START).accessId, protectedVisitor.accessId);
  const newcomer = store.identity(id(3), START + 31 * DAY);
  assert.match(newcomer.accessId, /^TF-/);
  assert.equal(store.list().length, 2);
  assert.equal(store.getByAccessId(protectedVisitor.accessId).manualExpiresAt, START + 100 * DAY);
});

test('new cookie identities share an IP burst budget while known identities remain usable', () => {
  const store = createAccessStore({ ipBurstLimit: 2 });
  const first = store.identity(id(1), START, { ipHash: ipHash(1) });
  store.identity(id(2), START, { ipHash: ipHash(1) });
  assert.throws(() => store.identity(id(3), START, { ipHash: ipHash(1) }), error => error.code === 'ACCESS_CREATION_RATE_LIMIT' && error.retryAfter === 600);
  assert.equal(store.identity(id(1), START + 1, { ipHash: ipHash(1) }).accessId, first.accessId);
  assert.match(store.identity(id(3), START + 10 * 60_000, { ipHash: ipHash(1) }).accessId, /^TF-/);
  assert.equal(store.list().length, 3);
});

test('an IP daily cap and global caps survive private-cookie and network rotation', () => {
  const perIp = createAccessStore({ ipBurstLimit: 10, ipDailyLimit: 2 });
  perIp.identity(id(1), START, { ipHash: ipHash(1) });
  perIp.identity(id(2), START, { ipHash: ipHash(1) });
  assert.throws(() => perIp.identity(id(3), START, { ipHash: ipHash(1) }), error => error.code === 'ACCESS_CREATION_RATE_LIMIT' && error.retryAfter === DAY / 1000);
  assert.match(perIp.identity(id(3), START + DAY, { ipHash: ipHash(1) }).accessId, /^TF-/);

  const global = createAccessStore({ globalHourlyLimit: 2, globalDailyLimit: 3 });
  global.identity(id(1), START, { ipHash: ipHash(1) });
  global.identity(id(2), START, { ipHash: ipHash(2) });
  assert.throws(() => global.identity(id(3), START, { ipHash: ipHash(3) }), error => error.code === 'ACCESS_CREATION_RATE_LIMIT' && error.retryAfter === 3600);
  global.identity(id(3), START + 60 * 60_000, { ipHash: ipHash(3) });
  assert.throws(() => global.identity(id(4), START + 60 * 60_000, { ipHash: ipHash(4) }), error => error.code === 'ACCESS_CREATION_RATE_LIMIT' && error.retryAfter === 23 * 3600);
});

test('creation admission survives a new store instance and stores only an anonymized network hash', t => {
  const filePath = fixture(t);
  const options = { filePath, ipBurstLimit: 2 };
  const anonymizedIp = createHash('sha256').update('203.0.113.10').digest('hex');
  const first = createAccessStore(options);
  const visitor = first.identity(id(1), START, { ipHash: anonymizedIp });
  first.identity(id(2), START, { ipHash: anonymizedIp });
  const restored = createAccessStore(options);
  assert.throws(() => restored.identity(id(3), START + 1, { ipHash: anonymizedIp }), error => error.code === 'ACCESS_CREATION_RATE_LIMIT');
  assert.equal(restored.identity(id(1), START + 1, { ipHash: anonymizedIp }).accessId, visitor.accessId);
  assert.match(restored.identity(id(3), START + DAY, { ipHash: anonymizedIp }).accessId, /^TF-/);
  const persisted = JSON.parse(readFileSync(filePath, 'utf8'));
  assert.equal(persisted.admission.creations.length, 1);
  assert.ok(!JSON.stringify(persisted).includes('203.0.113.10'));
  assert.ok(!JSON.stringify(persisted).includes(id(1)));
});

test('existing v1 files migrate without losing settings, identity, or active grants', t => {
  const filePath = fixture(t);
  const original = {
    version: 1,
    settings: { demoUpgradeEnabled: false },
    visitors: [{ accessId: 'TF-ABCDEF123456', identityHash: createHash('sha256').update(PRIVATE_ID).digest('hex'), createdAt: START, lastSeenAt: START, manualExpiresAt: START + 90 * DAY }],
  };
  writeFileSync(filePath, JSON.stringify(original));
  const store = createAccessStore({ filePath });
  assert.equal(store.getIdentity(PRIVATE_ID, START + 40 * DAY).accessId, original.visitors[0].accessId);
  assert.equal(store.settings().demoUpgradeEnabled, false);
  store.setDemoEnabled(true);
  const migrated = JSON.parse(readFileSync(filePath, 'utf8'));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.visitors[0].manualExpiresAt, original.visitors[0].manualExpiresAt);
  assert.deepEqual(migrated.admission.creations, []);
});

test('invalid persisted admission records fail closed without replacing the file', t => {
  const filePath = fixture(t);
  const corrupted = JSON.stringify({ version: 2, settings: { demoUpgradeEnabled: true }, visitors: [], admission: { creations: [{ at: START, ipHash: '203.0.113.10' }] } });
  writeFileSync(filePath, corrupted);
  assert.throws(() => createAccessStore({ filePath }));
  assert.equal(readFileSync(filePath, 'utf8'), corrupted);
});
