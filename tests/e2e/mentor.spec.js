import { test, expect } from '@playwright/test';
import { buildRoadmap, SAMPLE_PROFILE } from '../../shared/roadmap.js';

// Browser fixtures exist only in this test file. Production has no fake AI fallback.
const sample = buildRoadmap(SAMPLE_PROFILE);
const source = sample.sources[0];
const session = {
  plan: 'basic', demo: true, aiConfigured: true, model: 'gpt-6-luna',
  usage: { used: 0, limit: 3, remaining: 3, resetsAt: 1_800_000_000_000 },
  sessionExpiresAt: 1_800_000_000_000,
};

async function prepareMentor(page, handler) {
  // Every Mentor call is intercepted before it can reach the server or provider.
  await page.route('**/api/session', route => route.fulfill({ json: session }));
  await page.route('**/api/mentor', handler);
  await page.route('https://api.openai.com/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore a sample' }).click();
  await expect(page.getByRole('heading', { name: sample.title, exact: true })).toBeVisible();
  await expect(page.getByText('AI is not connected yet.', { exact: true })).toHaveCount(0);
}

const answerResponse = (answer, used = 1) => ({
  answer, sources: [source], remaining: 3 - used,
  usage: { ...session.usage, used, remaining: 3 - used },
});

test('Mentor sends actual profile/progress, shows loading and safely renders a successful follow-up', async ({ page }) => {
  const requests = [];
  let releaseFirst;
  let markFirstSeen;
  const firstSeen = new Promise(resolve => { markFirstSeen = resolve; });
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const firstAnswer = 'Use <strong>verified guidance</strong> & keep going.';
  await prepareMentor(page, async route => {
    requests.push(route.request().postDataJSON());
    const index = requests.length;
    if (index === 1) { markFirstSeen(); await firstGate; }
    await route.fulfill({ json: answerResponse(index === 1 ? firstAnswer : 'Review the next unchecked step with your preparation program.', index) });
  });
  await page.getByRole('checkbox').first().check();
  const question = 'What does my degree mean for the step I just finished?';
  await page.getByLabel('Ask your mentor').fill(question);
  await page.getByRole('button', { name: 'Ask mentor', exact: true }).click();
  try {
    await firstSeen;
    await expect(page.locator('.mentor-loading')).toBeVisible();
    await expect(page.getByLabel('Ask your mentor')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Ask mentor', exact: true })).toBeDisabled();
    await expect(page.locator('.ai-message')).toHaveCount(0);
    expect(requests[0]).toMatchObject({ message: question, profile: SAMPLE_PROFILE, completedTaskIds: [sample.tasks[0].id] });
    expect(requests[0].conversationId).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(requests[0]).not.toHaveProperty('history');
  } finally { releaseFirst(); }
  await expect(page.locator('.ai-message')).toHaveText(firstAnswer);
  await expect(page.locator('.ai-message strong')).toHaveCount(0);
  await expect(page.locator('.mentor-exchange').getByRole('link', { name: source.title, exact: true })).toHaveAttribute('href', source.url);
  await expect(page.getByLabel('Ask your mentor')).toHaveValue('');
  await expect(page.locator('.mentor-footer')).toContainText('2 of 3');

  const followUp = 'Can you explain that next action in simpler terms?';
  await page.getByLabel('Ask your mentor').fill(followUp);
  await page.getByRole('button', { name: 'Ask mentor', exact: true }).click();
  await expect(page.locator('.ai-message')).toHaveCount(2);
  expect(requests[1].message).toBe(followUp);
  expect(requests[1].conversationId).toBe(requests[0].conversationId);
  expect(requests[1].completedTaskIds).toEqual([sample.tasks[0].id]);
  await expect(page.locator('.mentor-footer')).toContainText('1 of 3');
});

test('failed Mentor requests preserve input for retry and never display fabricated answers', async ({ page }) => {
  const requests = [];
  const errorMessage = 'AI Mentor is temporarily unavailable. Please try again.';
  await prepareMentor(page, async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      await route.fulfill({ status: 502, json: { code: 'AI_UNAVAILABLE', error: errorMessage } });
    } else {
      await route.fulfill({ json: answerResponse('Confirm the next requirement with your approved program.') });
    }
  });
  const question = 'How can I practice teaching mathematics this week?';
  await page.getByLabel('Ask your mentor').fill(question);
  await page.getByRole('button', { name: 'Ask mentor', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(errorMessage);
  await expect(page.locator('.ai-message')).toHaveCount(0);
  await expect(page.getByLabel('Ask your mentor')).toHaveValue(question);
  await expect(page.getByRole('button', { name: 'Ask mentor', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Ask mentor', exact: true }).click();
  await expect(page.locator('.ai-message')).toHaveText('Confirm the next requirement with your approved program.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test('editing the profile starts a fresh Mentor conversation with the new route context', async ({ page }) => {
  const requests = [];
  await prepareMentor(page, async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: answerResponse('Review the route that matches your current profile.') });
  });
  await page.getByRole('checkbox').first().check();
  await page.getByLabel('Ask your mentor').fill('Where should I begin?');
  await page.getByRole('button', { name: 'Ask mentor', exact: true }).click();
  await expect(page.locator('.ai-message')).toHaveCount(1);
  const oldConversation = requests[0].conversationId;

  await page.getByRole('button', { name: 'Edit my profile' }).click();
  await page.getByLabel('What is your highest level of education?').selectOption('high-school');
  await page.getByLabel('What would you like to teach?').selectOption('science');
  await page.getByRole('button', { name: 'Build my roadmap' }).click();
  await expect(page.getByRole('heading', { name: 'Lay the foundation for your teaching career' })).toBeVisible();
  await expect(page.locator('.ai-message')).toHaveCount(0);
  await page.getByLabel('Ask your mentor').fill('What is different about my new route?');
  await page.getByRole('button', { name: 'Ask mentor', exact: true }).click();
  await expect(page.locator('.ai-message')).toHaveCount(1);
  expect(requests).toHaveLength(2);
  expect(requests[1].conversationId).not.toBe(oldConversation);
  expect(requests[1].profile).toEqual({ ...SAMPLE_PROFILE, education: 'high-school', subject: 'science' });
  expect(requests[1].completedTaskIds).toEqual([]);
});
