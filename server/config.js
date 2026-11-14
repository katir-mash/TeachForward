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
  if (env.APP_ORIGIN?.trim()) {
    let url;
    try { url = new URL(env.APP_ORIGIN.trim()); } catch { throw configError('APP_ORIGIN must be an absolute site origin.'); }
    loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['http:', 'https:'].includes(url.protocol)) throw configError('APP_ORIGIN must contain only the site protocol, host and optional port.');
    if (url.protocol !== 'https:' && !loopback) throw configError('APP_ORIGIN must use HTTPS for a public site.');
    appOrigin = url.origin;
  }
  if (production && !appOrigin) throw configError('APP_ORIGIN is required in production. Use a loopback origin only for a local production preview.');
  const render = env.RENDER === 'true';
  if (render && (!production || !appOrigin?.startsWith('https:') || loopback)) throw configError('Render requires production mode and a public HTTPS APP_ORIGIN.');
  const publicDeployment = production && !loopback;
  if ((production || env.OPENAI_API_KEY?.trim() || env.ADMIN_PASSWORD_HASH) && (!env.SESSION_SECRET?.trim() || env.SESSION_SECRET.trim().length < 32)) throw configError('A stable SESSION_SECRET of at least 32 characters is required for production, AI or administrator access.');
  if (publicDeployment && (!env.DATA_DIRECTORY || !path.isAbsolute(env.DATA_DIRECTORY))) throw configError('Set DATA_DIRECTORY to the absolute persistent-disk mount directory.');
  if (publicDeployment && env.PERSISTENT_STORAGE_CONFIRMED !== '1') throw configError('Attach a persistent disk, then set PERSISTENT_STORAGE_CONFIRMED to acknowledge that requirement.');
  const dataDirectory = path.resolve(env.DATA_DIRECTORY || path.join(ROOT, 'server', 'data'));
  if (!within(ROOT, dataDirectory)) throw configError('DATA_DIRECTORY must be a directory inside the project.');
  const accessFile = path.resolve(env.ACCESS_DATA_FILE || path.join(dataDirectory, 'access.json'));
  const usageFile = path.resolve(env.USAGE_DATA_FILE || path.join(dataDirectory, 'usage.json'));
  for (const file of [accessFile, usageFile]) {
    if (!within(ROOT, file) || (publicDeployment && !within(dataDirectory, file))) throw configError('Access and usage files must remain inside the configured persistent project directory.');
  }
  if (accessFile === usageFile) throw configError('ACCESS_DATA_FILE and USAGE_DATA_FILE must be different files.');
  return {
    production, publicDeployment, port, appOrigin, dataDirectory, accessFile, usageFile,
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
