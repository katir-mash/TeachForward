import { mkdirSync, writeFileSync } from 'node:fs';

// Reset only the owned E2E fixture, never the owner's real access records.
const fixture = new URL('../artifacts/e2e-access.json', import.meta.url);
mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
writeFileSync(fixture, JSON.stringify({ version: 1, settings: { demoUpgradeEnabled: true }, visitors: [] }));
writeFileSync(new URL('../artifacts/e2e-usage.json', import.meta.url), JSON.stringify({ version: 1, days: {} }));
await import('../../server/index.js');
