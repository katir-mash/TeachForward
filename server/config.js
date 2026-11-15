import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validAdminHash } from './admin.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configError = message => Object.assign(new Error(message), { code: 'CONFIG_ERROR' });
const within = (directory, file) => file.startsWith(`${directory}${path.sep}`);

function integer(env, name, fallback, max = 100_000) {
  const raw = env[name] ?? String(fallback);
  if (!/^\d+$/.test(String(raw))) throw configError(`${name} must be a positive integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw configError(`${name} is outside its supported range.`);
  return value;
}

export function loadServerConfig(env = process.env, args = process.argv) {
  const production = args.includes('--production') || env.NODE_ENV === 'production';
  if (env.TRUST_PROXY && !['0', '1'].includes(env.TRUST_PROXY)) throw configError('TRUST_PROXY must be 0 or 1 for the supported single-proxy configuration.');
  if (env.ADMIN_PASSWORD_HASH && !validAdminHash(env.ADMIN_PASSWORD_HASH)) throw configError('ADMIN_PASSWORD_HASH is not a supported administrator hash.');
  const port = integer(env, 'PORT', 3001, 65535);
  let appOrigin;
  let loopback = true;
  const origin = env.APP_ORIGIN?.trim() || env.RENDER_EXTERNAL_URL?.trim();
  if (origin) {
    let url;
    try { url = new URL(origin); } catch { throw configError('APP_ORIGIN or RENDER_EXTERNAL_URL must be an absolute site origin.'); }
    loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['http:', 'https:'].includes(url.protocol)) throw configError('APP_ORIGIN must contain only the site protocol, host and optional port.');
    if (url.protocol !== 'https:' && !loopback) throw configError('APP_ORIGIN must use HTTPS for a public site.');
    appOrigin = url.origin;
  }
  if (production && !appOrigin) throw configError('APP_ORIGIN or RENDER_EXTERNAL_URL is required in production. Use a loopback origin only for a local production preview.');
  const render = env.RENDER === 'true';
  if (render && (!production || !appOrigin?.startsWith('https:') || loopback)) throw configError('Render requires production mode and a public HTTPS APP_ORIGIN.');
  const publicDeployment = production && !loopback;
  if ((production || env.OPENAI_API_KEY?.trim() || env.ADMIN_PASSWORD_HASH) && (!env.SESSION_SECRET?.trim() || env.SESSION_SECRET.trim().length < 32)) throw configError('A stable SESSION_SECRET of at least 32 characters is required for production, AI or administrator access.');
  const redisUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if ((production || redisUrl || redisToken) && (!redisUrl || !redisToken)) throw configError('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required together; production requires Redis.');
  if (redisUrl) {
    let url;
    try { url = new URL(redisUrl); } catch { throw configError('UPSTASH_REDIS_REST_URL must be a valid HTTPS REST origin.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw configError('UPSTASH_REDIS_REST_URL must contain only an HTTPS REST origin.');
    if (redisToken.length > 8192 || /\s|[\u0000-\u001f\u007f]/.test(redisToken)) throw configError('UPSTASH_REDIS_REST_TOKEN is not a supported REST token.');
  }
  const storage = redisUrl ? 'redis' : 'file';
  let dataDirectory;
  let accessFile;
  let usageFile;
  // Local files are a development convenience only; public and local production
  // both require Redis. Legacy disk acknowledgement cannot bypass that check.
  if (storage === 'file') {
    dataDirectory = path.resolve(env.DATA_DIRECTORY || path.join(ROOT, 'server', 'data'));
    if (!within(ROOT, dataDirectory)) throw configError('DATA_DIRECTORY must be a directory inside the project.');
    accessFile = path.resolve(env.ACCESS_DATA_FILE || path.join(dataDirectory, 'access.json'));
    usageFile = path.resolve(env.USAGE_DATA_FILE || path.join(dataDirectory, 'usage.json'));
    if (![accessFile, usageFile].every(file => within(ROOT, file))) throw configError('Access and usage files must remain inside the development project directory.');
    if (accessFile === usageFile) throw configError('ACCESS_DATA_FILE and USAGE_DATA_FILE must be different files.');
  }
  return {
    production, publicDeployment, port, appOrigin, storage, redisUrl, redisToken, dataDirectory, accessFile, usageFile,
    accessOptions: {
      maxVisitors: integer(env, 'ACCESS_ID_MAX_RECORDS', 10_000, 10_000),
      inactiveTtlMs: integer(env, 'ACCESS_ID_IDLE_DAYS', 30, 365) * 86_400_000,
      ipBurstLimit: integer(env, 'ACCESS_ID_IP_BURST_LIMIT', 5, 10_000),
      ipDailyLimit: integer(env, 'ACCESS_ID_IP_DAILY_LIMIT', 40, 10_000),
      globalHourlyLimit: integer(env, 'ACCESS_ID_GLOBAL_HOURLY_LIMIT', 100, 10_000),
      globalDailyLimit: integer(env, 'ACCESS_ID_GLOBAL_DAILY_LIMIT', 1000, 10_000),
    },
    usageOptions: {
      dayLimit: integer(env, 'AI_DAILY_REQUEST_LIMIT', 100),
      ipDayLimit: integer(env, 'AI_IP_DAILY_REQUEST_LIMIT', 30),
    },
  };
}
