import { Redis } from '@upstash/redis';

// A timed-out mutation may already have committed. Never automatically replay it.
// Each command receives a fresh deadline; a process-wide signal would stay aborted.
export function createRedisClient({ url, token }, { timeoutMs = 3000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new TypeError('Invalid Redis request deadline.');
  return new Redis({
    url, token,
    retry: { retries: 0 },
    signal: () => AbortSignal.timeout(timeoutMs),
    enableTelemetry: false,
    enableAutoPipelining: false,
    readYourWrites: true,
    cache: 'no-store',
  });
}
