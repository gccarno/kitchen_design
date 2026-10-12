import { test, expect } from '@playwright/test';

test('the sample kitchen shows its wall elevation, and it downloads as SVG', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);

  const walls = page.getByRole('group', { name: 'Walls' }).getByRole('button');
  await expect(walls).toHaveCount(1);
  await expect(walls.first()).toHaveText('Wall 1 — north, 4200 mm');
  const drawing = page.getByRole('img', { name: 'Elevation of Wall 1 — north, 4200 mm' });
  await expect(drawing).toBeVisible();
  await expect(drawing.getByText('Refrigerator')).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Elevations as SVG' }).click()]);
  expect(download.suggestedFilename()).toBe('sample-kitchen-elevations.svg');
});
