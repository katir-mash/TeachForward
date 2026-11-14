import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { SAMPLE_PROFILE, buildRoadmap } from '../shared/roadmap.js';

async function harness(t, options = {}) {
  const app = createApp({ client: null, sessionSecret: 'test-secret-not-a-real-secret', ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  return {
    origin,
    get cookie() { return cookie; },
    async request(route, { method = 'GET', body, headers = {} } = {}) {
      const response = await fetch(`${origin}${route}`, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}), ...headers },
        ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, headers: response.headers, data: await response.json() };
    },
  };
}

const question = () => ({ message: 'What should I do next?', profile: SAMPLE_PROFILE, completedTaskIds: [] });

test('missing API key returns honest unavailable state while health and sessions work', async (t) => {
  const h = await harness(t);
  const health = await h.request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.aiConfigured, false);
  const session = await h.request('/api/session');
  assert.equal(session.data.plan, 'basic');
  assert.equal(session.data.usage.limit, 3);
  assert.match(session.headers.get('set-cookie'), /HttpOnly/);
  assert.match(session.headers.get('set-cookie'), /SameSite=Lax/);
  const mentor = await h.request('/api/mentor', { method: 'POST', body: question() });
  assert.equal(mentor.status, 503);
  assert.equal(mentor.data.code, 'AI_NOT_CONFIGURED');
  assert.match(mentor.data.error, /roadmap.*work/i);
  assert.equal((await h.request('/api/session')).data.usage.used, 0);
});

test('Plus is server enforced; upgrade unlocks data and reset restores paywall', async (t) => {
  const h = await harness(t);
  const locked = await h.request('/api/plus', { method: 'POST', body: { profile: SAMPLE_PROFILE, plan: 'plus' } });
  assert.equal(locked.status, 403);
  assert.equal(locked.data.code, 'PLUS_REQUIRED');
  const upgraded = await h.request('/api/demo-upgrade', { method: 'POST', body: {} });
  assert.equal(upgraded.data.plan, 'plus');
  assert.equal(upgraded.data.usage.limit, 20);
  const unlocked = await h.request('/api/plus', { method: 'POST', body: { profile: SAMPLE_PROFILE } });
  assert.equal(unlocked.status, 200);
  assert.ok(unlocked.data.weeklyPlan.length > 0);
  assert.ok(unlocked.data.skillExercises.length > 0);
  assert.equal((await h.request('/api/session')).data.plan, 'plus');
  await h.request('/api/demo-reset', { method: 'POST', body: {} });
  assert.equal((await h.request('/api/plus', { method: 'POST', body: { profile: SAMPLE_PROFILE } })).status, 403);
});

test('tampering with the signed session cookie cannot grant Plus', async (t) => {
  const h = await harness(t);
  await h.request('/api/demo-upgrade', { method: 'POST', body: {} });
  const tampered = h.cookie.slice(0, -1) + (h.cookie.endsWith('a') ? 'b' : 'a');
  const session = await h.request('/api/session', { headers: { cookie: tampered } });
  assert.equal(session.data.plan, 'basic');
});

test('invalid user input, foreign origins, malformed and oversized JSON are rejected', async (t) => {
  const h = await harness(t);
  const foreign = await h.request('/api/demo-upgrade', { method: 'POST', body: {}, headers: { origin: 'https://another-site.example' } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.data.code, 'ORIGIN_REJECTED');
  assert.equal((await h.request('/api/mentor', { method: 'POST', body: { ...question(), message: '' } })).status, 400);
  assert.equal((await h.request('/api/mentor', { method: 'POST', body: { ...question(), message: 'x'.repeat(1201) } })).status, 400);
  assert.equal((await h.request('/api/mentor', { method: 'POST', body: { ...question(), profile: { education: 'invented' } } })).data.code, 'INVALID_PROFILE');
  assert.equal((await h.request('/api/mentor', { method: 'POST', body: { ...question(), completedTaskIds: ['fake-task'] } })).data.code, 'INVALID_PROGRESS');
  assert.equal((await h.request('/api/mentor', { method: 'POST', body: '{not json' })).data.code, 'INVALID_JSON');
  assert.equal((await h.request('/api/mentor', { method: 'POST', body: { message: 'x'.repeat(20_000) } })).status, 413);
  assert.equal((await h.request('/api/unknown')).status, 404);
});

test('real question and server-regenerated progress reach Responses API; basic daily cap is enforced', async (t) => {
  const calls = [];
  const client = { responses: { create: async (...args) => { calls.push(args); return { status: 'completed', output_text: 'Confirm your preparation program eligibility, then practice explaining a math concept.' }; } } };
  const h = await harness(t, { client });
  const task = buildRoadmap(SAMPLE_PROFILE).tasks[0];
  const payload = { ...question(), message: 'How do my math skills help?', completedTaskIds: [task.id], sources: [{ url: 'https://fake.example' }], plan: 'plus' };
  const result = await h.request('/api/mentor', { method: 'POST', body: payload });
  assert.equal(result.status, 200);
  assert.equal(result.data.remaining, 2);
  assert.ok(result.data.sources.every((source) => source.url.startsWith('https://tea.texas.gov/')));
  const [request, sdkOptions] = calls[0];
  assert.equal(request.store, false);
  assert.equal(request.input[1].content, payload.message);
  const context = JSON.parse(request.input[0].content.split('\n').slice(1).join('\n'));
  assert.equal(context.tasks.find((item) => item.id === task.id).completed, true);
  assert.equal(context.profile.subject, SAMPLE_PROFILE.subject);
  assert.ok(!JSON.stringify(context).includes('fake.example'));
  assert.equal(sdkOptions.maxRetries, 1);
  assert.equal(sdkOptions.timeout, 20_000);
  await h.request('/api/mentor', { method: 'POST', body: question() });
  await h.request('/api/mentor', { method: 'POST', body: question() });
  const limit = await h.request('/api/mentor', { method: 'POST', body: question() });
  assert.equal(limit.status, 429);
  assert.equal(limit.data.code, 'DAILY_LIMIT');
  assert.equal(calls.length, 3);
  await h.request('/api/demo-upgrade', { method: 'POST', body: {} });
  assert.equal((await h.request('/api/mentor', { method: 'POST', body: question() })).status, 200);
});

test('provider failures, empty output and timeout stay truthful without exposing error details', async (t) => {
  for (const mode of ['failure', 'empty', 'timeout', 'incomplete']) {
    const client = { responses: { create: async () => {
      if (mode === 'failure') throw new Error('DO_NOT_EXPOSE_PROVIDER_DETAILS');
      if (mode === 'timeout') { const error = new Error('DO_NOT_EXPOSE_PROVIDER_DETAILS'); error.name = 'APIConnectionTimeoutError'; throw error; }
      return { output_text: mode === 'empty' ? '' : 'A partial answer', status: mode === 'incomplete' ? 'incomplete' : 'completed' };
    } } };
    const h = await harness(t, { client });
    const result = await h.request('/api/mentor', { method: 'POST', body: question() });
    assert.equal(result.status, mode === 'timeout' ? 504 : 502);
    assert.ok(!JSON.stringify(result.data).includes('DO_NOT_EXPOSE'));
    assert.equal((await h.request('/api/session')).data.usage.used, 0);
  }
});

test('per-IP rate limit survives new or missing cookies', async (t) => {
  const h = await harness(t, { rateLimit: 2 });
  for (let i = 0; i < 2; i++) await h.request('/api/mentor', { method: 'POST', body: question(), headers: { cookie: '' } });
  const result = await h.request('/api/mentor', { method: 'POST', body: question(), headers: { cookie: '' } });
  assert.equal(result.status, 429);
  assert.equal(result.data.code, 'RATE_LIMITED');
  assert.ok(Number(result.headers.get('retry-after')) > 0);
});

test('rejected provider credentials show an actionable error without leaking provider text', async (t) => {
  const client = { responses: { create: async () => {
    const error = new Error('DO_NOT_EXPOSE_PROVIDER_AUTH_DETAILS');
    error.status = 401;
    throw error;
  } } };
  const h = await harness(t, { client });
  const result = await h.request('/api/mentor', { method: 'POST', body: question() });
  assert.equal(result.status, 502);
  assert.equal(result.data.code, 'AI_AUTHENTICATION');
  assert.match(result.data.error, /did not accept the server API key/);
  assert.ok(!JSON.stringify(result.data).includes('DO_NOT_EXPOSE'));
  assert.equal((await h.request('/api/session')).data.usage.used, 0);
});

test('mentor deadline aborts the upstream request and releases the allowance', async (t) => {
  let aborted = false;
  const client = { responses: { create: (_request, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
  }) } };
  const h = await harness(t, { client, timeoutMs: 25 });
  const result = await h.request('/api/mentor', { method: 'POST', body: question() });
  assert.equal(result.status, 504);
  assert.equal(result.data.code, 'AI_TIMEOUT');
  assert.equal(aborted, true);
  assert.equal((await h.request('/api/session')).data.usage.used, 0);
});

test('concurrent mentor requests cannot consume more than one allowance slot', async (t) => {
  let release;
  const client = { responses: { create: () => new Promise((resolve) => { release = resolve; }) } };
  const h = await harness(t, { client });
  await h.request('/api/session');
  const first = h.request('/api/mentor', { method: 'POST', body: question() });
  // Wait for the request to enter the injected provider without a fixed sleep.
  for (let attempt = 0; !release && attempt < 100; attempt++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  const second = await h.request('/api/mentor', { method: 'POST', body: question() });
  assert.equal(second.status, 429);
  assert.equal(second.data.code, 'REQUEST_IN_PROGRESS');
  release({ output_text: 'Start with your next unchecked roadmap task.', status: 'completed' });
  assert.equal((await first).status, 200);
  assert.equal((await h.request('/api/session')).data.usage.used, 1);
});

test('production serves built assets and SPA routes while API misses remain JSON', async (t) => {
  const testsRoot = path.dirname(fileURLToPath(import.meta.url));
  const fixture = mkdtempSync(path.join(testsRoot, 'static-test-'));
  t.after(() => {
    const resolved = path.resolve(fixture);
    if (!resolved.startsWith(`${path.resolve(testsRoot)}${path.sep}static-test-`)) throw new Error('Refusing cleanup outside the test fixture directory.');
    rmSync(resolved, { recursive: true, force: true });
  });
  writeFileSync(path.join(fixture, 'index.html'), '<!doctype html><html><body>TeachForward production fixture</body></html>');
  writeFileSync(path.join(fixture, 'bundle.js'), 'console.log("fixture asset");');
  const h = await harness(t, { production: true, distPath: fixture, appOrigin: 'https://teachforward.example' });
  for (const route of ['/', '/my-roadmap']) {
    const response = await fetch(`${h.origin}${route}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(await response.text(), /TeachForward production fixture/);
  }
  const asset = await fetch(`${h.origin}/bundle.js`);
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /fixture asset/);
  const missingApi = await h.request('/api/does-not-exist');
  assert.equal(missingApi.status, 404);
  assert.equal(missingApi.data.code, 'NOT_FOUND');
  const session = await h.request('/api/session');
  assert.match(session.headers.get('set-cookie'), /; Secure/);
  assert.equal(session.headers.get('cache-control'), 'no-store');
});
