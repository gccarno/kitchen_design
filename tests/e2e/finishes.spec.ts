import { test, expect } from '@playwright/test';
import { projectJson } from './helpers';

test('pick finishes: the elevations, the estimate and the saved project follow, and reset goes back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  const elevation = page.getByRole('img', { name: /^Elevation of / });
  const estimate = page.getByRole('table', { name: 'Estimate' });
  await expect(estimate.getByText('Countertop', { exact: true })).toBeVisible();
  expect(projectJson(id).finishes).toBeUndefined();

  await page.getByLabel('Cabinet colour').selectOption({ label: 'Navy' });
  await expect(page.getByText('Revision 1')).toBeVisible();
  await expect(elevation.locator('rect[fill="#1e3a5f"]').first()).toBeVisible();

  await page.getByRole('combobox', { name: /^Countertop/ }).selectOption({ label: 'Granite' });
  await expect(page.getByText('Revision 2')).toBeVisible();
  await expect(estimate.getByText('Countertop (granite)')).toBeVisible();

  await page.getByLabel('Door style').selectOption({ label: 'Slab (flat)' });
  await expect(page.getByText('Revision 3')).toBeVisible();
  expect(projectJson(id).finishes).toEqual({ cabinetColor: '#1e3a5f', doorStyle: 'slab', countertop: 'granite' });
  await expect(page.getByText('Navy cabinets, slab (flat) doors, granite countertop')).toBeVisible();

  // Back to the standard look in one step, and the estimate follows.
  await page.getByRole('button', { name: 'Reset to standard' }).click();
  await expect(page.getByText('Revision 4')).toBeVisible();
  expect(projectJson(id).finishes).toBeUndefined();
  await expect(estimate.getByText('Countertop', { exact: true })).toBeVisible();
  await expect(elevation.locator('rect[fill="#1e3a5f"]')).toHaveCount(0);
});
