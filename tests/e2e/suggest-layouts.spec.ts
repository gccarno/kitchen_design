import { test, expect } from '@playwright/test';
import { projectJson } from './helpers';

test('suggest layouts makes options for an empty kitchen and opens their comparison', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Suggest me');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  const originalId = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'Suggest layouts' }).click();
  await page.waitForURL(/\/compare\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Compare options — Suggest me' })).toBeVisible();
  const columns = page.getByRole('list', { name: 'Options' }).locator(':scope > li');
  // The empty original, plus two or three suggestions.
  expect(await columns.count()).toBeGreaterThanOrEqual(3);
  await expect(columns.nth(1).getByRole('link', { name: 'Suggest me — Option B' })).toBeVisible();

  // The original is untouched; an option has a furnished kitchen.
  expect(projectJson(originalId).items).toEqual([]);
  await columns.nth(1).getByRole('link', { name: 'Suggest me — Option B' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  const option = projectJson(page.url().split('/').pop()!);
  expect(option.optionOf).toBe(originalId);
  const tags = option.items.map((it: { tag: string }) => it.tag);
  for (const t of ['sink', 'range', 'fridge']) expect(tags).toContain(t);
  await expect(page.getByText(/8 of 8 passed/)).toBeVisible();
});
