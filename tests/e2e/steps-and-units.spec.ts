import { test, expect } from '@playwright/test';
import { openStep, projectJson } from './helpers';

test('a kitchen in feet and inches: sketch it as 12\' 6" × 10\', and the step survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New project name').fill('Imperial');
  await page.getByLabel('Units').selectOption('in');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  expect(projectJson(id).units).toBe('in');

  // A new project opens on Room; the room size is shown in feet and inches.
  await expect(page.getByRole('tab', { name: 'Room' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(`9' 10" × 13' 1 1/2", 129 ft²`)).toBeVisible();

  await page.getByLabel(/^Width/).fill(`12' 6"`);
  await page.getByLabel(/^Depth/).fill(`10'`);
  await expect(page.getByText('= 12\' 6"')).toBeVisible();
  await page.getByRole('button', { name: 'Use rectangle' }).click();
  await page.getByRole('button', { name: 'Save room' }).click();
  const review = page.getByRole('region', { name: 'Review proposed change' });
  await expect(review.getByText(/3810 × 3048 mm/)).toBeVisible();
  await review.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Revision 1')).toBeVisible();
  const [, [x1], [, y2]] = projectJson(id).room.polygon;
  expect(x1).toBeCloseTo(3810, 0);
  expect(y2).toBeCloseTo(3048, 0);

  // Switching the units is a revision of its own, and undo brings the old units back.
  await page.getByRole('combobox', { name: /Units/ }).selectOption('mm');
  await expect(page.getByText('Revision 2')).toBeVisible();
  expect(projectJson(id).units).toBe('mm');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Revision 3')).toBeVisible();
  expect(projectJson(id).units).toBe('in');

  // The step you were on is still open after a reload.
  await openStep(page, 'Layout');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Layout' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
  // Only the open step shows: the other steps' panels are really hidden, not just marked so.
  await expect(page.getByRole('heading', { name: 'Photos' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Estimate' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Share and export' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Suggest layouts' })).toBeVisible();
});
