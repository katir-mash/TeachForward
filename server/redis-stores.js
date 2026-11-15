import { createHash, randomBytes } from 'node:crypto';

const DAY = 86_400_000;
const HASH = /^[a-f0-9]{64}$/;
const ACCESS_ID = /^TF-[A-F0-9]{12}$/;
const RESERVATION_ID = /^[a-f0-9]{32}$/;
const error = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

// Every accessed key is explicitly supplied in KEYS and shares the same hash tag.
// No REST-side read/modify/write race, local mirror, lock expiry or fallback file.
export const ACCESS_SCRIPT = `
local op = ARGV[1]
local now = tonumber(ARGV[2])
local identity = ARGV[3]
local candidate = ARGV[4]
local ip = ARGV[5]
local cfg = cjson.decode(ARGV[6])
local DAY = 86400000.0
local function result(value) return cjson.encode({ok=value}) end
local function failure(code, retry) return cjson.encode({error=code,retryAfter=retry}) end
local function validtype(key, expected)
  local kind = redis.call('TYPE', key)
  if type(kind) == 'table' then kind = kind.ok end
  return kind == 'none' or kind == expected
end
if not validtype(KEYS[1], 'hash') or not validtype(KEYS[2], 'hash') or not validtype(KEYS[3], 'zset') or not validtype(KEYS[4], 'zset') or not validtype(KEYS[5], 'zset') or not validtype(KEYS[6], 'hash') then
  return failure('ACCESS_STORAGE_UNAVAILABLE')
end
local function digest(value) return type(value) == 'string' and string.len(value) == 64 and not string.find(value, '[^a-f0-9]') end
local function timestamp(value) return type(value) == 'number' and value >= 0 and value < 9007199254740991 end
local function nullabletime(value) return value == nil or value == cjson.null or timestamp(value) end
local function decode(raw)
  if not raw then return nil end
  local good, value = pcall(cjson.decode, raw)
  if not good or type(value) ~= 'table' or not digest(value.identityHash) or type(value.accessId) ~= 'string' or string.len(value.accessId) ~= 15 or not string.match(value.accessId, '^TF%-[A-F0-9]+$') or not timestamp(value.createdAt) or not timestamp(value.lastSeenAt) or not nullabletime(value.manualExpiresAt) or not nullabletime(value.demoExpiresAt) then return nil end
  if value.manualExpiresAt == nil then value.manualExpiresAt = cjson.null end
  if value.demoExpiresAt == nil then value.demoExpiresAt = cjson.null end
  return value
end
local function number(value) if type(value) == 'number' then return value else return 0 end end
local function expires(visitor)
  return math.max(visitor.lastSeenAt, number(visitor.manualExpiresAt), number(visitor.demoExpiresAt)) + cfg.inactiveTtlMs
end
local function retained(visitor) return expires(visitor) > now end
local function save(visitor)
  redis.call('HSET', KEYS[1], visitor.identityHash, cjson.encode(visitor))
  redis.call('HSET', KEYS[2], visitor.accessId, visitor.identityHash)
  redis.call('ZADD', KEYS[3], expires(visitor), visitor.identityHash)
end
local enabled = redis.call('HGET', KEYS[6], 'demoUpgradeEnabled')
if enabled and enabled ~= '0' and enabled ~= '1' then return failure('ACCESS_STORAGE_UNAVAILABLE') end
local count = redis.call('HLEN', KEYS[1])
if count > 10000 or count ~= redis.call('HLEN', KEYS[2]) or count ~= redis.call('ZCARD', KEYS[3]) then return failure('ACCESS_STORAGE_UNAVAILABLE') end
local function byid(accessId)
  local hash = redis.call('HGET', KEYS[2], accessId)
  if not hash then return nil end
  local visitor = decode(redis.call('HGET', KEYS[1], hash))
  if not visitor or visitor.identityHash ~= hash or visitor.accessId ~= accessId then return false end
  return visitor
end
local function prune()
  local stale = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)
  local removing = {}
  for _, hash in ipairs(stale) do
    local visitor = decode(redis.call('HGET', KEYS[1], hash))
    if not visitor or visitor.identityHash ~= hash or redis.call('HGET', KEYS[2], visitor.accessId) ~= hash or retained(visitor) then return false end
    table.insert(removing, visitor)
  end
  for _, visitor in ipairs(removing) do
    redis.call('HDEL', KEYS[1], visitor.identityHash)
    redis.call('HDEL', KEYS[2], visitor.accessId)
    redis.call('ZREM', KEYS[3], visitor.identityHash)
  end
  redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now - DAY)
  redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now - DAY)
  return #removing
end
if op == 'cleanup' or op == 'identity' then
  local removed = prune()
  if removed == false then return failure('ACCESS_STORAGE_UNAVAILABLE') end
  if op == 'cleanup' then return result({removed=removed,remaining=redis.call('HLEN', KEYS[1])}) end
end
if op == 'settings' then return result({demoUpgradeEnabled=enabled ~= '0'}) end
if op == 'setDemoEnabled' then
  redis.call('HSET', KEYS[6], 'demoUpgradeEnabled', ARGV[7])
  return result({demoUpgradeEnabled=ARGV[7] == '1'})
end
if op == 'list' then
  local visitors = {}
  for _, raw in ipairs(redis.call('HVALS', KEYS[1])) do
    local visitor = decode(raw)
    if not visitor or redis.call('HGET', KEYS[2], visitor.accessId) ~= visitor.identityHash then return failure('ACCESS_STORAGE_UNAVAILABLE') end
    table.insert(visitors, visitor)
  end
  -- Empty Lua tables encode as objects. JS normalizes this one empty-array case.
  return result(visitors)
end
if op == 'identity' or op == 'getIdentity' then
  local raw = redis.call('HGET', KEYS[1], identity)
  local visitor = decode(raw)
  if raw and (not visitor or visitor.identityHash ~= identity or redis.call('HGET', KEYS[2], visitor.accessId) ~= identity) then return failure('ACCESS_STORAGE_UNAVAILABLE') end
  if visitor and retained(visitor) then
    if op == 'identity' and now - visitor.lastSeenAt >= 60000 then visitor.lastSeenAt = now; save(visitor) end
    return result(visitor)
  end
  if op == 'getIdentity' then return result(cjson.null) end
  if redis.call('HLEN', KEYS[1]) >= cfg.maxVisitors then return failure('ACCESS_STORAGE_FULL', 300) end
  local wait = 0
  local function enforce(key, duration, limit)
    local minimum = '(' .. tostring(now - duration)
    local recent = redis.call('ZCOUNT', key, minimum, '+inf')
    if recent >= limit then
      local oldest = redis.call('ZRANGEBYSCORE', key, minimum, '+inf', 'WITHSCORES', 'LIMIT', recent - limit, 1)
      wait = math.max(wait, tonumber(oldest[2]) + duration - now)
    end
  end
  enforce(KEYS[4], 3600000, cfg.globalHourlyLimit)
  enforce(KEYS[4], DAY, cfg.globalDailyLimit)
  if ip ~= '' then enforce(KEYS[5], cfg.ipBurstWindowMs, cfg.ipBurstLimit); enforce(KEYS[5], DAY, cfg.ipDailyLimit) end
  if wait > 0 then return failure('ACCESS_CREATION_RATE_LIMIT', math.max(1, math.ceil(wait / 1000))) end
  if redis.call('ZCARD', KEYS[4]) >= 10000 then return failure('ACCESS_CREATION_RATE_LIMIT', 300) end
  if redis.call('HGET', KEYS[2], candidate) then return failure('ACCESS_STORAGE_UNAVAILABLE') end
  visitor = {accessId=candidate,identityHash=identity,createdAt=now,lastSeenAt=now,manualExpiresAt=cjson.null,demoExpiresAt=cjson.null}
  save(visitor)
  redis.call('ZADD', KEYS[4], now, candidate)
  redis.call('EXPIRE', KEYS[4], 86401)
  if ip ~= '' then redis.call('ZADD', KEYS[5], now, candidate); redis.call('EXPIRE', KEYS[5], 86401) end
  return result(visitor)
end
local visitor = byid(identity)
if visitor == false then return failure('ACCESS_STORAGE_UNAVAILABLE') end
if not visitor then
  if op == 'getByAccessId' then return result(cjson.null) end
  return failure('ACCESS_NOT_FOUND')
end
if op == 'getByAccessId' then return result(visitor) end
if op == 'grant' then
  local days = tonumber(ARGV[7])
  local expiry = math.max(now, number(visitor.manualExpiresAt)) + days * DAY
  if expiry > now + 365 * DAY then return failure('INVALID_GRANT') end
  visitor.manualExpiresAt = expiry
elseif op == 'revoke' then
  visitor.manualExpiresAt = cjson.null
  visitor.demoExpiresAt = cjson.null
elseif op == 'setDemo' then
  if ARGV[7] == '1' then
    if enabled == '0' then return failure('DEMO_DISABLED') end
    visitor.demoExpiresAt = tonumber(ARGV[8])
  else visitor.demoExpiresAt = cjson.null end
else return failure('ACCESS_STORAGE_UNAVAILABLE') end
save(visitor)
return result(visitor)
`;

export const USAGE_SCRIPT = `
local op = ARGV[1]
local identity = ARGV[2]
local limit = tonumber(ARGV[3])
local ip = ARGV[4]
local globalLimit = tonumber(ARGV[5])
local ipLimit = tonumber(ARGV[6])
local slots = tonumber(ARGV[7])
local id = ARGV[8]
local ttl = tonumber(ARGV[9])
local function result(value) return cjson.encode({ok=value}) end
local function failure(code) return cjson.encode({error=code}) end
local kind = redis.call('TYPE', KEYS[1])
if type(kind) == 'table' then kind = kind.ok end
if kind ~= 'none' and kind ~= 'hash' then return failure('USAGE_STORAGE_UNAVAILABLE') end
local function count(field)
  local raw = redis.call('HGET', KEYS[1], field)
  if not raw then return 0 end
  local value = tonumber(raw)
  if not value or value < 0 or value > 100000 or value ~= math.floor(value) then return nil end
  return value
end
local used = count('v:' .. identity)
local global = count('attemptSlots')
if not used or not global or used > global then return failure('USAGE_STORAGE_UNAVAILABLE') end
if op == 'usage' then return result({used=used}) end
if op == 'usageMany' then
  local entries = cjson.decode(ARGV[11])
  local counts = {}
  for _, entry in ipairs(entries) do
    local value = count('v:' .. entry.identityHash)
    if not value or value > global then return failure('USAGE_STORAGE_UNAVAILABLE') end
    table.insert(counts, value)
  end
  return result(counts)
end
if op == 'reserve' then
  local network = count('ip:' .. ip)
  if not network or network > global then return failure('USAGE_STORAGE_UNAVAILABLE') end
  local existing = redis.call('HGET', KEYS[1], 'r:' .. id)
  if existing then
    if existing ~= identity then return failure('USAGE_STORAGE_UNAVAILABLE') end
    return result(true)
  end
  if used >= limit then return failure('VISITOR_DAILY_LIMIT') end
  if network + slots > ipLimit then return failure('IP_DAILY_LIMIT') end
  if global + slots > globalLimit then return failure('GLOBAL_DAILY_LIMIT') end
  redis.call('HSET', KEYS[1], 'v:' .. identity, used + 1, 'ip:' .. ip, network + slots, 'attemptSlots', global + slots, 'r:' .. id, identity)
  redis.call('EXPIRE', KEYS[1], ttl)
  return result(true)
end
if op == 'finish' then
  local recorded = redis.call('HGET', KEYS[1], 'r:' .. id)
  if not recorded then return result(false) end
  if recorded ~= identity or used < 1 then return failure('USAGE_STORAGE_UNAVAILABLE') end
  redis.call('HDEL', KEYS[1], 'r:' .. id)
  if ARGV[10] == '0' then redis.call('HSET', KEYS[1], 'v:' .. identity, used - 1) end
  return result(true)
end
return failure('USAGE_STORAGE_UNAVAILABLE')
`;

export const LIMITER_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local kind = redis.call('TYPE', KEYS[1])
if type(kind) == 'table' then kind = kind.ok end
if kind ~= 'none' and kind ~= 'zset' then return cjson.encode({error='SECURITY_STORAGE_UNAVAILABLE'}) end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return cjson.encode({ok={allowed=false,retryAfter=math.max(1,math.ceil((tonumber(oldest[2]) + window - now) / 1000))}})
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('EXPIRE', KEYS[1], math.ceil(window / 1000) + 1)
return cjson.encode({ok={allowed=true,retryAfter=0}})
`;

const MESSAGES = {
  ACCESS_STORAGE_UNAVAILABLE: 'Access storage is unavailable. Please try again later.',
  USAGE_STORAGE_UNAVAILABLE: 'Mentor usage storage is unavailable. No provider request may be started.',
  SECURITY_STORAGE_UNAVAILABLE: 'Request protection is unavailable. Please try again later.',
  ACCESS_STORAGE_FULL: 'New browser access is temporarily unavailable. Existing active access is preserved.',
  ACCESS_CREATION_RATE_LIMIT: 'Too many new browser identities were requested. Please wait before trying again.',
  ACCESS_NOT_FOUND: 'No visitor has this Access ID.',
  INVALID_GRANT: 'Total remaining access cannot exceed 365 days. Choose fewer days.',
  DEMO_DISABLED: 'Demo upgrades are currently disabled.',
  VISITOR_DAILY_LIMIT: 'This browser has used its daily mentor allowance.',
  IP_DAILY_LIMIT: 'The daily mentor request limit for this network has been reached.',
  GLOBAL_DAILY_LIMIT: 'The service has reached its daily mentor request limit.',
};

function integer(value, name, max = 100_000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new TypeError(`${name} is outside its supported range.`);
  return value;
}
function time(now) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw new TypeError('A valid server timestamp is required.');
}
function identityHash(privateId) {
  if (typeof privateId !== 'string' || !/^[a-f0-9]{48}$/.test(privateId)) throw new TypeError('A valid browser identity is required.');
  return createHash('sha256').update(privateId).digest('hex');
}
function digest(hash) {
  if (typeof hash !== 'string' || !HASH.test(hash)) throw new TypeError('A SHA-256 digest is required.');
}
function accessId(value) {
  if (typeof value !== 'string' || !ACCESS_ID.test(value)) throw error('ACCESS_NOT_FOUND', MESSAGES.ACCESS_NOT_FOUND);
}
function dayAt(now) {
  time(now);
  return new Date(now).toISOString().slice(0, 10);
}

/** Durable stores backed only by Redis. The caller must disable ambiguous SDK retries. */
export function createRedisStores({ redis, accessOptions = {}, usageOptions = {}, prefix = 'teachforward:v1' } = {}) {
  if (!redis || typeof redis.eval !== 'function') throw new TypeError('A Redis client is required.');
  if (typeof prefix !== 'string' || !/^[A-Za-z0-9:_-]{1,80}$/.test(prefix)) throw new TypeError('Invalid Redis namespace.');
  const base = `{${prefix}}`;
  const config = {
    maxVisitors: 10_000, inactiveTtlMs: 30 * DAY, ipBurstLimit: 5, ipBurstWindowMs: 600_000,
    ipDailyLimit: 40, globalHourlyLimit: 100, globalDailyLimit: 1000, ...accessOptions,
  };
  integer(config.maxVisitors, 'maxVisitors', 10_000);
  integer(config.inactiveTtlMs, 'inactiveTtlMs', 365 * DAY);
  integer(config.ipBurstWindowMs, 'ipBurstWindowMs', DAY);
  for (const name of ['ipBurstLimit', 'ipDailyLimit', 'globalHourlyLimit', 'globalDailyLimit']) integer(config[name], name, 10_000);
  const dayLimit = integer(usageOptions.dayLimit ?? 100, 'dayLimit');
  const ipDayLimit = integer(usageOptions.ipDayLimit ?? 30, 'ipDayLimit');

  async function evaluate(script, keys, args, unavailable) {
    let value;
    try {
      const raw = await redis.eval(script, keys, args);
      value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch { throw error(unavailable, MESSAGES[unavailable]); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error(unavailable, MESSAGES[unavailable]);
    if (value.error) {
      const code = Object.hasOwn(MESSAGES, value.error) ? value.error : unavailable;
      const retryAfter = Number.isSafeInteger(value.retryAfter) && value.retryAfter > 0 ? value.retryAfter : undefined;
      throw error(code, MESSAGES[code], retryAfter ? { retryAfter } : {});
    }
    if (!Object.hasOwn(value, 'ok')) throw error(unavailable, MESSAGES[unavailable]);
    return value.ok;
  }
  const accessKeys = ip => [
    `${base}:access:visitors`, `${base}:access:ids`, `${base}:access:expiry`,
    `${base}:access:admission`, `${base}:access:admission:ip:${ip || 'none'}`, `${base}:access:settings`,
  ];
  const accessCall = (op, now = 0, hash = '', ip = '', extras = []) => evaluate(ACCESS_SCRIPT, accessKeys(ip), [op, now, hash, `TF-${randomBytes(6).toString('hex').toUpperCase()}`, ip, JSON.stringify(config), ...extras], 'ACCESS_STORAGE_UNAVAILABLE');
  const usageKey = day => `${base}:usage:${day}`;
  const usageCall = (op, hash, limit, ip, slots, id, day, ttl, success = '', entries = '') => evaluate(USAGE_SCRIPT, [usageKey(day)], [op, hash, limit, ip, dayLimit, ipDayLimit, slots, id, ttl, success, entries], 'USAGE_STORAGE_UNAVAILABLE');

  const accessStore = {
    async getIdentity(privateId, now) { time(now); return accessCall('getIdentity', now, identityHash(privateId)); },
    async identity(privateId, now, { ipHash = null } = {}) {
      time(now); if (ipHash !== null) digest(ipHash);
      return accessCall('identity', now, identityHash(privateId), ipHash ?? '');
    },
    async cleanup(now) { time(now); return accessCall('cleanup', now); },
    async list() {
      const value = await accessCall('list');
      return Array.isArray(value) ? value : (value && Object.keys(value).length === 0 ? [] : Promise.reject(error('ACCESS_STORAGE_UNAVAILABLE', MESSAGES.ACCESS_STORAGE_UNAVAILABLE)));
    },
    async getByAccessId(id) { accessId(id); return accessCall('getByAccessId', 0, id); },
    async grant(id, days, now) {
      accessId(id); time(now);
      if (!Number.isInteger(days) || days < 1 || days > 365) throw error('INVALID_GRANT', 'Choose a whole number of days between 1 and 365.');
      return accessCall('grant', now, id, '', [days]);
    },
    async revoke(id) { accessId(id); return accessCall('revoke', 0, id); },
    async settings() { return accessCall('settings'); },
    async setDemoEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw error('INVALID_SETTINGS', 'Demo availability must be true or false.');
      return accessCall('setDemoEnabled', 0, '', '', [enabled ? '1' : '0']);
    },
    async setDemo(id, enabled, expiresAt) {
      accessId(id);
      if (typeof enabled !== 'boolean') throw error('INVALID_SETTINGS', 'Demo access must be true or false.');
      if (enabled) time(expiresAt);
      return accessCall('setDemo', 0, id, '', [enabled ? '1' : '0', enabled ? expiresAt : 0]);
    },
  };
  const usageStore = {
    async usageMany(entries, now) {
      if (!Array.isArray(entries) || entries.length > 10_000) throw new TypeError('A bounded visitor list is required.');
      for (const entry of entries) { digest(entry?.identityHash); integer(entry.limit, 'limit'); }
      const day = dayAt(now);
      let counts = await usageCall('usageMany', '', 1, '', 0, '', day, 0, '', JSON.stringify(entries));
      if (!Array.isArray(counts) && counts && Object.keys(counts).length === 0) counts = [];
      if (!Array.isArray(counts) || counts.length !== entries.length || counts.some(used => !Number.isSafeInteger(used) || used < 0 || used > 100_000)) throw error('USAGE_STORAGE_UNAVAILABLE', MESSAGES.USAGE_STORAGE_UNAVAILABLE);
      return counts.map((used, index) => ({ used, limit: entries[index].limit, remaining: Math.max(0, entries[index].limit - used), resetsAt: Date.parse(`${day}T00:00:00.000Z`) + DAY }));
    },
    async usage(hash, limit, now) {
      digest(hash); integer(limit, 'limit');
      const day = dayAt(now);
      const { used } = await usageCall('usage', hash, limit, '', 0, '', day, 0);
      if (!Number.isSafeInteger(used) || used < 0 || used > 100_000) throw error('USAGE_STORAGE_UNAVAILABLE', MESSAGES.USAGE_STORAGE_UNAVAILABLE);
      return { used, limit, remaining: Math.max(0, limit - used), resetsAt: Date.parse(`${day}T00:00:00.000Z`) + DAY };
    },
    async reserve({ identityHash: hash, ipHash, limit, now, attemptSlots } = {}) {
      digest(hash); digest(ipHash); integer(limit, 'limit');
      if (![1, 2].includes(attemptSlots)) throw new TypeError('attemptSlots must be 1 or 2.');
      const day = dayAt(now);
      const id = randomBytes(16).toString('hex');
      const ttl = Math.ceil((Date.parse(`${day}T00:00:00.000Z`) + 2 * DAY - now) / 1000);
      if (await usageCall('reserve', hash, limit, ipHash, attemptSlots, id, day, ttl) !== true) throw error('USAGE_STORAGE_UNAVAILABLE', MESSAGES.USAGE_STORAGE_UNAVAILABLE);
      return Object.freeze({ id, day, identityHash: hash });
    },
    async finish(reservation, { success } = {}) {
      if (!reservation || !RESERVATION_ID.test(reservation.id ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(reservation.day ?? '') || !HASH.test(reservation.identityHash ?? '') || typeof success !== 'boolean') throw new TypeError('A valid reservation and success flag are required.');
      const value = await usageCall('finish', reservation.identityHash, 1, '', 0, reservation.id, reservation.day, 0, success ? '1' : '0');
      if (typeof value !== 'boolean') throw error('USAGE_STORAGE_UNAVAILABLE', MESSAGES.USAGE_STORAGE_UNAVAILABLE);
      return value;
    },
  };
  const limiterStore = {
    async hit({ scope, ipHash, limit, windowMs, now } = {}) {
      if (typeof scope !== 'string' || !/^[a-z][a-z0-9:-]{0,63}$/.test(scope)) throw new TypeError('Invalid request protection scope.');
      digest(ipHash); integer(limit, 'limit'); integer(windowMs, 'windowMs', DAY); time(now);
      const value = await evaluate(LIMITER_SCRIPT, [`${base}:limits:${scope}:${ipHash}`], [now, windowMs, limit, randomBytes(16).toString('hex')], 'SECURITY_STORAGE_UNAVAILABLE');
      if (!value || typeof value.allowed !== 'boolean' || !Number.isSafeInteger(value.retryAfter) || value.retryAfter < 0) throw error('SECURITY_STORAGE_UNAVAILABLE', MESSAGES.SECURITY_STORAGE_UNAVAILABLE);
      return value;
    },
  };
  return { accessStore, usageStore, limiterStore };
}
