import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createAccessStore } from './access-store.js';

// The browser never loads this file or this .env. Keep the key on the server.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'), quiet: true });

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
if (process.env.ADMIN_PASSWORD_HASH && !process.env.SESSION_SECRET?.trim()) throw new Error('Set a stable SESSION_SECRET before enabling administrator access.');
const accessStore = createAccessStore({ filePath: process.env.ACCESS_DATA_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'access.json') });
const app = createApp({ production: process.argv.includes('--production') || process.env.NODE_ENV === 'production', accessStore });
const server = app.listen(port, () => {
  console.log(`TeachForward server ready on http://localhost:${port}`);
  console.log(`AI Mentor: ${process.env.OPENAI_API_KEY?.trim() ? 'key present; live connection is not checked at startup' : 'not configured; roadmap remains available'}`);
});
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
