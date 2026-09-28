import { test, expect, type Locator, type Page } from '@playwright/test';
import { createProject, pagePoint, projectJson } from './helpers';

async function dragWorld(page: Page, canvas: Locator, from: [number, number], to: [number, number]) {
  const [fx, fy] = await pagePoint(canvas, from);
  const [tx, ty] = await pagePoint(canvas, to);
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move((fx + tx) / 2, (fy + ty) / 2, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}

async function clickWorld(page: Page, canvas: Locator, p: [number, number]) {
  const [x, y] = await pagePoint(canvas, p);
  await page.mouse.click(x, y);
}

/** A new project in edit mode, with a door placed centred on the top wall (1100–1900 mm). */
async function withDoor(page: Page, name: string) {
  const { id, canvas } = await createProject(page, name);
  await page.getByRole('button', { name: 'Edit outline' }).click();
  await page.getByRole('button', { name: 'Add door' }).click();
  await expect(page.getByText('Tap a wall to place the door.')).toBeVisible();
  await clickWorld(page, canvas, [1500, 40]);
  await expect(page.getByText('Revision 1')).toBeVisible();
  return { id, canvas };
}

test('place a door by tapping a wall', async ({ page }) => {
  const { id } = await withDoor(page, 'Openings place');
  const saved = projectJson(id);
  expect(saved.room.openings).toEqual([
    expect.objectContaining({ kind: 'door', wallId: saved.room.walls[0].id, positionMm: 1100, widthMm: 800 }),
  ]);
  expect(saved.history[0].summary).toBe('Add door on wall 1');
  // The new door is selected and described.
  await expect(page.getByTestId('opening-info')).toHaveText('Door on wall 1 · 800 mm wide · 1100 mm from the wall’s start');
  await expect(page.getByRole('button', { name: 'Delete door' })).toBeEnabled();
});

test('resize a door by dragging an end square, then slide it along the wall', async ({ page }) => {
  const { id, canvas } = await withDoor(page, 'Openings resize');

  // Drag the end square (1900, 0) to x≈2410 → snapped to 2400: width 1300.
  await dragWorld(page, canvas, [1900, 0], [2410, 30]);
  await expect(page.getByText('Revision 2')).toBeVisible();
  expect(projectJson(id).room.openings[0]).toMatchObject({ positionMm: 1100, widthMm: 1300 });

  // Grab the body 400 mm in (at x=1500) and drop at x≈1010 → starts at 610 → snapped 600.
  await dragWorld(page, canvas, [1500, 0], [1010, -20]);
  await expect(page.getByText('Revision 3')).toBeVisible();
  const saved = projectJson(id);
  expect(saved.room.openings[0]).toMatchObject({ positionMm: 600, widthMm: 1300 });
  expect(saved.history.map((h: { summary: string }) => h.summary)).toEqual([
    'Add door on wall 1',
    'Resize door on wall 1',
    'Move door on wall 1',
  ]);
});

test('delete the selected door', async ({ page }) => {
  const { id } = await withDoor(page, 'Openings delete');
  await page.getByRole('button', { name: 'Delete door' }).click();
  await expect(page.getByText('Revision 2')).toBeVisible();
  expect(projectJson(id).room.openings).toEqual([]);
});

test('placing away from a wall, or on top of another opening, is refused', async ({ page }) => {
  const { id, canvas } = await withDoor(page, 'Openings refused');

  await page.getByRole('button', { name: 'Add window' }).click();
  await clickWorld(page, canvas, [1500, 2000]); // middle of the room
  await expect(page.getByText('Tap on a wall to place the window.')).toBeVisible();

  await clickWorld(page, canvas, [1600, 0]); // on top of the door
  await expect(page.getByText(/can’t place it there: it would overlap the door/i)).toBeVisible();

  expect(projectJson(id).revision).toBe(1);
  expect(projectJson(id).room.openings).toHaveLength(1);
});
