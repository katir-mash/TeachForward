import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const ADMIN_PASSWORD = 'playwright-admin-only-password-2026';
const DAY = 86_400_000;

async function signIn(page, { wrongFirst = false } = {}) {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  if (wrongFirst) {
    await page.getByLabel('Administrator password', { exact: true }).fill('incorrect-test-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/password.*not accepted/i);
  }
  await page.getByLabel('Administrator password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Help the next chapter happen.', exact: true })).toBeVisible();
}

async function openSample(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore a sample', exact: true }).click();
  await expect(page.getByRole('checkbox').first()).toBeVisible();
  await expect(page.locator('.access-identity code').first()).toContainText(/^TF-[A-F0-9]{12}$/);
}

async function publicSession(context) {
  return (await context.request.get('/api/session')).json();
}

test('administrator sign-in is protected, rejects a wrong password, and signs out', async ({ page, context }) => {
  expect((await context.request.get('/api/admin/overview')).status()).toBe(401);
  await signIn(page, { wrongFirst: true });
  expect((await context.request.get('/api/admin/overview')).status()).toBe(200);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  expect((await context.request.get('/api/admin/overview')).status()).toBe(401);
});

test('manual Plus management controls real visitor access, demo availability, and mobile layout', async ({ browser, baseURL }) => {
  test.setTimeout(60_000);
  const adminContext = await browser.newContext({ baseURL });
  const visitorContext = await browser.newContext({ baseURL });
  const freeContext = await browser.newContext({ baseURL });
  const admin = await adminContext.newPage();
  const visitor = await visitorContext.newPage();
  const freeVisitor = await freeContext.newPage();
  let adminSignedIn = false;
  try {
    await openSample(visitor);
    await visitor.getByRole('checkbox').first().check();
    const initial = await publicSession(visitorContext);
    const accessId = initial.accessId;
    await visitor.getByRole('button', { name: 'Skills studio', exact: true }).click();
    await expect(visitor.getByRole('heading', { name: 'Turn your goals into a weekly rhythm.', exact: true })).toBeVisible();
    expect((await visitorContext.request.post('/api/plus', { data: { profile: { education: 'bachelors', certification: 'none', subject: 'mathematics', time: '3-5' } } })).status()).toBe(403);

    await signIn(admin);
    adminSignedIn = true;
    await admin.getByLabel('Visitor Access ID', { exact: true }).fill(accessId);
    await admin.locator('.admin-quick-grant').getByRole('button', { name: 'Grant Plus', exact: true }).click();
    await admin.getByLabel('Access duration', { exact: true }).fill('30');
    await admin.getByRole('button', { name: 'Confirm Plus grant', exact: true }).click();
    const row = admin.getByRole('row').filter({ hasText: accessId });
    await expect(row).toContainText('Manual Plus');
    const granted = await publicSession(visitorContext);
    expect(granted.plan).toBe('plus');
    expect(granted.entitlement.source).toBe('admin');
    expect(granted.usage.limit).toBe(20);
    await visitor.reload();
    await expect(visitor.getByRole('checkbox').first()).toBeChecked();
    await visitor.getByRole('button', { name: 'Skills studio', exact: true }).click();
    await expect(visitor.getByRole('heading', { name: 'Your weekly practice plan', exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Extend', exact: true }).click();
    await admin.getByRole('button', { name: 'Extend Plus access', exact: true }).click();
    await expect.poll(async () => (await publicSession(visitorContext)).entitlement.expiresAt - granted.entitlement.expiresAt).toBe(30 * DAY);
    const extended = await publicSession(visitorContext);
    expect(extended.entitlement.expiresAt - granted.entitlement.expiresAt).toBe(30 * DAY);

    const demoSwitch = admin.getByRole('switch', { name: 'Allow public Demo upgrade', exact: true });
    await demoSwitch.click();
    await admin.getByRole('button', { name: 'Disable demo', exact: true }).click();
    await expect(demoSwitch).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await publicSession(visitorContext)).demoAvailable).toBe(false);
    expect((await publicSession(visitorContext)).entitlement.source).toBe('admin');
    await visitor.reload();
    await visitor.getByRole('button', { name: 'Skills studio', exact: true }).click();
    await expect(visitor.getByRole('heading', { name: 'Your weekly practice plan', exact: true })).toBeVisible();

    await openSample(freeVisitor);
    expect((await freeContext.request.post('/api/demo-upgrade', { data: {} })).status()).toBe(403);
    await freeVisitor.getByRole('button', { name: 'Explore Plus', exact: true }).click();
    await expect(freeVisitor.getByRole('dialog')).toContainText('Plus access is managed by your administrator.');
    await expect(freeVisitor.getByRole('button', { name: 'Demo upgrade', exact: true })).toHaveCount(0);
    await freeVisitor.getByRole('button', { name: 'Continue with Free', exact: true }).click();

    const directory = path.resolve('tests/artifacts');
    await mkdir(directory, { recursive: true });
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.screenshot({ path: path.join(directory, 'admin-desktop.png'), fullPage: true });
    await admin.setViewportSize({ width: 390, height: 844 });
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await admin.screenshot({ path: path.join(directory, 'admin-mobile.png'), fullPage: true });

    await row.getByRole('button', { name: 'Revoke', exact: true }).click();
    await admin.getByRole('button', { name: 'Revoke Plus access', exact: true }).click();
    await expect.poll(async () => (await publicSession(visitorContext)).plan).toBe('basic');
    await visitor.reload();
    await expect(visitor.getByRole('checkbox').first()).toBeChecked();
    await visitor.getByRole('button', { name: 'Skills studio', exact: true }).click();
    await expect(visitor.getByRole('heading', { name: 'Turn your goals into a weekly rhythm.', exact: true })).toBeVisible();
    await demoSwitch.click();
    await admin.getByRole('button', { name: 'Enable demo', exact: true }).click();
    await expect.poll(async () => (await publicSession(freeContext)).demoAvailable).toBe(true);
    expect((await freeContext.request.post('/api/demo-upgrade', { data: {} })).status()).toBe(200);
  } finally {
    if (adminSignedIn) await adminContext.request.post('/api/admin/settings', { data: { demoUpgradeEnabled: true } });
    await Promise.all([adminContext.close(), visitorContext.close(), freeContext.close()]);
  }
});
