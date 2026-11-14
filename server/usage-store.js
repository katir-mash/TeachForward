import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceFileAtomically } from './atomic-file.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;
const HASH = /^[a-f0-9]{64}$/;
const RESERVATION_ID = /^[a-f0-9]{32}$/;
const MAX_SLOTS = 100_000;
const clone = value => structuredClone(value);
const codedError = (code, message) => Object.assign(new Error(message), { code });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_SLOTS;

function checkedLimit(value, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SLOTS) throw new TypeError(`${name} must be a whole number from 1 to ${MAX_SLOTS}.`);
}

function dayAt(now) {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('A valid server timestamp is required.');
  return new Date(now).toISOString().slice(0, 10);
}

function checkedIdentity(identityHash) {
  if (typeof identityHash !== 'string' || !HASH.test(identityHash)) throw new TypeError('A SHA-256 browser identity digest is required.');
}

function validState(value) {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'days,version' || value.version !== 1 || !isObject(value.days) || Object.keys(value.days).length > 2) return false;
  for (const [date, day] of Object.entries(value.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) return false;
    if (!isObject(day) || Object.keys(day).sort().join(',') !== 'attemptSlots,ips,pending,visitors' || !isCount(day.attemptSlots) || !isObject(day.visitors) || !isObject(day.ips) || !isObject(day.pending)) return false;
    const visitors = Object.entries(day.visitors);
    const ips = Object.entries(day.ips);
    const pending = Object.entries(day.pending);
    if (visitors.length > day.attemptSlots || ips.length > day.attemptSlots || pending.length > day.attemptSlots) return false;
    if (visitors.some(([hash, used]) => !HASH.test(hash) || !isCount(used))) return false;
    if (ips.some(([hash, used]) => !HASH.test(hash) || !isCount(used) || used === 0)) return false;
    if (visitors.reduce((sum, [, used]) => sum + used, 0) > day.attemptSlots) return false;
    if (ips.reduce((sum, [, used]) => sum + used, 0) !== day.attemptSlots) return false;
    const pendingCounts = new Map();
    for (const [id, identityHash] of pending) {
      if (!RESERVATION_ID.test(id) || typeof identityHash !== 'string' || !HASH.test(identityHash) || !Object.hasOwn(day.visitors, identityHash)) return false;
      pendingCounts.set(identityHash, (pendingCounts.get(identityHash) ?? 0) + 1);
    }
    if ([...pendingCounts].some(([hash, count]) => day.visitors[hash] < count)) return false;
  }
  return true;
}

/**
 * Single-process daily quota reservations. Persist before contacting the provider.
 * A reservation consumes one visitor slot and all possible provider-attempt slots.
 * Only a failed request's visitor slot can be refunded; IP/global attempts never are.
 */
export function createUsageStore({ filePath, dayLimit = 100, ipDayLimit = 30 } = {}) {
  checkedLimit(dayLimit, 'dayLimit'); checkedLimit(ipDayLimit, 'ipDayLimit');
  const target = filePath ? path.resolve(filePath) : null;
  if (target && !target.startsWith(`${ROOT}${path.sep}`)) throw new Error('Usage storage must stay inside the project.');
  let state = { version: 1, days: {} };
  if (target && existsSync(target)) {
    try {
      const loaded = JSON.parse(readFileSync(target, 'utf8'));
      if (!validState(loaded)) throw new Error();
      state = { version: 1, days: clone(loaded.days) };
    } catch {
      throw codedError('USAGE_STORAGE_UNAVAILABLE', 'Usage storage could not be read. Preserve it and restore a valid backup before restarting.');
    }
  }

  function commit(next) {
    if (target) {
      const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(temp, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
        const descriptor = openSync(temp, 'r+');
        try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
        replaceFileAtomically(temp, target);
      } catch {
        try { if (existsSync(temp)) unlinkSync(temp); } catch { /* Never replace the original on failure. */ }
        throw codedError('USAGE_STORAGE_UNAVAILABLE', 'Usage storage is unavailable. No provider request may be started.');
      }
    }
    state = next;
  }

  return {
    usage(identityHash, limit, now) {
      checkedIdentity(identityHash); checkedLimit(limit, 'limit');
      const day = dayAt(now);
      const used = state.days[day]?.visitors[identityHash] ?? 0;
      return { used, limit, remaining: Math.max(0, limit - used), resetsAt: Date.parse(`${day}T00:00:00.000Z`) + DAY };
    },

    reserve({ identityHash, ipHash, limit, now, attemptSlots } = {}) {
      checkedIdentity(identityHash); checkedLimit(limit, 'limit');
      if (typeof ipHash !== 'string' || !HASH.test(ipHash)) throw new TypeError('A SHA-256 IP digest is required.');
      if (![1, 2].includes(attemptSlots)) throw new TypeError('attemptSlots must be 1 or 2.');
      const date = dayAt(now);
      const current = state.days[date] ?? { attemptSlots: 0, visitors: {}, ips: {}, pending: {} };
      if ((current.visitors[identityHash] ?? 0) >= limit) throw codedError('VISITOR_DAILY_LIMIT', 'This browser has used its daily mentor allowance.');
      if ((current.ips[ipHash] ?? 0) + attemptSlots > ipDayLimit) throw codedError('IP_DAILY_LIMIT', 'The daily mentor request limit for this network has been reached.');
      if (current.attemptSlots + attemptSlots > dayLimit) throw codedError('GLOBAL_DAILY_LIMIT', 'The service has reached its daily mentor request limit.');
      const previous = dayAt(Math.max(0, Date.parse(`${date}T00:00:00.000Z`) - DAY));
      const next = { version: 1, days: {} };
      if (state.days[previous] && previous !== date) next.days[previous] = clone(state.days[previous]);
      const day = clone(current); next.days[date] = day;
      let id;
      do { id = randomBytes(16).toString('hex'); } while (Object.hasOwn(day.pending, id));
      day.attemptSlots += attemptSlots;
      day.visitors[identityHash] = (day.visitors[identityHash] ?? 0) + 1;
      day.ips[ipHash] = (day.ips[ipHash] ?? 0) + attemptSlots;
      day.pending[id] = identityHash;
      commit(next);
      return Object.freeze({ id, day: date, identityHash });
    },

    finish(reservation, { success } = {}) {
      if (!isObject(reservation) || !RESERVATION_ID.test(reservation.id ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(reservation.day ?? '') || !HASH.test(reservation.identityHash ?? '') || typeof success !== 'boolean') throw new TypeError('A valid reservation and success flag are required.');
      const recordedIdentity = state.days[reservation.day]?.pending[reservation.id];
      if (!recordedIdentity) return false;
      if (recordedIdentity !== reservation.identityHash) throw new TypeError('The reservation does not match its browser identity.');
      const next = clone(state);
      const day = next.days[reservation.day];
      delete day.pending[reservation.id];
      if (!success) day.visitors[reservation.identityHash] = Math.max(0, day.visitors[reservation.identityHash] - 1);
      commit(next);
      return true;
    },
  };
}
