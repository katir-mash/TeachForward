import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerConfig } from '../server/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productionArgs = ['node', 'server/index.js', '--production'];
const publicEnv = () => ({ APP_ORIGIN: 'https://teachforward.example', SESSION_SECRET: 'config-test-only-stable-secret-long-enough', DATA_DIRECTORY: path.join(root, 'tests', 'fixtures-data'), PERSISTENT_STORAGE_CONFIRMED: '1', PORT: '4321' });

test('development uses local defaults and production requires an explicit origin and signing secret', () => {
  const dev = loadServerConfig({}, []);
  assert.equal(dev.port, 3001);
  assert.equal(dev.production, false);
  assert.equal(dev.appOrigin, undefined);
  assert.throws(() => loadServerConfig({}, productionArgs), /APP_ORIGIN/);
  assert.throws(() => loadServerConfig({ APP_ORIGIN: 'http://127.0.0.1:3001' }, productionArgs), /SESSION_SECRET/);
  assert.throws(() => loadServerConfig({ OPENAI_API_KEY: 'configuration-test-placeholder-only' }, []), /SESSION_SECRET/);
});

test('public deployment requires an explicit persistent disk configuration and isolates both ledgers', () => {
  const env = publicEnv();
  const config = loadServerConfig(env, productionArgs);
  assert.equal(config.production, true);
  assert.equal(config.publicDeployment, true);
  assert.equal(config.port, 4321);
  assert.equal(config.accessFile, path.join(env.DATA_DIRECTORY, 'access.json'));
  assert.equal(config.usageFile, path.join(env.DATA_DIRECTORY, 'usage.json'));
  for (const key of ['DATA_DIRECTORY', 'PERSISTENT_STORAGE_CONFIRMED']) {
    const missing = { ...env }; delete missing[key];
    assert.throws(() => loadServerConfig(missing, productionArgs), /persistent|PERSISTENT|DATA_DIRECTORY/);
  }
  assert.throws(() => loadServerConfig({ ...env, DATA_DIRECTORY: 'server/data' }, productionArgs), /absolute/);
  assert.throws(() => loadServerConfig({ ...env, DATA_DIRECTORY: path.dirname(root) }, productionArgs), /inside/);
  assert.throws(() => loadServerConfig({ ...env, USAGE_DATA_FILE: path.join(root, 'usage.json') }, productionArgs), /persistent/);
  assert.throws(() => loadServerConfig({ ...env, USAGE_DATA_FILE: path.join(env.DATA_DIRECTORY, 'access.json') }, productionArgs), /different/);
});

test('Render cannot silently start as a local preview and local HTTP is limited to loopback', () => {
  assert.throws(() => loadServerConfig({ ...publicEnv(), RENDER: 'true' }, []), /production mode/);
  assert.throws(() => loadServerConfig({ ...publicEnv(), RENDER: 'true', APP_ORIGIN: 'http://localhost:3001' }, productionArgs), /public HTTPS/);
  assert.throws(() => loadServerConfig({ ...publicEnv(), APP_ORIGIN: 'http://teachforward.example' }, productionArgs), /HTTPS/);
  const local = loadServerConfig({ APP_ORIGIN: 'http://127.0.0.1:3001', SESSION_SECRET: publicEnv().SESSION_SECRET }, productionArgs);
  assert.equal(local.publicDeployment, false);
  assert.equal(local.production, true);
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
