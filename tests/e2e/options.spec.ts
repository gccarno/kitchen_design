import { test, expect } from '@playwright/test';

test('download the spec sheet, duplicate the sample kitchen as an option, edit it, and compare', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  const originalUrl = page.url();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Spec sheet (PDF)' }).click()]);
  expect(download.suggestedFilename()).toBe('sample-kitchen-spec-sheet.pdf');

  await page.getByRole('button', { name: 'Duplicate as option' }).click();
  await page.waitForURL((url) => /\/project\/[0-9a-f-]{36}$/.test(url.pathname) && url.href !== originalUrl);
  await expect(page.getByRole('heading', { level: 1, name: 'Sample kitchen — Option B' })).toBeVisible();
  await expect(page.getByText('Revision 0')).toBeVisible();

  // Make the option cost more: raise the first unit price.
  const price = page.getByRole('table', { name: 'Estimate' }).getByRole('textbox', { name: /^Unit price: / }).first();
  await price.fill(String(Number(await price.inputValue()) + 100));
  await price.press('Enter');
  await expect(page.getByText('Revision 1')).toBeVisible();

  await page.getByRole('link', { name: 'Compare options' }).click();
  await page.waitForURL(/\/compare\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Compare options — Sample kitchen' })).toBeVisible();
  const columns = page.getByRole('list', { name: 'Options' }).locator(':scope > li');
  await expect(columns).toHaveCount(2);
  await expect(columns.nth(0).getByRole('link', { name: 'Sample kitchen', exact: true })).toBeVisible();
  await expect(columns.nth(1).getByRole('link', { name: 'Sample kitchen — Option B' })).toBeVisible();
  const totals = await columns.getByText(/^Total /).allTextContents();
  expect(totals).toHaveLength(2);
  expect(totals[0]).not.toBe(totals[1]);
  await expect(page.getByText('These options use the same parts.')).toBeVisible();
});
