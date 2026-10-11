import { test, expect } from '@playwright/test';

test('change a price in the sample kitchen estimate, then undo it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Revision 0')).toBeVisible();

  const table = page.getByRole('table', { name: 'Estimate' });
  const total = table.getByRole('row', { name: /^Total/ });
  const before = await total.textContent();
  expect(before).toMatch(/\$[\d,]+\.\d\d/);

  // The first part's unit price, raised by 100.
  const price = table.getByRole('textbox', { name: /^Unit price: / }).first();
  const old = Number(await price.inputValue());
  await price.fill(String(old + 100));
  await price.press('Enter');
  await expect(page.getByText('Revision 1')).toBeVisible();
  await expect(total).not.toHaveText(before!);
  await expect(table.getByRole('button', { name: /^Reset the price of / })).toHaveCount(1);
  await expect(page.getByText(/^Last change: Set the price of /)).toBeVisible();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Revision 2')).toBeVisible();
  await expect(total).toHaveText(before!);
  await expect(price).toHaveValue(String(old));
});
