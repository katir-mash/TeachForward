import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedisStores, USAGE_SCRIPT } from '../server/redis-stores.js';
import { createApp } from '../server/app.js';
import { hashAdminPassword } from '../server/admin.js';
import { SAMPLE_PROFILE } from '../shared/roadmap.js';
import { LuaRedis } from './helpers/lua-redis.js';

const NOW = Date.UTC(2026, 10, 15, 12);
const DAY = 86_400_000;
const identity = value => value.toString(16).padStart(48, '0');
const digest = value => value.toString(16).padStart(64, '0');
const IP = digest(1);
const question = () => ({ message: 'What should I check next?', profile: SAMPLE_PROFILE, completedTaskIds: [] });
const isCode = code => error => error.code === code;

function fixture(options = {}) {
  const redis = new LuaRedis({ now: NOW });
  const reopen = () => createRedisStores({ redis, ...options });
  return { redis, reopen, ...reopen() };
}

function reserve(store, overrides = {}) {
  return store.reserve({ identityHash: digest(10), ipHash: IP, limit: 3, now: NOW, attemptSlots: 1, ...overrides });
}

async function harness(t, stores, extra = {}) {
  const app = createApp({
    ...stores, client: null, sessionSecret: 'redis-test-stable-session-secret-long-enough',
    now: () => NOW, maxRetries: 0, adminPasswordHash: '', rateLimit: 100,
    ...extra,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (browser, route, body) => {
    const response = await fetch(`${origin}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(browser.size ? { cookie: [...browser].map(([name, value]) => `${name}=${value}`).join('; ') } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const split = pair.indexOf('=');
      browser.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  return { request, browser: () => new Map() };
}

test('offline Redis fixture executes Lua Redis commands, JSON, status replies and expiry', async () => {
  const redis = new LuaRedis({ now: NOW });
  const script = `
    if redis.call('TYPE', KEYS[1]).ok ~= 'none' then return 'unexpected' end
    redis.call('HSET', KEYS[1], 'visitor', cjson.encode({expires=cjson.null, at=tonumber(ARGV[1])}))
    redis.call('EXPIRE', KEYS[1], 2)
    local record=cjson.decode(redis.call('HGET',KEYS[1],'visitor'))
    return cjson.encode({at=record.at, empty=record.expires==cjson.null, count=redis.call('HLEN',KEYS[1])})
  `;
  assert.deepEqual(JSON.parse(await redis.eval(script, ['fixture'], [NOW])), { at: NOW, empty: true, count: 1 });
  redis.setTime(NOW + 2001);
  assert.deepEqual(await redis.eval("return redis.call('TYPE',KEYS[1])", ['fixture']), { ok: 'none' });
});

test('Redis access identities, manual Plus, demo state and settings persist across store instances', async () => {
  const f = fixture();
  const first = await f.accessStore.identity(identity(1), NOW, { ipHash: IP });
  await f.accessStore.grant(first.accessId, 7, NOW);
  await f.accessStore.setDemo(first.accessId, true, NOW + DAY);
  await f.accessStore.setDemoEnabled(false);
  const reopened = f.reopen();
  const restored = await reopened.accessStore.getIdentity(identity(1), NOW + 1);
  assert.equal(restored.accessId, first.accessId);
  assert.equal(restored.manualExpiresAt, NOW + 7 * DAY);
  assert.equal(restored.demoExpiresAt, NOW + DAY);
  assert.equal((await reopened.accessStore.settings()).demoUpgradeEnabled, false);
  await reopened.accessStore.revoke(first.accessId);
  const revoked = await f.accessStore.getByAccessId(first.accessId);
  assert.equal(revoked.manualExpiresAt, null);
  assert.equal(revoked.demoExpiresAt, null);
});

test('disabling Demo upgrade is checked atomically with the Redis entitlement mutation', async () => {
  const f = fixture();
  const visitor = await f.accessStore.identity(identity(1), NOW, { ipHash: IP });
  const results = await Promise.allSettled([
    f.accessStore.setDemoEnabled(false),
    f.reopen().accessStore.setDemo(visitor.accessId, true, NOW + DAY),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'DEMO_DISABLED');
  assert.equal((await f.accessStore.getByAccessId(visitor.accessId)).demoExpiresAt, null);
});

test('Redis inactive cleanup reclaims full capacity while protecting active manual access', async () => {
  const f = fixture({ accessOptions: { maxVisitors: 2, inactiveTtlMs: DAY } });
  const protectedVisitor = await f.accessStore.identity(identity(1), NOW, { ipHash: IP });
  await f.accessStore.grant(protectedVisitor.accessId, 7, NOW);
  await f.accessStore.identity(identity(2), NOW, { ipHash: IP });
  await assert.rejects(f.accessStore.identity(identity(3), NOW, { ipHash: IP }), isCode('ACCESS_STORAGE_FULL'));
  f.redis.setTime(NOW + 2 * DAY);
  const cleaned = await f.reopen().accessStore.cleanup(NOW + 2 * DAY);
  assert.equal(cleaned.removed, 1);
  assert.equal(cleaned.remaining, 1);
  assert.equal((await f.accessStore.getIdentity(identity(1), NOW + 2 * DAY)).accessId, protectedVisitor.accessId);
  assert.equal(await f.accessStore.getIdentity(identity(2), NOW + 2 * DAY), null);
  assert.ok((await f.accessStore.identity(identity(3), NOW + 2 * DAY, { ipHash: IP })).accessId);
});

test('parallel identity creation obeys the shared burst cap and known visitors still work', async () => {
  const f = fixture({ accessOptions: { ipBurstLimit: 3, ipDailyLimit: 50 } });
  const responses = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => f.reopen().accessStore.identity(identity(index + 1), NOW, { ipHash: IP })));
  assert.equal(responses.filter(item => item.status === 'fulfilled').length, 3);
  for (const item of responses.filter(item => item.status === 'rejected')) assert.equal(item.reason.code, 'ACCESS_CREATION_RATE_LIMIT');
  const known = await f.reopen().accessStore.identity(identity(1), NOW + 1, { ipHash: IP });
  assert.ok(known.accessId);
  const repeated = await Promise.all(Array.from({ length: 8 }, () => f.reopen().accessStore.identity(identity(1), NOW + 1, { ipHash: IP })));
  assert.ok(repeated.every(visitor => visitor.accessId === known.accessId));
  assert.equal((await f.accessStore.list()).length, 3);
});

test('Redis identity admission persists after restart, enforces different-network global caps and rolls forward', async () => {
  const f = fixture({ accessOptions: { globalHourlyLimit: 2, globalDailyLimit: 10 } });
  await f.accessStore.identity(identity(1), NOW, { ipHash: digest(1) });
  await f.reopen().accessStore.identity(identity(2), NOW, { ipHash: digest(2) });
  await assert.rejects(f.reopen().accessStore.identity(identity(3), NOW, { ipHash: digest(3) }), isCode('ACCESS_CREATION_RATE_LIMIT'));
  f.redis.setTime(NOW + 3_600_001);
  assert.ok((await f.reopen().accessStore.identity(identity(3), NOW + 3_600_001, { ipHash: digest(3) })).accessId);
});

test('Redis completed and crash-pending quota reservations survive fresh store instances', async () => {
  const f = fixture({ usageOptions: { dayLimit: 3, ipDayLimit: 3 } });
  const completed = await reserve(f.usageStore);
  assert.equal(await f.usageStore.finish(completed, { success: true }), true);
  const pending = await reserve(f.usageStore, { identityHash: digest(11), attemptSlots: 2 });
  const reopened = f.reopen().usageStore;
  assert.equal((await reopened.usage(digest(10), 3, NOW)).used, 1);
  assert.equal((await reopened.usage(digest(11), 3, NOW)).used, 1);
  await assert.rejects(reserve(reopened, { identityHash: digest(12) }), isCode('IP_DAILY_LIMIT'));
  assert.equal(await reopened.finish(pending, { success: false }), true);
  assert.equal(await reopened.finish(pending, { success: false }), false);
  assert.equal((await f.reopen().usageStore.usage(digest(11), 3, NOW)).used, 0);
  await assert.rejects(reserve(reopened, { identityHash: digest(12), ipHash: digest(2) }), isCode('GLOBAL_DAILY_LIMIT'));
});

test('Redis usageMany returns bounded correct counts for an empty or populated list in one EVAL', async () => {
  const f = fixture();
  let before = f.redis.calls;
  assert.deepEqual(await f.usageStore.usageMany([], NOW), []);
  assert.equal(f.redis.calls, before + 1);
  const first = await reserve(f.usageStore);
  await f.usageStore.finish(first, { success: true });
  await reserve(f.usageStore, { identityHash: digest(11), attemptSlots: 2 });
  const entries = [{ identityHash: digest(10), limit: 3 }, { identityHash: digest(11), limit: 20 }, { identityHash: digest(12), limit: 3 }];
  before = f.redis.calls;
  assert.deepEqual(await f.reopen().usageStore.usageMany(entries, NOW), [
    { used: 1, limit: 3, remaining: 2, resetsAt: Date.UTC(2026, 10, 16) },
    { used: 1, limit: 20, remaining: 19, resetsAt: Date.UTC(2026, 10, 16) },
    { used: 0, limit: 3, remaining: 3, resetsAt: Date.UTC(2026, 10, 16) },
  ]);
  assert.equal(f.redis.calls, before + 1);
});

test('parallel Redis reservations across workers cannot overspend the shared global cap', async () => {
  const f = fixture({ usageOptions: { dayLimit: 5, ipDayLimit: 100 } });
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => reserve(f.reopen().usageStore, { identityHash: digest(index + 10), ipHash: digest(index + 100) })));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 5);
  for (const item of results.filter(item => item.status === 'rejected')) assert.equal(item.reason.code, 'GLOBAL_DAILY_LIMIT');
  for (const item of results.filter(item => item.status === 'fulfilled')) await f.reopen().usageStore.finish(item.value, { success: false });
  await assert.rejects(reserve(f.reopen().usageStore, { identityHash: digest(99), ipHash: digest(999) }), isCode('GLOBAL_DAILY_LIMIT'));
});

test('parallel Redis reservations enforce browser allowance independently of app memory', async () => {
  const f = fixture({ usageOptions: { dayLimit: 100, ipDayLimit: 100 } });
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => reserve(f.reopen().usageStore)));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 3);
  for (const item of results.filter(item => item.status === 'rejected')) assert.equal(item.reason.code, 'VISITOR_DAILY_LIMIT');
  assert.equal((await f.reopen().usageStore.usage(digest(10), 3, NOW)).remaining, 0);
});

test('Redis quota TTL gives a fresh UTC day without refunding yesterday into today', async () => {
  const f = fixture({ usageOptions: { dayLimit: 1, ipDayLimit: 1 } });
  const yesterday = await reserve(f.usageStore);
  const tomorrow = NOW + DAY;
  f.redis.setTime(tomorrow);
  assert.equal((await f.reopen().usageStore.usage(digest(10), 3, tomorrow)).used, 0);
  const today = await reserve(f.reopen().usageStore, { now: tomorrow });
  await f.usageStore.finish(yesterday, { success: false });
  assert.equal((await f.reopen().usageStore.usage(digest(10), 3, tomorrow)).used, 1);
  await f.usageStore.finish(today, { success: true });
  f.redis.setTime(tomorrow + 3 * DAY);
  for (const key of [...f.redis.data.keys()]) f.redis.entry(key);
  assert.equal(f.redis.data.size, 0);
});

test('Redis request and login throttles stay bounded across workers and expire', async () => {
  const f = fixture();
  const hit = () => f.reopen().limiterStore.hit({ scope: 'admin-login', ipHash: IP, limit: 3, windowMs: 60_000, now: NOW });
  const results = await Promise.all(Array.from({ length: 12 }, hit));
  assert.equal(results.filter(result => result.allowed).length, 3);
  assert.ok(results.filter(result => !result.allowed).every(result => result.retryAfter > 0));
  f.redis.setTime(NOW + 60_001);
  assert.equal((await f.reopen().limiterStore.hit({ scope: 'admin-login', ipHash: IP, limit: 3, windowMs: 60_000, now: NOW + 60_001 })).allowed, true);
});

test('Redis failures reject access, entitlement mutations and quota operations without fallback or secret details', async () => {
  const f = fixture();
  const visitor = await f.accessStore.identity(identity(1), NOW, { ipHash: IP });
  const reservation = await reserve(f.usageStore);
  f.redis.available = false;
  for (const operation of [
    () => f.accessStore.identity(identity(1), NOW, { ipHash: IP }),
    () => f.accessStore.grant(visitor.accessId, 7, NOW),
    () => f.accessStore.setDemo(visitor.accessId, true, NOW + DAY),
    () => f.accessStore.setDemoEnabled(true),
  ]) await assert.rejects(operation(), error => error.code === 'ACCESS_STORAGE_UNAVAILABLE' && !error.message.includes('DO_NOT_EXPOSE'));
  for (const operation of [
    () => reserve(f.usageStore),
    () => f.usageStore.usage(digest(10), 3, NOW),
    () => f.usageStore.finish(reservation, { success: false }),
  ]) await assert.rejects(operation(), error => error.code === 'USAGE_STORAGE_UNAVAILABLE' && !error.message.includes('DO_NOT_EXPOSE'));
  f.redis.available = true;
  assert.equal((await f.accessStore.getByAccessId(visitor.accessId)).manualExpiresAt, null);
  assert.equal((await f.usageStore.usage(digest(10), 3, NOW)).used, 1);
});

test('malformed Redis usage or access data fails closed and is never replaced with empty state', async () => {
  const f = fixture();
  const usageKey = '{teachforward:v1}:usage:2026-11-15';
  f.redis.command('HSET', usageKey, 'attemptSlots', 'invalid-counter');
  await assert.rejects(reserve(f.usageStore), isCode('USAGE_STORAGE_UNAVAILABLE'));
  assert.equal(f.redis.command('HGET', usageKey, 'attemptSlots'), 'invalid-counter');
  f.redis.command('SET', '{teachforward:v1}:access:visitors', 'invalid-record-container');
  await assert.rejects(f.accessStore.identity(identity(1), NOW, { ipHash: IP }), isCode('ACCESS_STORAGE_UNAVAILABLE'));
  assert.equal(f.redis.command('GET', '{teachforward:v1}:access:visitors'), 'invalid-record-container');
});

test('Redis HTTP integration retains visitor identity, Plus and paid usage across app restarts', async t => {
  const f = fixture();
  let calls = 0;
  const client = { responses: { create: async () => { calls++; return { status: 'completed', output_text: 'Check your next unchecked step with the preparation program.' }; } } };
  const first = await harness(t, f.reopen(), { client });
  const browser = first.browser();
  const session = await first.request(browser, '/api/session');
  assert.equal(session.status, 200);
  await f.accessStore.grant(session.data.accessId, 7, NOW);
  assert.equal((await first.request(browser, '/api/mentor', question())).status, 200);
  const reopened = await harness(t, f.reopen(), { client });
  const restored = await reopened.request(browser, '/api/session');
  assert.equal(restored.status, 200);
  assert.equal(restored.data.accessId, session.data.accessId);
  assert.equal(restored.data.plan, 'plus');
  assert.equal(restored.data.usage.used, 1);
  assert.equal(calls, 1);
});

test('Redis Demo Plus survives app restart and server disabling immediately restores the paywall', async t => {
  const f = fixture();
  const first = await harness(t, f.reopen());
  const browser = first.browser();
  assert.equal((await first.request(browser, '/api/demo-upgrade', {})).data.plan, 'plus');
  const reopened = await harness(t, f.reopen());
  assert.equal((await reopened.request(browser, '/api/session')).data.plan, 'plus');
  await f.accessStore.setDemoEnabled(false);
  assert.equal((await reopened.request(browser, '/api/session')).data.plan, 'basic');
  assert.equal((await reopened.request(browser, '/api/plus', { profile: SAMPLE_PROFILE })).status, 403);
});

test('another app can revoke Demo Plus without an older in-memory demo session resurrecting it', async t => {
  const f = fixture();
  const first = await harness(t, f.reopen());
  const browser = first.browser();
  const upgrade = await first.request(browser, '/api/demo-upgrade', {});
  assert.equal(upgrade.status, 200);
  assert.equal(upgrade.data.plan, 'plus');
  const adminPassword = 'redis-admin-revoke-test-password';
  const adminPasswordHash = await hashAdminPassword(adminPassword);
  const second = await harness(t, f.reopen(), { adminPasswordHash });
  const admin = second.browser();
  assert.equal((await second.request(admin, '/api/admin/login', { password: adminPassword })).status, 200);
  assert.equal((await second.request(admin, '/api/admin/revoke', { accessId: upgrade.data.accessId })).status, 200);
  assert.equal((await first.request(browser, '/api/session')).data.plan, 'basic');
  assert.equal((await first.request(browser, '/api/plus', { profile: SAMPLE_PROFILE })).status, 403);
});

test('Redis outage blocks cached Plus, demo upgrades and provider requests through HTTP', async t => {
  const f = fixture();
  let calls = 0;
  const h = await harness(t, f.reopen(), { client: { responses: { create: async () => { calls++; throw new Error('Provider must not be reached'); } } } });
  const browser = h.browser();
  const session = await h.request(browser, '/api/session');
  await f.accessStore.grant(session.data.accessId, 7, NOW);
  assert.equal((await h.request(browser, '/api/plus', { profile: SAMPLE_PROFILE })).status, 200);
  f.redis.available = false;
  for (const [route, body] of [['/api/plus', { profile: SAMPLE_PROFILE }], ['/api/demo-upgrade', {}], ['/api/mentor', question()]]) {
    const result = await h.request(browser, route, body);
    assert.equal(result.status, 503);
    assert.ok(!JSON.stringify(result.data).includes('DO_NOT_EXPOSE'));
  }
  assert.equal(calls, 0);
});

test('Redis reservation failure after a successful session read prevents the OpenAI call', async t => {
  const f = fixture();
  let calls = 0;
  const stores = f.reopen();
  const originalReserve = stores.usageStore.reserve.bind(stores.usageStore);
  stores.usageStore.reserve = async args => { f.redis.available = false; return originalReserve(args); };
  const h = await harness(t, stores, { client: { responses: { create: async () => { calls++; throw new Error('Provider must not be reached'); } } } });
  const result = await h.request(h.browser(), '/api/mentor', question());
  assert.equal(result.status, 503);
  assert.equal(result.data.code, 'USAGE_STORAGE_UNAVAILABLE');
  assert.ok(!JSON.stringify(result.data).includes('DO_NOT_EXPOSE'));
  assert.equal(calls, 0);
});

test('Redis limiter outage after successful identity and settings reads returns safe HTTP 503 before OpenAI', async t => {
  const f = fixture();
  const stores = f.reopen();
  const originalHit = stores.limiterStore.hit.bind(stores.limiterStore);
  let successfulAccessReads = false;
  let calls = 0;
  stores.limiterStore.hit = async args => {
    successfulAccessReads = f.redis.calls >= 2;
    f.redis.available = false;
    return originalHit(args);
  };
  const h = await harness(t, stores, { client: { responses: { create: async () => { calls++; throw new Error('Provider must not be reached'); } } } });
  const response = await h.request(h.browser(), '/api/mentor', question());
  assert.equal(successfulAccessReads, true);
  assert.equal(response.status, 503);
  assert.equal(response.data.code, 'SECURITY_STORAGE_UNAVAILABLE');
  assert.ok(!JSON.stringify(response.data).includes('DO_NOT_EXPOSE'));
  assert.equal(calls, 0);
});

test('Redis login limiter outage returns safe HTTP 503 and never creates an administrator cookie', async t => {
  const f = fixture();
  const stores = f.reopen();
  const originalHit = stores.limiterStore.hit.bind(stores.limiterStore);
  stores.limiterStore.hit = async args => { f.redis.available = false; return originalHit(args); };
  const adminPasswordHash = `scrypt$${'a'.repeat(22)}$${'a'.repeat(86)}`;
  const h = await harness(t, stores, { adminPasswordHash });
  const response = await h.request(h.browser(), '/api/admin/login', { password: 'redis-limiter-test-password' });
  assert.equal(response.status, 503);
  assert.equal(response.data.code, 'SECURITY_STORAGE_UNAVAILABLE');
  assert.ok(!JSON.stringify(response.data).includes('DO_NOT_EXPOSE'));
  assert.ok(response.headers.getSetCookie().every(cookie => !cookie.startsWith('teachforward_admin=')));
});

test('a lost Redis reservation reply cannot start OpenAI or reset the committed shared budget', async t => {
  const f = fixture({ usageOptions: { dayLimit: 1, ipDayLimit: 30 } });
  let calls = 0;
  const h = await harness(t, f.reopen(), { client: { responses: { create: async () => { calls++; throw new Error('Provider must not be reached'); } } } });
  const browser = h.browser();
  f.redis.dropReplyWhen = ({ script, args }) => script === USAGE_SCRIPT && args[0] === 'reserve';
  const uncertain = await h.request(browser, '/api/mentor', question());
  assert.equal(uncertain.status, 503);
  assert.equal(uncertain.data.code, 'USAGE_STORAGE_UNAVAILABLE');
  assert.ok(!JSON.stringify(uncertain.data).includes('DO_NOT_EXPOSE'));
  f.redis.dropReplyWhen = null;
  assert.equal((await h.request(browser, '/api/session')).data.usage.used, 1);
  const fresh = await h.request(h.browser(), '/api/mentor', question());
  assert.equal(fresh.status, 429);
  assert.equal(fresh.data.code, 'AI_GLOBAL_DAILY_LIMIT');
  assert.equal(calls, 0);
});
