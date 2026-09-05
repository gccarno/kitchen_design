import { test, expect } from '@playwright/test';

test('home page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Kitchen Design' })).toBeVisible();
  await expect(page.getByText('docs/plan.md')).toBeVisible();
});
