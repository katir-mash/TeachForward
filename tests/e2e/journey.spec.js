import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildRoadmap, SAMPLE_PROFILE } from '../../shared/roadmap.js';

const sample = buildRoadmap(SAMPLE_PROFILE);

async function openSample(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore a sample' }).click();
  await expect(page.getByRole('heading', { name: sample.title, exact: true })).toBeVisible();
}

async function fillProfile(page, profile) {
  await page.getByLabel('What is your highest level of education?').selectOption(profile.education);
  await page.getByLabel('Do you already hold a teaching certificate?').selectOption(profile.certification);
  await page.getByLabel('What would you like to teach?').selectOption(profile.subject);
  await page.getByLabel('How much time can you set aside each week?').selectOption(profile.time);
  await page.getByRole('button', { name: 'Build my roadmap' }).click();
}

test('landing, validation, and multiple real profile routes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your experience.*Their future/ })).toBeVisible();
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Build my roadmap' }).click();
  await expect(page.getByText('Select your highest level of education.', { exact: true })).toBeVisible();
  await expect(page.locator('#education')).toBeFocused();
  await fillProfile(page, { education: 'high-school', certification: 'none', subject: 'science', time: '1-2' });
  await expect(page.getByRole('heading', { name: 'Lay the foundation for your teaching career' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Explore a degree with teacher preparation' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Turn a question into an investigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit my profile' }).click();
  await fillProfile(page, { education: 'masters', certification: 'out-of-state', subject: 'english', time: '6-plus' });
  await expect(page.getByRole('heading', { name: 'Explore your route from another U.S. state' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Verify your out-of-state credential' }).first()).toBeVisible();
  await expect(page.getByText(/standard, valid and active/)).toBeVisible();
});

test('sample profile uses same route, tasks persist and next step moves', async ({ page }) => {
  await openSample(page);
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  const firstCheckbox = page.getByRole('checkbox').first();
  const firstTask = sample.tasks[0];
  await expect(firstCheckbox).toHaveAccessibleName(`Mark ${firstTask.title} complete`);
  await firstCheckbox.check();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(Math.round(100 / sample.tasks.length)));
  await expect(page.locator('.next-step-panel h3')).toHaveText(sample.tasks[1].title);
  await page.reload();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await expect(page.locator('.next-step-panel h3')).toHaveText(sample.tasks[1].title);
  await page.getByLabel('Filter tasks').selectOption('done');
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await page.getByLabel('Filter tasks').selectOption('all');
  await page.locator('.task-card').first().locator('summary').click();
  await expect(page.locator('.task-card').first().getByRole('link', { name: 'TEA · Approved Preparation Program Information' })).toHaveAttribute('href', /tea\.texas\.gov/);
  await page.getByRole('button', { name: 'Official sources', exact: true }).click();
  await expect(page.getByText('Texas Education Agency · Checked 2026-11-14').first()).toBeVisible();
  await expect(page.locator('.source-entry')).toHaveCount(sample.sources.length);
});

test('server paywall, Demo upgrade and reset preserve free progress', async ({ page, context }) => {
  await openSample(page);
  const denied = await context.request.post('/api/plus', { data: { profile: SAMPLE_PROFILE } });
  expect(denied.status()).toBe(403);
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Skills studio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Turn your goals into a weekly rhythm.' })).toBeVisible();
  await page.getByRole('button', { name: 'Explore Plus · $9.99/month' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('This is a demo upgrade.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Demo upgrade', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your weekly practice plan', exact: true })).toBeVisible();
  await expect(page.locator('.weekly-item')).toHaveCount(sample.weeklyPlan.length);
  await expect(page.getByRole('heading', { name: sample.skillExercises[0].title, exact: true })).toBeVisible();
  const allowed = await context.request.post('/api/plus', { data: { profile: SAMPLE_PROFILE } });
  expect(allowed.ok()).toBeTruthy();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download progress summary' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('teachforward-progress.json');
  await page.reload();
  await page.getByRole('button', { name: 'Plus demo', exact: true }).click();
  await page.getByRole('button', { name: 'Return to Free for testing' }).click();
  await expect(page.getByText('Your Plus demo is active.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Plus dialog' }).click();
  await page.getByRole('button', { name: 'My roadmap', exact: true }).click();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await page.getByRole('button', { name: 'Skills studio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Turn your goals into a weekly rhythm.' })).toBeVisible();
});

test('AI Mentor honestly handles no configured key and user input', async ({ page }) => {
  await openSample(page);
  await expect(page.getByText('AI is not connected yet.', { exact: true })).toBeVisible();
  await page.getByLabel('Ask your mentor').fill('How does my mathematics interest affect my next step?');
  await page.getByRole('button', { name: 'Ask mentor', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/not configured|not connected|unavailable/i);
  await expect(page.locator('.ai-message')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: sample.title, exact: true })).toBeVisible();
  await expect(page.getByLabel('Ask your mentor')).toHaveAttribute('maxlength', '1200');
  await page.getByLabel('Ask your mentor').fill('x'.repeat(1300));
  await expect(page.getByLabel('Ask your mentor')).toHaveValue('x'.repeat(1200));
});

test('Plus practice adapts to different subject and preparation time', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started' }).click();
  const profile = { education: 'bachelors', certification: 'none', subject: 'elementary', time: '1-2' };
  const expected = buildRoadmap(profile);
  await fillProfile(page, profile);
  await page.getByRole('button', { name: 'Explore Plus', exact: true }).click();
  await page.getByRole('button', { name: 'Demo upgrade', exact: true }).click();
  await expect(page.locator('.weekly-item')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: expected.skillExercises[0].title, exact: true })).toBeVisible();
  await expect(page.getByText(expected.weeklyPlan[1].description, { exact: true })).toBeVisible();
});

test('keyboard modal and task anchors keep the roadmap open', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: 'Explore Plus', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Explore Plus', exact: true })).toBeFocused();
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: sample.title, exact: true })).toBeVisible();
  for (let index = 0; index < sample.tasks.findIndex(task => task.category === 'Skills'); index++) {
    await page.getByRole('checkbox').nth(index).check();
  }
  await page.locator('.next-step-panel').getByRole('button', { name: 'Practice this skill' }).click();
  await expect(page.getByRole('heading', { name: sample.title, exact: true })).toBeVisible();
  await expect(page.locator('.task-card.next details')).toHaveAttribute('open', '');
  for (let index = 0; index < sample.tasks.length; index++) {
    await page.getByRole('checkbox').nth(index).check();
  }
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.locator('.next-step-panel h3')).toHaveText('Look how far you’ve come.');
  await page.getByLabel('Filter tasks').selectOption('remaining');
  await expect(page.getByRole('heading', { name: 'All caught up.', exact: true })).toBeVisible();
});

test('blocked browser storage degrades honestly without breaking the roadmap', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
  });
  await openSample(page);
  await expect(page.locator('.global-warning')).toContainText(/could not save|cannot be saved/);
  await page.getByRole('checkbox').first().check();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await expect(page.locator('.next-step-panel h3')).toHaveText(sample.tasks[1].title);
  expect(errors).toEqual([]);
});

test('corrupt saved data shows recovery warning and allows a new roadmap', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('teachforward.progress.v1', '{invalid json');
  });
  await page.goto('/#roadmap');
  await expect(page.locator('.global-warning')).toContainText(/unavailable or unreadable|could not be restored/);
  await page.getByRole('button', { name: 'Explore a sample' }).click();
  await expect(page.getByRole('heading', { name: sample.title, exact: true })).toBeVisible();
  await page.getByRole('checkbox').first().check();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('teachforward.progress.v1')));
  expect(saved.profile).toEqual(SAMPLE_PROFILE);
  expect(saved.completed).toContain(sample.tasks[0].id);
});

test('expired demo cookie refreshes server entitlement and locks Plus again', async ({ page, context }) => {
  await openSample(page);
  await page.getByRole('button', { name: 'Explore Plus', exact: true }).click();
  await page.getByRole('button', { name: 'Demo upgrade', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your weekly practice plan', exact: true })).toBeVisible();
  await context.clearCookies();
  await page.getByRole('button', { name: 'My roadmap', exact: true }).click();
  await page.getByRole('button', { name: 'Skills studio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Turn your goals into a weekly rhythm.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore Plus', exact: true })).toBeVisible();
});

test('responsive mobile scenario and screenshot artifacts', async ({ page }) => {
  const artifactDirectory = path.resolve('tests/artifacts');
  await mkdir(artifactDirectory, { recursive: true });
  await page.goto('/');
  await page.screenshot({ path: path.join(artifactDirectory, 'landing-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Explore a sample' }).click();
  await expect(page.getByRole('heading', { name: sample.title, exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'roadmap-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'Official sources', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Clarity starts with the source.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: path.join(artifactDirectory, 'sources-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'TeachForward home' }).first().click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: path.join(artifactDirectory, 'landing-mobile.png'), fullPage: true });
});
