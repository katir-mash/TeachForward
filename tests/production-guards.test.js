import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { createAccessStore } from '../server/access-store.js';
import { createUsageStore } from '../server/usage-store.js';
import { SAMPLE_PROFILE } from '../shared/roadmap.js';

const NOW = Date.UTC(2026, 10, 15, 12);
const SECRET = 'production-guards-stable-test-session-secret';
const PUBLIC_ORIGIN = 'https://teachforward.example';
const testsRoot = path.dirname(fileURLToPath(import.meta.url));
const question = () => ({ message: 'What is my next step?', profile: SAMPLE_PROFILE, completedTaskIds: [] });

function fixture(t) {
  const directory = mkdtempSync(path.join(testsRoot, 'production-guards-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(`${path.resolve(testsRoot)}${path.sep}production-guards-`)) throw new Error('Refusing cleanup outside the production guard fixture.');
    rmSync(resolved, { recursive: true, force: true });
  });
  return { accessPath: path.join(directory, 'access.json'), usagePath: path.join(directory, 'usage.json') };
}

function provider({ fail = false } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    client: { responses: { create: async () => {
      calls++;
      if (fail) throw new Error('DO_NOT_EXPOSE_PROVIDER_INTERNALS');
      return { status: 'completed', output_text: 'Confirm your next unchecked task with the approved preparation program.' };
    } } },
  };
}

async function harness(t, options = {}) {
  const { trustedProxyForTest = false, ...appOptions } = options;
  const previousTrust = process.env.TRUST_PROXY;
  let app;
  try {
    if (trustedProxyForTest) process.env.TRUST_PROXY = '1';
    else delete process.env.TRUST_PROXY;
    app = createApp({ client: null, sessionSecret: SECRET, now: () => NOW, maxRetries: 0, adminPasswordHash: '', rateLimit: 100, ...appOptions });
  } finally {
    if (previousTrust === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousTrust;
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const close = () => server.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
  t.after(close);
  async function request(jar, route, body, headers = {}) {
    const response = await fetch(`${origin}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(jar.size ? { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const split = pair.indexOf('=');
      jar.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  return { request, close, browser: () => new Map() };
}

function assertThrottle(result, code) {
  assert.equal(result.status, 429, `Unexpected guarded response: ${result.data.code}`);
  assert.equal(result.data.code, code);
  assert.ok(Number(result.headers.get('retry-after')) > 0);
}

test('the same signed visitor cookie retains its daily allowance after both stores and the app reopen', async t => {
  const { accessPath, usagePath } = fixture(t);
  const fake = provider();
  const options = () => ({ client: fake.client, accessStore: createAccessStore({ filePath: accessPath }), usageStore: createUsageStore({ filePath: usagePath }) });
  const first = await harness(t, options());
  const browser = first.browser();
  const original = await first.request(browser, '/api/session');
  for (let index = 0; index < 3; index++) assert.equal((await first.request(browser, '/api/mentor', question())).status, 200);
  assert.equal((await first.request(browser, '/api/session')).data.usage.used, 3);
  await first.close();

  const reopened = await harness(t, options());
  const restored = await reopened.request(browser, '/api/session');
  assert.equal(restored.data.accessId, original.data.accessId);
  assert.equal(restored.data.usage.used, 3);
  assert.equal(restored.data.usage.remaining, 0);
  assertThrottle(await reopened.request(browser, '/api/mentor', question()), 'DAILY_LIMIT');
  assert.equal(fake.calls, 3);
});

test('new guest cookies cannot bypass the durable IP budget including possible SDK retries', async t => {
  const { accessPath, usagePath } = fixture(t);
  const fake = provider();
  const options = () => ({
    client: fake.client, maxRetries: 1,
    accessStore: createAccessStore({ filePath: accessPath }),
    usageStore: createUsageStore({ filePath: usagePath, dayLimit: 100, ipDayLimit: 3 }),
  });
  const first = await harness(t, options());
  assert.equal((await first.request(first.browser(), '/api/mentor', question())).status, 200);
  assertThrottle(await first.request(first.browser(), '/api/mentor', question()), 'AI_IP_DAILY_LIMIT');
  await first.close();
  const reopened = await harness(t, options());
  assertThrottle(await reopened.request(reopened.browser(), '/api/mentor', question()), 'AI_IP_DAILY_LIMIT');
  assert.equal(fake.calls, 1);
});

test('the global provider-attempt cap survives restart and cannot be bypassed with a different network or guest', async t => {
  const { accessPath, usagePath } = fixture(t);
  const fake = provider();
  const options = () => ({
    client: fake.client, trustedProxyForTest: true,
    accessStore: createAccessStore({ filePath: accessPath }),
    usageStore: createUsageStore({ filePath: usagePath, dayLimit: 2, ipDayLimit: 30 }),
  });
  const first = await harness(t, options());
  assert.equal((await first.request(first.browser(), '/api/mentor', question(), { 'x-forwarded-for': '198.51.100.1' })).status, 200);
  assert.equal((await first.request(first.browser(), '/api/mentor', question(), { 'x-forwarded-for': '198.51.100.2' })).status, 200);
  await first.close();
  const reopened = await harness(t, options());
  assertThrottle(await reopened.request(reopened.browser(), '/api/mentor', question(), { 'x-forwarded-for': '198.51.100.3' }), 'AI_GLOBAL_DAILY_LIMIT');
  assert.equal(fake.calls, 2);
});

test('provider failure refunds the visitor allowance but never replenishes the persistent service budget', async t => {
  const { accessPath, usagePath } = fixture(t);
  const fake = provider({ fail: true });
  const options = () => ({
    client: fake.client,
    accessStore: createAccessStore({ filePath: accessPath }),
    usageStore: createUsageStore({ filePath: usagePath, dayLimit: 1, ipDayLimit: 30 }),
  });
  const first = await harness(t, options());
  const browser = first.browser();
  const failed = await first.request(browser, '/api/mentor', question());
  assert.equal(failed.status, 502);
  assert.ok(!JSON.stringify(failed.data).includes('DO_NOT_EXPOSE'));
  assert.equal((await first.request(browser, '/api/session')).data.usage.used, 0);
  await first.close();
  const reopened = await harness(t, options());
  assert.equal((await reopened.request(browser, '/api/session')).data.usage.used, 0);
  assertThrottle(await reopened.request(browser, '/api/mentor', question()), 'AI_GLOBAL_DAILY_LIMIT');
  assert.equal(fake.calls, 1);
});

test('quota reservation storage failure prevents all provider calls and returns no storage internals', async t => {
  const fake = provider();
  let finishCalls = 0;
  const usageStore = {
    usage: () => ({ used: 0, limit: 3, remaining: 3, resetsAt: Date.UTC(2026, 10, 16) }),
    reserve() { throw Object.assign(new Error('DO_NOT_EXPOSE_PRIVATE_STORAGE_PATH'), { code: 'USAGE_STORAGE_UNAVAILABLE' }); },
    finish() { finishCalls++; },
  };
  const h = await harness(t, { client: fake.client, usageStore });
  const result = await h.request(h.browser(), '/api/mentor', question());
  assert.equal(result.status, 503);
  assert.equal(result.data.code, 'USAGE_STORAGE_UNAVAILABLE');
  assert.ok(!JSON.stringify(result.data).includes('DO_NOT_EXPOSE'));
  assert.equal(fake.calls, 0);
  assert.equal(finishCalls, 0);
});

test('new-identity admission limits persist across restart while an existing visitor still works', async t => {
  const { accessPath } = fixture(t);
  const store = () => createAccessStore({ filePath: accessPath, ipBurstLimit: 2, ipDailyLimit: 100, globalHourlyLimit: 100, globalDailyLimit: 100 });
  const first = await harness(t, { accessStore: store() });
  const knownBrowser = first.browser();
  const original = await first.request(knownBrowser, '/api/session');
  assert.equal(original.status, 200);
  assert.equal((await first.request(first.browser(), '/api/session')).status, 200);
  assertThrottle(await first.request(first.browser(), '/api/session'), 'ACCESS_CREATION_RATE_LIMIT');
  await first.close();
  const reopened = await harness(t, { accessStore: store() });
  assertThrottle(await reopened.request(reopened.browser(), '/api/session'), 'ACCESS_CREATION_RATE_LIMIT');
  const known = await reopened.request(knownBrowser, '/api/session');
  assert.equal(known.status, 200);
  assert.equal(known.data.accessId, original.data.accessId);
});

test('full visitor storage reports temporary capacity with Retry-After and preserves existing identities', async t => {
  const h = await harness(t, { accessStore: createAccessStore({ maxVisitors: 2, ipBurstLimit: 100 }) });
  const knownBrowser = h.browser();
  const original = await h.request(knownBrowser, '/api/session');
  assert.equal(original.status, 200);
  assert.equal((await h.request(h.browser(), '/api/session')).status, 200);
  const full = await h.request(h.browser(), '/api/session');
  assert.equal(full.status, 503);
  assert.equal(full.data.code, 'ACCESS_STORAGE_FULL');
  assert.ok(Number(full.headers.get('retry-after')) > 0);
  assert.ok(!JSON.stringify(full.data).includes('server/data'));
  const known = await h.request(knownBrowser, '/api/session');
  assert.equal(known.status, 200);
  assert.equal(known.data.accessId, original.data.accessId);
  assert.ok(!Object.hasOwn(known.data, 'identityHash'));
});

test('production mutations trust the configured HTTPS origin rather than a matching forged Host header', async t => {
  const h = await harness(t, { production: true, appOrigin: PUBLIC_ORIGIN });
  const browser = h.browser();
  const session = await h.request(browser, '/api/session');
  assert.equal(session.status, 200);
  assert.ok(session.headers.getSetCookie().some(cookie => /; Secure(?:;|$)/.test(cookie) && /HttpOnly/.test(cookie)));
  const forged = await h.request(browser, '/api/demo-upgrade', {}, { host: 'attacker.example', origin: 'http://attacker.example' });
  assert.equal(forged.status, 403);
  assert.equal(forged.data.code, 'ORIGIN_REJECTED');
  const foreign = await h.request(browser, '/api/demo-upgrade', {}, { origin: 'https://other.example' });
  assert.equal(foreign.status, 403);
  const allowed = await h.request(browser, '/api/demo-upgrade', {}, { origin: PUBLIC_ORIGIN });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.plan, 'plus');
});
