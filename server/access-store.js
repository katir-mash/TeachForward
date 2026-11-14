import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;
const copy = value => structuredClone(value);
const codedError = (code, message) => Object.assign(new Error(message), { code });

/** Single-process durable entitlements. No profiles, chat, cookie values or keys. */
export function createAccessStore({ filePath } = {}) {
  const target = filePath ? path.resolve(filePath) : null;
  if (target && !target.startsWith(`${ROOT}${path.sep}`)) throw new Error('Access storage must stay inside the project.');
  let state = { version: 1, settings: { demoUpgradeEnabled: true }, visitors: [] };
  if (target && existsSync(target)) {
    try {
      const loaded = JSON.parse(readFileSync(target, 'utf8'));
      const ids = new Set();
      const hashes = new Set();
      if (loaded.version !== 1 || typeof loaded.settings?.demoUpgradeEnabled !== 'boolean' || !Array.isArray(loaded.visitors) || loaded.visitors.length > 10_000) throw new Error();
      for (const visitor of loaded.visitors) {
        if (!/^TF-[A-F0-9]{12}$/.test(visitor.accessId) || !/^[a-f0-9]{64}$/.test(visitor.identityHash) || !Number.isFinite(visitor.createdAt) || !Number.isFinite(visitor.lastSeenAt) || !(visitor.manualExpiresAt === null || Number.isFinite(visitor.manualExpiresAt)) || ids.has(visitor.accessId) || hashes.has(visitor.identityHash)) throw new Error();
        ids.add(visitor.accessId); hashes.add(visitor.identityHash);
      }
      state = { version: 1, settings: { demoUpgradeEnabled: loaded.settings.demoUpgradeEnabled }, visitors: loaded.visitors.map(({ accessId, identityHash, createdAt, lastSeenAt, manualExpiresAt }) => ({ accessId, identityHash, createdAt, lastSeenAt, manualExpiresAt })) };
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
        renameSync(temp, target);
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
  return {
    identity(privateId, now) {
      if (typeof privateId !== 'string' || !/^[a-f0-9]{48}$/.test(privateId) || !Number.isFinite(now)) throw new TypeError('A valid browser identity and time are required.');
      const identityHash = createHash('sha256').update(privateId).digest('hex');
      const known = state.visitors.find(visitor => visitor.identityHash === identityHash);
      if (known) {
        if (now - known.lastSeenAt >= 60_000) return changeVisitor(known.accessId, visitor => { visitor.lastSeenAt = now; });
        return copy(known);
      }
      if (state.visitors.length >= 10_000) throw codedError('ACCESS_STORAGE_FULL', 'The visitor limit has been reached. Contact the project owner.');
      let accessId;
      do { accessId = `TF-${randomBytes(6).toString('hex').toUpperCase()}`; } while (state.visitors.some(visitor => visitor.accessId === accessId));
      const visitor = { accessId, identityHash, createdAt: now, lastSeenAt: now, manualExpiresAt: null };
      const next = copy(state); next.visitors.push(visitor); commit(next); return copy(visitor);
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
