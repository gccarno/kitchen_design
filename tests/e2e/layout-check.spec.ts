import { test, expect } from '@playwright/test';

test('the sample kitchen shows the layout check', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  // Counter frontage is information only, so eight of the nine rules are counted.
  await expect(page.getByRole('heading', { name: 'Layout check — 8 of 8 passed' })).toBeVisible();
  const rules = page.getByRole('list', { name: 'Layout check' }).getByRole('listitem');
  await expect(rules).toHaveCount(9);
  // Fails are listed first, so with none the sample's list starts with a pass and shows no ✗.
  await expect(rules.first()).toContainText('✓');
  await expect(rules.filter({ hasText: '✗' })).toHaveCount(0);
});
