import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { createAccessStore } from '../server/access-store.js';
import { hashAdminPassword } from '../server/admin.js';
import { SAMPLE_PROFILE } from '../shared/roadmap.js';

const DAY = 86_400_000;
const PASSWORD = 'admin-tests-only-long-password';
const PASSWORD_HASH = await hashAdminPassword(PASSWORD);

function fixture(t) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const directory = mkdtempSync(path.join(root, 'admin-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(`${path.resolve(root)}${path.sep}admin-test-`)) throw new Error('Refusing test cleanup outside its fixture.');
    rmSync(resolved, { recursive: true, force: true });
  });
  return path.join(directory, 'access.json');
}

async function harness(t, options = {}) {
  let time = Date.UTC(2026, 10, 14, 12);
  const store = options.accessStore ?? createAccessStore();
  const app = createApp({ client: null, sessionSecret: 'admin-test-stable-session-secret', adminPasswordHash: PASSWORD_HASH, accessStore: store, now: () => time, ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const close = () => server.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
  t.after(close);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = () => new Map();
  async function request(jar, route, body, extraHeaders = {}) {
    const response = await fetch(`${origin}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0];
      const split = pair.indexOf('=');
      jar.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  const admin = browser();
  return { store, origin, browser, admin, request, close, advance: milliseconds => { time += milliseconds; }, time: () => time, login: (password = PASSWORD) => request(admin, '/api/admin/login', { password }) };
}

test('admin authentication protects management routes, ignores role spoofing, and logs out', async t => {
  const h = await harness(t);
  const visitor = h.browser();
  const publicStatus = await h.request(visitor, '/api/admin/session');
  assert.equal(publicStatus.data.configured, true);
  assert.equal(publicStatus.data.authenticated, false);
  assert.equal((await h.request(visitor, '/api/admin/overview')).status, 401);
  assert.equal((await h.request(visitor, '/api/admin/grant', { accessId: 'TF-000000000000', days: 30, role: 'admin', authenticated: true })).status, 401);
  assert.equal((await h.login('wrong-password')).status, 401);
  const loggedIn = await h.login();
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.data.authenticated, true);
  assert.ok(loggedIn.headers.getSetCookie().some(cookie => /HttpOnly/.test(cookie) && /SameSite=/.test(cookie)));
  assert.equal((await h.request(h.admin, '/api/admin/overview')).status, 200);
  const foreign = await h.request(h.admin, '/api/admin/settings', { demoUpgradeEnabled: false }, { origin: 'https://unrelated.example' });
  assert.equal(foreign.status, 403);
  assert.equal((await h.request(h.admin, '/api/admin/logout', {})).data.authenticated, false);
  assert.equal((await h.request(h.admin, '/api/admin/overview')).status, 401);
});

test('unconfigured admin, throttled logins, and expired admin sessions fail closed', async t => {
  const unconfigured = await harness(t, { adminPasswordHash: '' });
  assert.equal((await unconfigured.login()).status, 503);
  const h = await harness(t, { adminLoginLimit: 2, adminSessionTtlMs: 1000 });
  assert.equal((await h.login('wrong-password')).status, 401);
  assert.equal((await h.login('still-wrong')).status, 401);
  const limited = await h.login();
  assert.equal(limited.status, 429);
  assert.equal(limited.data.code, 'ADMIN_RATE_LIMITED');
  h.advance(15 * 60_000 + 1);
  assert.equal((await h.login()).status, 200);
  h.advance(1001);
  assert.equal((await h.request(h.admin, '/api/admin/overview')).status, 401);
});

test('manual Plus grants unlock real premium data and allowance, expire, and can be revoked', async t => {
  const h = await harness(t);
  const visitor = h.browser();
  const initial = await h.request(visitor, '/api/session');
  const accessId = initial.data.accessId;
  assert.match(accessId, /^TF-[A-F0-9]{12}$/);
  const identityCookie = initial.headers.getSetCookie().find(value => value.startsWith('teachforward_session='));
  assert.ok(Number(identityCookie.match(/Max-Age=(\d+)/)?.[1]) >= 365 * DAY / 1000, 'Browser identity must outlive the longest possible grant.');
  assert.equal(initial.data.entitlement.source, 'free');
  assert.equal((await h.request(visitor, '/api/plus', { profile: SAMPLE_PROFILE, plan: 'plus' })).status, 403);
  await h.login();
  assert.equal((await h.request(h.admin, '/api/admin/grant', { accessId, days: 2 })).status, 200);
  const granted = await h.request(visitor, '/api/session');
  assert.equal(granted.data.plan, 'plus');
  assert.equal(granted.data.entitlement.source, 'admin');
  assert.equal(granted.data.entitlement.expiresAt, h.time() + 2 * DAY);
  assert.equal(granted.data.usage.limit, 20);
  const plus = await h.request(visitor, '/api/plus', { profile: SAMPLE_PROFILE });
  assert.equal(plus.status, 200);
  assert.ok(plus.data.weeklyPlan.length > 0 && plus.data.skillExercises.length > 0);
  const reset = await h.request(visitor, '/api/demo-reset', {});
  assert.equal(reset.data.plan, 'plus');
  assert.equal(reset.data.entitlement.source, 'admin');
  h.advance(2 * DAY + 1);
  assert.equal((await h.request(visitor, '/api/session')).data.plan, 'basic');
  assert.equal((await h.request(visitor, '/api/plus', { profile: SAMPLE_PROFILE })).status, 403);
  await h.login();
  assert.equal((await h.request(h.admin, '/api/admin/grant', { accessId, days: 30 })).status, 200);
  assert.equal((await h.request(h.admin, '/api/admin/revoke', { accessId })).status, 200);
  assert.equal((await h.request(visitor, '/api/session')).data.plan, 'basic');
});

test('grant validation rejects unknown visitors, invalid durations, and excessive extension', async t => {
  const h = await harness(t);
  const visitor = h.browser();
  const { data: { accessId } } = await h.request(visitor, '/api/session');
  await h.login();
  for (const days of [0, -1, 366, 1.5, '30', null]) {
    assert.equal((await h.request(h.admin, '/api/admin/grant', { accessId, days })).status, 400);
  }
  assert.equal((await h.request(h.admin, '/api/admin/grant', { accessId: 'TF-000000000000', days: 30 })).status, 404);
  assert.equal((await h.request(h.admin, '/api/admin/grant', { accessId, days: 365 })).status, 200);
  assert.equal((await h.request(h.admin, '/api/admin/grant', { accessId, days: 1 })).status, 400);
});

test('demo switch is enforced on the server without removing a manual entitlement', async t => {
  const h = await harness(t);
  const demoVisitor = h.browser();
  const manualVisitor = h.browser();
  await h.request(demoVisitor, '/api/demo-upgrade', {});
  const { data: { accessId } } = await h.request(manualVisitor, '/api/session');
  await h.login();
  await h.request(h.admin, '/api/admin/grant', { accessId, days: 30 });
  const settings = await h.request(h.admin, '/api/admin/settings', { demoUpgradeEnabled: false });
  assert.equal(settings.status, 200);
  assert.equal(settings.data.settings.demoUpgradeEnabled, false);
  assert.equal((await h.request(demoVisitor, '/api/session')).data.plan, 'basic');
  assert.equal((await h.request(demoVisitor, '/api/demo-upgrade', {})).status, 403);
  assert.equal((await h.request(manualVisitor, '/api/session')).data.entitlement.source, 'admin');
  assert.equal((await h.request(manualVisitor, '/api/plus', { profile: SAMPLE_PROFILE })).status, 200);
  await h.request(h.admin, '/api/admin/settings', { demoUpgradeEnabled: true });
  assert.equal((await h.request(demoVisitor, '/api/demo-upgrade', {})).status, 200);
});

test('durable identity and admin grants survive a new app without exposing private identifiers', async t => {
  const filePath = fixture(t);
  const first = await harness(t, { accessStore: createAccessStore({ filePath }) });
  const visitor = first.browser();
  const { data: { accessId } } = await first.request(visitor, '/api/session');
  await first.login();
  const overview = await first.request(first.admin, '/api/admin/grant', { accessId, days: 30 });
  assert.ok(overview.data.visitors.some(record => record.accessId === accessId));
  const publicText = JSON.stringify(overview.data);
  assert.ok(!publicText.includes('identityHash'));
  assert.ok(!publicText.includes('conversation'));
  assert.ok(!publicText.includes('profile'));
  assert.ok(!publicText.includes(PASSWORD_HASH));
  const privateCookieValue = visitor.get('teachforward_session').split('.')[0];
  assert.ok(!publicText.includes(privateCookieValue));
  assert.ok(!readFileSync(filePath, 'utf8').includes(privateCookieValue));
  await first.close();
  const second = await harness(t, { accessStore: createAccessStore({ filePath }) });
  const restored = await second.request(visitor, '/api/session');
  assert.equal(restored.data.accessId, accessId);
  assert.equal(restored.data.plan, 'plus');
  assert.equal(restored.data.entitlement.source, 'admin');
  assert.equal((await second.request(visitor, '/api/plus', { profile: SAMPLE_PROFILE })).status, 200);
});
