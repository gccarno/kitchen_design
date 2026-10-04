import { test, expect } from '@playwright/test';
import { createProject } from './helpers';

test('home page lists projects and creates one', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home Design' })).toBeVisible();

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

test('project cards show a plan thumbnail, and can be renamed and deleted', async ({ page }) => {
  const stamp = Date.now();
  const name = `Card test ${stamp}`;
  const renamed = `Renamed ${stamp}`;
  await createProject(page, name);
  const url = page.url();
  await page.goto('/');

  const card = page.getByRole('listitem').filter({ hasText: name });
  await expect(card.getByRole('img', { name: `Plan of ${name}` })).toBeVisible();

  // Rename: saved as a revision, so the project page shows it as the last change.
  await page.getByRole('button', { name: `Rename ${name}` }).click();
  await page.getByLabel(`New name for ${name}`).fill(renamed);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: new RegExp(renamed) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
  await page.getByRole('link', { name: new RegExp(renamed) }).click();
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible();
  await expect(page.getByText(`Last change: Rename to ${renamed}`)).toBeVisible();

  // Delete: asks first, then the project is gone for good.
  await page.goto('/');
  await page.getByRole('button', { name: `Delete ${renamed}` }).click();
  await page.getByRole('button', { name: 'Keep it' }).click();
  await expect(page.getByRole('link', { name: new RegExp(renamed) })).toBeVisible();
  await page.getByRole('button', { name: `Delete ${renamed}` }).click();
  await page.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(page.getByRole('link', { name: new RegExp(renamed) })).toHaveCount(0);
  expect((await page.goto(url))?.status()).toBe(404);
});

test('the app can be installed: manifest and icons are linked and served', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.json');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#111827');

  const res = await request.get('/manifest.json');
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as { icons: Array<{ src: string }> };
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  for (const { src } of manifest.icons) {
    const icon = await request.get(src);
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toBe('image/png');
  }
});
