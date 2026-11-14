import { renameSync } from 'node:fs';

// Windows indexers can briefly hold an existing file after a read or flush.
// Retry only that transient replacement; all other storage errors fail closed.
export function replaceFileAtomically(source, target) {
  const pauses = [5, 15, 30];
  for (let attempt = 0; ; attempt++) {
    try { renameSync(source, target); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= pauses.length) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauses[attempt]);
    }
  }
}
