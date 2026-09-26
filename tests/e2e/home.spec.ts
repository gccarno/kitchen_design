import { test, expect } from '@playwright/test';

test('home page lists projects and creates one', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Kitchen Design' })).toBeVisible();

  const name = `Home test ${Date.now()}`;
  await page.getByLabel('New project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/project\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name })).toBeVisible();

  await page.getByRole('link', { name: 'All projects' }).click();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
});

test('unknown and malformed project ids are 404s', async ({ page }) => {
  expect((await page.goto('/project/00000000-0000-4000-8000-000000000000'))?.status()).toBe(404);
  expect((await page.goto('/project/..%2F..%2Fetc'))?.status()).toBe(404);
});
