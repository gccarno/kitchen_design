import { test, expect } from '@playwright/test';

test('the sample kitchen opens in 3D, draws its blocks, and goes back to the plan', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('floor-plan')).toBeVisible();

  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: '3D' }).click();
  const view = page.getByTestId('kitchen-3d');
  await expect(view).toBeVisible();
  await expect(view.locator('canvas')).toBeVisible();
  // Fridge, cabinets, range hood, island and stools; four walls cut for the window and the door.
  expect(Number(await view.getAttribute('data-boxes'))).toBeGreaterThanOrEqual(8);
  expect(Number(await view.getAttribute('data-walls'))).toBeGreaterThanOrEqual(6);
  // The plan is not on the page while 3D is showing.
  await expect(page.getByTestId('floor-plan')).toHaveCount(0);

  // Resetting the view redraws it.
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(view.locator('canvas')).toBeVisible();

  // Picking an item to place goes back to the plan, ready to place it.
  await page.getByRole('button', { name: /Dishwasher \(600 mm\)/ }).click();
  await expect(page.getByTestId('floor-plan')).toBeVisible();
  await expect(view).toHaveCount(0);
  await expect(page.getByText(/Tap the plan to place/)).toBeVisible();

  expect(errors).toEqual([]);
});
