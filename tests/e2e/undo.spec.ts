import { test, expect, type Page } from '@playwright/test';
import { createProject, pagePoint, projectJson, settle } from './helpers';

async function placeDishwasher(page: Page, canvas: import('@playwright/test').Locator, revision: number) {
  await page.getByRole('button', { name: /^Dishwasher \(600 mm\)/ }).click();
  await settle(canvas);
  const [x, y] = await pagePoint(canvas, [1234, 100]);
  await page.mouse.click(x, y);
  await expect(page.getByText(`Revision ${revision}`)).toBeVisible();
}

test('undo and redo a change with the buttons and the keyboard; both survive a reload', async ({ page }) => {
  const { id, canvas } = await createProject(page, 'Undo');
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await expect(undo).toBeDisabled();

  await placeDishwasher(page, canvas, 1);
  await page.getByRole('button', { name: 'Remove item' }).click();
  await expect(page.getByText('Revision 2')).toBeVisible();
  await expect(page.getByText('Last change: Remove Dishwasher (600 mm)')).toBeVisible();

  // Undo the removal: the dishwasher is back exactly where it was.
  const placed = projectJson(id).history[0].patch[0].value;
  await undo.click();
  await expect(page.getByText('Revision 3')).toBeVisible();
  expect(projectJson(id).items).toEqual([placed]);

  // Redo removes it again; Ctrl+Z brings it back.
  await redo.click();
  await expect(page.getByText('Revision 4')).toBeVisible();
  expect(projectJson(id).items).toEqual([]);
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Revision 5')).toBeVisible();
  expect(projectJson(id).items).toEqual([placed]);

  // After a reload, the next undo still knows what to revert.
  await page.reload();
  await expect(page.getByText('Revision 5')).toBeVisible();
  await expect(redo).toBeEnabled();
  await undo.click();
  await expect(page.getByText('Revision 6')).toBeVisible();
  expect(projectJson(id).items).toEqual([]);
  await expect(undo).toBeDisabled();

  await page.getByText(/^History \(6\)/).click();
  await expect(page.getByRole('list', { name: 'Change history' }).getByRole('listitem').first()).toContainText('#6 Undo: Add Dishwasher (600 mm)');
});
