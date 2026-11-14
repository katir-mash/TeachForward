import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createAccessStore } from './access-store.js';
import { createUsageStore } from './usage-store.js';
import { loadServerConfig } from './config.js';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// The browser never loads this file or this .env. Keep the key on the server.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'), quiet: true });

try {
  const config = loadServerConfig();
  if (process.env.ADMIN_PASSWORD_HASH && !process.env.SESSION_SECRET?.trim()) throw Object.assign(new Error('Set a stable SESSION_SECRET before enabling administrator access.'), { code: 'CONFIG_ERROR' });
  // Checks writability only. Actual durability requires the hosting disk mount.
  mkdirSync(config.dataDirectory, { recursive: true });
  const probe = path.join(config.dataDirectory, `.write-check-${randomBytes(8).toString('hex')}.tmp`);
  writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
  unlinkSync(probe);
  const accessStore = createAccessStore({ filePath: config.accessFile, ...config.accessOptions });
  const usageStore = createUsageStore({ filePath: config.usageFile, ...config.usageOptions });
  accessStore.cleanup(Date.now());
  const app = createApp({ production: config.production, appOrigin: config.appOrigin, accessStore, usageStore });
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`TeachForward server listening on port ${config.port}.`);
    console.log(`AI Mentor: ${process.env.OPENAI_API_KEY?.trim() ? 'key present; no provider request is made at startup' : 'not configured; roadmap remains available'}`);
  });
  server.on('error', () => { console.error('TeachForward could not bind its configured port.'); process.exitCode = 1; });
  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;
  const cleanupTimer = setInterval(() => {
    try { accessStore.cleanup(Date.now()); }
    catch { console.error('Access cleanup was deferred because persistent storage is unavailable.'); }
  }, 60 * 60 * 1000);
  cleanupTimer.unref();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { clearInterval(cleanupTimer); server.close(() => process.exit(0)); });
  }
} catch (error) {
  console.error(error?.code === 'CONFIG_ERROR' ? error.message : 'TeachForward could not start. Check server configuration and persistent storage; existing data has been preserved.');
  process.exitCode = 1;
}
