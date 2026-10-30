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

test('the sample kitchen also shows the accessibility check, kept apart from the NKBA count', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  // The island leaves a tight aisle, so the demo misses the wheelchair rules; wall cabinets are information only.
  await expect(page.getByRole('heading', { name: 'Accessibility — 0 of 3 passed' })).toBeVisible();
  const rules = page.getByRole('list', { name: 'Accessibility' }).getByRole('listitem');
  await expect(rules).toHaveCount(4);
  await expect(rules.filter({ hasText: 'Space to turn a wheelchair' })).toContainText('✗');
  await expect(page.getByRole('heading', { name: 'Layout check — 8 of 8 passed' })).toBeVisible();
});

test('a closet template shows the accessibility check for its rods and storage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('group', { name: 'Design a' }).getByText('Closet').click();
  await page.getByLabel('Start from').selectOption({ label: 'Hanging and drawers' });
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Accessibility — 2 of 2 passed' })).toBeVisible();
});
