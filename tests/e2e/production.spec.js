import { test, expect } from '@playwright/test';

test('production browser requests its API on the current site origin', async ({ page, baseURL }) => {
  const apiRequests = [];
  page.on('request', request => {
    if (['fetch', 'xhr'].includes(request.resourceType())) apiRequests.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore a sample' }).click();
  await page.getByRole('button', { name: 'Explore Plus', exact: true }).click();
  await page.getByRole('button', { name: 'Demo upgrade', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your weekly practice plan', exact: true })).toBeVisible();
  expect(apiRequests.some(url => new URL(url).pathname === '/api/session')).toBeTruthy();
  expect(apiRequests.some(url => new URL(url).pathname === '/api/plus')).toBeTruthy();
  expect(apiRequests.every(url => new URL(url).origin === new URL(baseURL).origin)).toBeTruthy();
});
