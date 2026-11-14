import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceFileAtomically } from './atomic-file.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const HARD_CAP = 10_000;
const copy = value => structuredClone(value);
const codedError = (code, message) => Object.assign(new Error(message), { code });

function boundedInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new TypeError(`${name} must be a positive integer no greater than ${maximum}.`);
  return value;
}

function privateIdentityHash(privateId) {
  if (typeof privateId !== 'string' || !/^[a-f0-9]{48}$/.test(privateId)) throw new TypeError('A valid browser identity is required.');
  return createHash('sha256').update(privateId).digest('hex');
}

function checkTime(now) {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('A valid time is required.');
}

/** Single-process durable entitlements. No profiles, chat, cookie values or keys. */
export function createAccessStore({
  filePath,
  maxVisitors = HARD_CAP,
  inactiveTtlMs = 30 * DAY,
  ipBurstLimit = 5,
  ipBurstWindowMs = 10 * 60 * 1000,
  ipDailyLimit = 40,
  globalHourlyLimit = 100,
  globalDailyLimit = 1000,
} = {}) {
  boundedInteger(maxVisitors, 'maxVisitors', HARD_CAP);
  boundedInteger(inactiveTtlMs, 'inactiveTtlMs');
  boundedInteger(ipBurstLimit, 'ipBurstLimit', HARD_CAP);
  boundedInteger(ipBurstWindowMs, 'ipBurstWindowMs', DAY);
  boundedInteger(ipDailyLimit, 'ipDailyLimit', HARD_CAP);
  boundedInteger(globalHourlyLimit, 'globalHourlyLimit', HARD_CAP);
  boundedInteger(globalDailyLimit, 'globalDailyLimit', HARD_CAP);
  const target = filePath ? path.resolve(filePath) : null;
  if (target && !target.startsWith(`${ROOT}${path.sep}`)) throw new Error('Access storage must stay inside the project.');
  let state = { version: 2, settings: { demoUpgradeEnabled: true }, visitors: [], admission: { creations: [] } };
  if (target && existsSync(target)) {
    try {
      const loaded = JSON.parse(readFileSync(target, 'utf8'));
      const ids = new Set();
      const hashes = new Set();
      if (![1, 2].includes(loaded.version) || typeof loaded.settings?.demoUpgradeEnabled !== 'boolean' || !Array.isArray(loaded.visitors) || loaded.visitors.length > HARD_CAP) throw new Error();
      for (const visitor of loaded.visitors) {
        if (!/^TF-[A-F0-9]{12}$/.test(visitor.accessId) || !/^[a-f0-9]{64}$/.test(visitor.identityHash) || !Number.isFinite(visitor.createdAt) || visitor.createdAt < 0 || !Number.isFinite(visitor.lastSeenAt) || visitor.lastSeenAt < 0 || !(visitor.manualExpiresAt === null || (Number.isFinite(visitor.manualExpiresAt) && visitor.manualExpiresAt >= 0)) || ids.has(visitor.accessId) || hashes.has(visitor.identityHash)) throw new Error();
        ids.add(visitor.accessId); hashes.add(visitor.identityHash);
      }
      const creations = loaded.version === 1 ? [] : loaded.admission?.creations;
      if (!Array.isArray(creations) || creations.length > HARD_CAP || creations.some(event => !event || !Number.isFinite(event.at) || event.at < 0 || !(event.ipHash === null || (typeof event.ipHash === 'string' && /^[a-f0-9]{64}$/.test(event.ipHash))))) throw new Error();
      state = {
        version: 2,
        settings: { demoUpgradeEnabled: loaded.settings.demoUpgradeEnabled },
        visitors: loaded.visitors.map(({ accessId, identityHash, createdAt, lastSeenAt, manualExpiresAt }) => ({ accessId, identityHash, createdAt, lastSeenAt, manualExpiresAt })),
        admission: { creations: creations.map(({ at, ipHash }) => ({ at, ipHash })) },
      };
    } catch {
      throw new Error('Access storage could not be read. Preserve the file and restore a valid backup before restarting.');
    }
  }
  function commit(next) {
    if (target) {
      const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(temp, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 });
        const descriptor = openSync(temp, 'r+');
        try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
        replaceFileAtomically(temp, target);
      } catch {
        try { if (existsSync(temp)) unlinkSync(temp); } catch { /* Preserve the original file on failure. */ }
        throw codedError('ACCESS_STORAGE_UNAVAILABLE', 'Access storage is unavailable. No change was saved.');
      }
    }
    state = next;
  }
  function changeVisitor(accessId, update) {
    const next = copy(state);
    const visitor = next.visitors.find(item => item.accessId === accessId);
    if (!visitor) throw codedError('ACCESS_NOT_FOUND', 'No visitor has this Access ID.');
    update(visitor); commit(next); return copy(visitor);
  }

  const retained = (visitor, now) => visitor.manualExpiresAt > now || now - Math.max(visitor.lastSeenAt, visitor.manualExpiresAt ?? 0) < inactiveTtlMs;

  function prune(next, now) {
    const beforeVisitors = next.visitors.length;
    const beforeCreations = next.admission.creations.length;
    next.visitors = next.visitors.filter(visitor => retained(visitor, now));
    next.admission.creations = next.admission.creations.filter(event => event.at > now - DAY);
    return { removed: beforeVisitors - next.visitors.length, expiredAdmissions: beforeCreations - next.admission.creations.length };
  }

  function creationAdmission(next, ipHash, now) {
    const events = next.admission.creations;
    const waits = [];
    function enforce(selected, duration, limit) {
      const recent = selected.filter(event => event.at > now - duration).sort((left, right) => left.at - right.at);
      if (recent.length >= limit) waits.push(recent[recent.length - limit].at + duration - now);
    }
    enforce(events, HOUR, globalHourlyLimit);
    enforce(events, DAY, globalDailyLimit);
    if (ipHash !== null) {
      const ipEvents = events.filter(event => event.ipHash === ipHash);
      enforce(ipEvents, ipBurstWindowMs, ipBurstLimit);
      enforce(ipEvents, DAY, ipDailyLimit);
    }
    if (waits.length) {
      throw Object.assign(codedError('ACCESS_CREATION_RATE_LIMIT', 'Too many new browser identities were requested. Please wait before trying again.'), { retryAfter: Math.max(1, Math.ceil(Math.max(...waits) / 1000)) });
    }
    // Even a custom configuration cannot grow the persisted admission ledger
    // beyond the same hard bound used when loading it.
    if (events.length >= HARD_CAP) throw Object.assign(codedError('ACCESS_CREATION_RATE_LIMIT', 'New browser access is temporarily limited. Please try again later.'), { retryAfter: 300 });
    events.push({ at: now, ipHash });
  }

  return {
    getIdentity(privateId, now) {
      checkTime(now);
      const identityHash = privateIdentityHash(privateId);
      const known = state.visitors.find(visitor => visitor.identityHash === identityHash);
      return copy(known && retained(known, now) ? known : null);
    },
    cleanup(now) {
      checkTime(now);
      const next = copy(state);
      const result = prune(next, now);
      if (result.removed || result.expiredAdmissions) commit(next);
      return { removed: result.removed, remaining: next.visitors.length };
    },
    identity(privateId, now, { ipHash = null } = {}) {
      checkTime(now);
      const identityHash = privateIdentityHash(privateId);
      if (ipHash !== null && (typeof ipHash !== 'string' || !/^[a-f0-9]{64}$/.test(ipHash))) throw new TypeError('An anonymized network hash is required.');
      const next = copy(state);
      const pruned = prune(next, now);
      const known = next.visitors.find(visitor => visitor.identityHash === identityHash);
      if (known) {
        const touch = now - known.lastSeenAt >= 60_000;
        if (touch) known.lastSeenAt = now;
        if (touch || pruned.removed || pruned.expiredAdmissions) commit(next);
        return copy(known);
      }
      if (next.visitors.length >= maxVisitors) throw Object.assign(codedError('ACCESS_STORAGE_FULL', 'New browser access is temporarily unavailable. Existing active access is preserved. Please try again later.'), { retryAfter: 300 });
      creationAdmission(next, ipHash, now);
      let accessId;
      do { accessId = `TF-${randomBytes(6).toString('hex').toUpperCase()}`; } while (next.visitors.some(visitor => visitor.accessId === accessId));
      const visitor = { accessId, identityHash, createdAt: now, lastSeenAt: now, manualExpiresAt: null };
      next.visitors.push(visitor); commit(next); return copy(visitor);
    },
    list: () => copy(state.visitors),
    getByAccessId: accessId => copy(state.visitors.find(visitor => visitor.accessId === accessId) ?? null),
    grant(accessId, days, now) {
      if (!Number.isInteger(days) || days < 1 || days > 365 || !Number.isFinite(now)) throw codedError('INVALID_GRANT', 'Choose a whole number of days between 1 and 365.');
      return changeVisitor(accessId, visitor => {
        const expiresAt = Math.max(now, visitor.manualExpiresAt ?? 0) + days * DAY;
        if (expiresAt > now + 365 * DAY) throw codedError('INVALID_GRANT', 'Total remaining access cannot exceed 365 days. Choose fewer days.');
        visitor.manualExpiresAt = expiresAt;
      });
    },
    revoke: accessId => changeVisitor(accessId, visitor => { visitor.manualExpiresAt = null; }),
    settings: () => copy(state.settings),
    setDemoEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw codedError('INVALID_SETTINGS', 'Demo availability must be true or false.');
      const next = copy(state); next.settings.demoUpgradeEnabled = enabled; commit(next); return copy(next.settings);
    },
  };
}
