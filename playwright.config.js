import { defineConfig } from '@playwright/test';
import { hashAdminPassword } from './server/admin.js';

const testAdminHash = await hashAdminPassword('playwright-admin-only-password-2026');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3002',
    channel: 'msedge',
    viewport: { width: 1440, height: 1050 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm.cmd run build && node tests/e2e/start-server.mjs --production',
    url: 'http://127.0.0.1:3002/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: '3002', APP_ORIGIN: 'http://127.0.0.1:3002', OPENAI_API_KEY: '',
      ADMIN_PASSWORD_HASH: testAdminHash, SESSION_SECRET: 'teachforward-playwright-stable-secret',
    },
  },
});
