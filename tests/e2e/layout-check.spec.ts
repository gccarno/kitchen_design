import { test, expect } from '@playwright/test';

test('the sample kitchen shows the layout check', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: /^Layout check — \d+ of \d+ passed$/ })).toBeVisible();
  const rules = page.getByRole('list', { name: 'Layout check' }).getByRole('listitem');
  await expect(rules).toHaveCount(9);
  // Fails are listed first: the sample's sink has the fridge right beside it.
  await expect(rules.first()).toContainText('✗');
});
