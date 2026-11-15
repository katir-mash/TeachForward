import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedisClient } from '../server/redis-client.js';
import { createRedisStores } from '../server/redis-stores.js';

test('official Upstash SDK sends EVAL over REST without automatic pipelines or cached responses', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ result: JSON.stringify({ ok: { demoUpgradeEnabled: true } }) }), { headers: { 'content-type': 'application/json' } });
  };
  const redis = createRedisClient({ url: 'https://redis.example', token: 'redis-sdk-test-placeholder-token' });
  const stores = createRedisStores({ redis });
  assert.equal((await stores.accessStore.settings()).demoUpgradeEnabled, true);
  assert.equal((await stores.accessStore.settings()).demoUpgradeEnabled, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://redis.example');
  for (const { options } of requests) {
    const command = JSON.parse(options.body);
    assert.equal(command[0].toLowerCase(), 'eval');
    assert.equal(Number(command[2]), 6);
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.notEqual(requests[0].options.signal, requests[1].options.signal);
});

test('an ambiguous Upstash transport error is attempted once and its internal details are hidden', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('DO_NOT_EXPOSE_REDIS_INTERNALS'); };
  const stores = createRedisStores({ redis: createRedisClient({ url: 'https://redis.example', token: 'redis-sdk-test-placeholder-token' }) });
  await assert.rejects(stores.usageStore.reserve({ identityHash: 'a'.repeat(64), ipHash: 'b'.repeat(64), limit: 3, now: Date.now(), attemptSlots: 2 }), error => error.code === 'USAGE_STORAGE_UNAVAILABLE' && !error.message.includes('DO_NOT_EXPOSE'));
  assert.equal(calls, 1);
});

test('each Upstash request has a bounded timeout and a later command can still succeed', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (calls > 1) {
      assert.equal(options.signal.aborted, false);
      return new Response(JSON.stringify({ result: 'PONG' }), { headers: { 'content-type': 'application/json' } });
    }
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  };
  const redis = createRedisClient({ url: 'https://redis.example', token: 'redis-sdk-test-placeholder-token' }, { timeoutMs: 20 });
  // AbortSignal.timeout uses an unref timer; keep this isolated offline test alive.
  const hold = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(redis.ping());
    assert.equal(calls, 1);
    assert.equal(await redis.ping(), 'PONG');
    assert.equal(calls, 2);
  } finally { clearTimeout(hold); }
});
