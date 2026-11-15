import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerConfig } from '../server/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productionArgs = ['node', 'server/index.js', '--production'];
const publicEnv = () => ({ APP_ORIGIN: 'https://teachforward.example', SESSION_SECRET: 'config-test-only-stable-secret-long-enough', UPSTASH_REDIS_REST_URL: 'https://redis-fixture.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'config-test-placeholder-token', PORT: '4321' });

test('development uses local defaults and production requires an explicit origin and signing secret', () => {
  const dev = loadServerConfig({}, []);
  assert.equal(dev.port, 3001);
  assert.equal(dev.production, false);
  assert.equal(dev.appOrigin, undefined);
  assert.equal(dev.storage, 'file');
  assert.throws(() => loadServerConfig({}, productionArgs), /APP_ORIGIN/);
  assert.throws(() => loadServerConfig({ APP_ORIGIN: 'http://127.0.0.1:3001' }, productionArgs), /SESSION_SECRET/);
  assert.throws(() => loadServerConfig({ OPENAI_API_KEY: 'configuration-test-placeholder-only' }, []), /SESSION_SECRET/);
});

test('every production run requires both Redis credentials and never selects filesystem storage', () => {
  const env = publicEnv();
  const config = loadServerConfig(env, productionArgs);
  assert.equal(config.production, true);
  assert.equal(config.publicDeployment, true);
  assert.equal(config.port, 4321);
  assert.equal(config.storage, 'redis');
  assert.equal(config.dataDirectory, undefined);
  assert.equal(config.accessFile, undefined);
  assert.equal(config.usageFile, undefined);
  for (const key of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    const missing = { ...env }; delete missing[key];
    assert.throws(() => loadServerConfig(missing, productionArgs), /UPSTASH_REDIS_REST/);
  }
  const legacyDisk = { APP_ORIGIN: env.APP_ORIGIN, SESSION_SECRET: env.SESSION_SECRET, DATA_DIRECTORY: path.join(root, 'server/data'), PERSISTENT_STORAGE_CONFIRMED: '1' };
  assert.throws(() => loadServerConfig(legacyDisk, productionArgs), /UPSTASH_REDIS_REST/);
  const ignoredLegacy = loadServerConfig({ ...env, DATA_DIRECTORY: path.dirname(root), ACCESS_DATA_FILE: 'not-a-production-file', PERSISTENT_STORAGE_CONFIRMED: '1' }, productionArgs);
  assert.equal(ignoredLegacy.storage, 'redis');
  assert.equal(ignoredLegacy.accessFile, undefined);
});

test('Render cannot silently start as a local preview and local HTTP is limited to loopback', () => {
  assert.throws(() => loadServerConfig({ ...publicEnv(), RENDER: 'true' }, []), /production mode/);
  assert.throws(() => loadServerConfig({ ...publicEnv(), RENDER: 'true', APP_ORIGIN: 'http://localhost:3001' }, productionArgs), /public HTTPS/);
  assert.throws(() => loadServerConfig({ ...publicEnv(), APP_ORIGIN: 'http://teachforward.example' }, productionArgs), /HTTPS/);
  const local = loadServerConfig({ ...publicEnv(), APP_ORIGIN: 'http://127.0.0.1:3001' }, productionArgs);
  assert.equal(local.publicDeployment, false);
  assert.equal(local.production, true);
});

test('Render external URL is a validated fallback and explicit site origin takes priority', () => {
  const env = { ...publicEnv(), RENDER: 'true', APP_ORIGIN: '', RENDER_EXTERNAL_URL: 'https://teachforward-fixture.onrender.com' };
  assert.equal(loadServerConfig(env, productionArgs).appOrigin, env.RENDER_EXTERNAL_URL);
  assert.equal(loadServerConfig({ ...env, APP_ORIGIN: 'https://custom.example' }, productionArgs).appOrigin, 'https://custom.example');
  for (const origin of ['', 'http://public.example', 'https://public.example/path']) {
    assert.throws(() => loadServerConfig({ ...env, RENDER_EXTERNAL_URL: origin }, productionArgs), /APP_ORIGIN|HTTPS/);
  }
});

test('development files stay project-local and partial or unsafe Redis configuration fails closed', () => {
  const dataDirectory = path.join(root, 'tests/fixtures-data');
  assert.equal(loadServerConfig({ DATA_DIRECTORY: dataDirectory }, []).accessFile, path.join(dataDirectory, 'access.json'));
  assert.throws(() => loadServerConfig({ DATA_DIRECTORY: path.dirname(root) }, []), /inside/);
  assert.throws(() => loadServerConfig({ ACCESS_DATA_FILE: 'server/data/same.json', USAGE_DATA_FILE: 'server/data/same.json' }, []), /different/);
  const env = publicEnv();
  assert.equal(loadServerConfig(env, []).storage, 'redis');
  for (const invalid of [
    { UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL },
    { UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN },
    { ...env, UPSTASH_REDIS_REST_URL: 'http://redis-fixture.upstash.io' },
    { ...env, UPSTASH_REDIS_REST_URL: 'https://redis-fixture.upstash.io/command' },
    { ...env, UPSTASH_REDIS_REST_TOKEN: 'DO_NOT_EXPOSE_CONFIG_VALUE invalid' },
  ]) {
    assert.throws(() => loadServerConfig(invalid, []), error => error.code === 'CONFIG_ERROR' && !error.message.includes('DO_NOT_EXPOSE_CONFIG_VALUE'));
  }
});

test('origin, numeric limits, proxy settings and hashes fail with safe configuration errors', () => {
  const credentialOrigin = new URL('https://teachforward.example');
  credentialOrigin.username = 'example-user';
  credentialOrigin.password = 'example-placeholder';
  for (const origin of [credentialOrigin.href, 'https://teachforward.example/path', 'https://teachforward.example/?token=value', 'https://teachforward.example/#fragment']) {
    assert.throws(() => loadServerConfig({ ...publicEnv(), APP_ORIGIN: origin }, productionArgs), /APP_ORIGIN/);
  }
  for (const [key, value] of [['PORT', '0'], ['PORT', '65536'], ['PORT', 'DO_NOT_EXPOSE_CONFIG_VALUE'], ['AI_DAILY_REQUEST_LIMIT', '-1'], ['ACCESS_ID_IDLE_DAYS', '366'], ['ACCESS_ID_MAX_RECORDS', '10001'], ['ACCESS_ID_IP_BURST_LIMIT', '10001'], ['ACCESS_ID_IP_DAILY_LIMIT', '10001'], ['ACCESS_ID_GLOBAL_HOURLY_LIMIT', '10001'], ['ACCESS_ID_GLOBAL_DAILY_LIMIT', '10001'], ['TRUST_PROXY', 'true'], ['ADMIN_PASSWORD_HASH', 'DO_NOT_EXPOSE_CONFIG_VALUE']]) {
    assert.throws(() => loadServerConfig({ ...publicEnv(), [key]: value }, productionArgs), error => error.code === 'CONFIG_ERROR' && !error.message.includes('DO_NOT_EXPOSE_CONFIG_VALUE'));
  }
});
