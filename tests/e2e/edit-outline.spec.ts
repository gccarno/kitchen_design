import { test, expect, type Locator, type Page } from '@playwright/test';
import { createProject, pagePoint, projectJson, view } from './helpers';

/** Drag with the mouse between two world points on the canvas. */
async function dragWorld(page: Page, canvas: Locator, from: [number, number], to: [number, number]) {
  const [fx, fy] = await pagePoint(canvas, from);
  const [tx, ty] = await pagePoint(canvas, to);
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move((fx + tx) / 2, (fy + ty) / 2, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}

async function startEditing(page: Page, name: string) {
  const { id, canvas } = await createProject(page, name);
  await page.getByRole('button', { name: 'Edit outline' }).click();
  await expect(page.getByRole('button', { name: 'Done editing' })).toBeVisible();
  return { id, canvas };
}

test('drag a corner: it snaps to 50 mm, saves as a revision, and the view does not jump', async ({ page }) => {
  const { id, canvas } = await startEditing(page, 'Edit drag');
  const before = await view(canvas);

  // Default room corner 3 is (3000, 4000); drop it near (3520, 4480).
  await dragWorld(page, canvas, [3000, 4000], [3520, 4480]);
  await expect(page.getByText('Revision 1')).toBeVisible();

  const saved = projectJson(id);
  expect(saved.room.polygon[2]).toEqual([3500, 4500]);
  expect(saved.room.walls).toHaveLength(4);
  expect(saved.history[0]).toMatchObject({ source: 'user', summary: 'Move corner 3' });
  expect(await view(canvas)).toEqual(before);
});

test('with snapping off, a corner lands where it is dropped', async ({ page }) => {
  const { id, canvas } = await startEditing(page, 'Edit no snap');
  await page.getByLabel('Snap to 50 mm').uncheck();
  await dragWorld(page, canvas, [3000, 4000], [3520, 4480]);
  await expect(page.getByText('Revision 1')).toBeVisible();

  const [x, y] = projectJson(id).room.polygon[2];
  // Within a screen pixel's worth of world distance of the drop point, and off the 50 mm grid.
  const mmPerPx = 1 / (await view(canvas)).scale;
  expect(Math.abs(x - 3520)).toBeLessThan(mmPerPx * 1.5);
  expect(Math.abs(y - 4480)).toBeLessThan(mmPerPx * 1.5);
  expect(x % 50 !== 0 || y % 50 !== 0).toBe(true);
});

test('add a corner with + and delete it again', async ({ page }) => {
  const { id, canvas } = await startEditing(page, 'Edit add/remove');

  // "+" handle at the middle of wall 1 (top wall, (0,0)→(3000,0)).
  const [px, py] = await pagePoint(canvas, [1500, 0]);
  await page.mouse.click(px, py);
  await expect(page.getByText('Revision 1')).toBeVisible();
  let saved = projectJson(id);
  expect(saved.room.polygon).toHaveLength(5);
  expect(saved.room.polygon[1]).toEqual([1500, 0]);
  expect(saved.room.walls).toHaveLength(5);

  // The new corner is selected; delete it.
  await page.getByRole('button', { name: 'Delete corner' }).click();
  await expect(page.getByText('Revision 2')).toBeVisible();
  saved = projectJson(id);
  expect(saved.room.polygon).toEqual([
    [0, 0],
    [3000, 0],
    [3000, 4000],
    [0, 4000],
  ]);
});

test('a drag that would make walls cross is refused and nothing is saved', async ({ page }) => {
  const { id, canvas } = await startEditing(page, 'Edit invalid');
  // Pull corner 2 (3000, 0) past the left wall: the outline would self-intersect.
  await dragWorld(page, canvas, [3000, 0], [-1000, 3000]);
  await expect(page.getByText(/can’t do that: room polygon is self-intersecting/i)).toBeVisible();
  expect(projectJson(id).revision).toBe(0);
  await expect(page.getByText('Revision 0')).toBeVisible();
});

test('dragging empty space still pans while editing', async ({ page }) => {
  const { id, canvas } = await startEditing(page, 'Edit pan');
  const before = await view(canvas);
  await dragWorld(page, canvas, [1500, 2000], [1800, 2200]);
  const after = await view(canvas);
  expect(after.x).not.toBe(before.x);
  expect(projectJson(id).revision).toBe(0);
});
