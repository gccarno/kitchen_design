import { test, expect, type Locator, type Page } from '@playwright/test';
import { createProject, pagePoint, projectJson, settle } from './helpers';

async function clickWorld(page: Page, canvas: Locator, p: [number, number]) {
  const [x, y] = await pagePoint(canvas, p);
  await page.mouse.click(x, y);
}

async function dragWorld(page: Page, canvas: Locator, from: [number, number], to: [number, number]) {
  const [fx, fy] = await pagePoint(canvas, from);
  const [tx, ty] = await pagePoint(canvas, to);
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move((fx + tx) / 2, (fy + ty) / 2, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}

/** Pick an item in the catalog, then tap the plan at a world point. */
async function place(page: Page, canvas: Locator, name: RegExp, at: [number, number], revision: number) {
  await page.getByRole('button', { name }).click();
  await expect(page.getByText(/Tap the plan to place/)).toBeVisible();
  await settle(canvas);
  await clickWorld(page, canvas, at);
  await expect(page.getByText(`Revision ${revision}`)).toBeVisible();
}

test('place a dishwasher against a wall, then move, rotate, and remove it', async ({ page }) => {
  const { id, canvas } = await createProject(page, 'Items basic');

  await place(page, canvas, /^Dishwasher \(600 mm\)/, [1234, 100], 1);
  let item = projectJson(id).items[0];
  expect(item).toMatchObject({
    catalogId: 'dishwasher-600',
    sizeMm: { w: 600, d: 580, h: 850 },
    clearanceMm: { front: 750, sides: 0 },
    tag: 'dishwasher',
    position: { x: 1250, y: 290 }, // back flush to the top wall, snapped along it
    rotationDeg: 0,
  });
  await expect(page.getByTestId('item-info')).toHaveText('Dishwasher (600 mm) · 600 mm × 580 mm');
  await expect(page.getByText(/Tap the plan to place/)).toBeHidden();

  // Drag along the wall: it stays back-to-wall.
  await dragWorld(page, canvas, [1250, 290], [2010, 160]);
  await expect(page.getByText('Revision 2')).toBeVisible();
  expect(projectJson(id).items[0].position).toEqual({ x: 2000, y: 290 });

  await page.getByRole('button', { name: 'Rotate 90°' }).click();
  await expect(page.getByText('Revision 3')).toBeVisible();
  expect(projectJson(id).items[0].rotationDeg).toBe(90);

  await page.getByRole('button', { name: 'Remove item' }).click();
  await expect(page.getByText('Revision 4')).toBeVisible();
  item = projectJson(id);
  expect(item.items).toEqual([]);
  expect(item.history.map((h: { summary: string }) => h.summary)).toEqual([
    'Add Dishwasher (600 mm)',
    'Move Dishwasher (600 mm)',
    'Rotate Dishwasher (600 mm)',
    'Remove Dishwasher (600 mm)',
  ]);
});

test('items face into the room on every wall', async ({ page }) => {
  const { id, canvas } = await createProject(page, 'Items walls');
  await place(page, canvas, /^Dishwasher \(600 mm\)/, [2950, 1000], 1);
  await place(page, canvas, /^Dishwasher \(600 mm\)/, [1500, 3950], 2);
  const [right, bottom] = projectJson(id).items;
  expect(right).toMatchObject({ position: { x: 2710, y: 1000 }, rotationDeg: 90 });
  expect(bottom).toMatchObject({ position: { x: 1500, y: 3710 }, rotationDeg: 180 });
});

test('a wall cabinet hangs over a base cabinet; tapping again selects the one below', async ({ page }) => {
  const { id, canvas } = await createProject(page, 'Items stack');
  await page.getByLabel('Search catalog').fill('600');
  await place(page, canvas, /^Base cabinet 600 mm\b(?! \()/, [1500, 100], 1);
  await place(page, canvas, /^Wall cabinet 600 mm\b(?! \()/, [1500, 100], 2);

  const items = projectJson(id).items;
  expect(items[1]).toMatchObject({ catalogId: 'wall-600x320x720', mount: 'wall', position: { x: 1500, y: 160 } });
  // Stacked at different levels: no overlap warning.
  await expect(page.getByRole('list', { name: /plan warnings/i })).toHaveCount(0);

  // The new wall cabinet is selected; tapping the stack again moves down to the base cabinet.
  await expect(page.getByTestId('item-info')).toContainText('Wall cabinet 600 mm');
  await clickWorld(page, canvas, [1500, 200]);
  await expect(page.getByTestId('item-info')).toContainText('Base cabinet 600 mm');
  await clickWorld(page, canvas, [1500, 200]);
  await expect(page.getByTestId('item-info')).toContainText('Wall cabinet 600 mm');
  expect(projectJson(id).revision).toBe(2); // selecting is not an edit
});

test('clearance problems are listed under the plan', async ({ page }) => {
  const { canvas } = await createProject(page, 'Items clearance');
  await page.getByLabel('Search catalog').fill('fridge');
  await place(page, canvas, /^Refrigerator, French door/, [1500, 100], 1);
  await page.getByLabel('Search catalog').fill('island');
  await place(page, canvas, /^Island \(1200 × 900 mm\)/, [1500, 1400], 2);
  await expect(page.getByRole('list', { name: /plan warnings/i })).toContainText(
    'not enough room in front of "fridge-standard-910": "island-1200x900" is in the way'
  );
});

test('placing outside the room, or a wall cabinet away from walls, is refused', async ({ page }) => {
  const { id, canvas } = await createProject(page, 'Items refused');
  await page.getByLabel('Search catalog').fill('600');
  await page.getByRole('button', { name: /^Wall cabinet 600 mm\b(?! \()/ }).click();
  await settle(canvas);
  await clickWorld(page, canvas, [1500, 2000]);
  await expect(page.getByText(/can’t place it there: wall-mounted items go against a wall/i)).toBeVisible();
  await clickWorld(page, canvas, [6000, 2000]);
  await expect(page.getByText(/can’t place it there: .*(inside the room|against a wall)/i)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText(/Tap the plan to place/)).toBeHidden();
  expect(projectJson(id).revision).toBe(0);
});
