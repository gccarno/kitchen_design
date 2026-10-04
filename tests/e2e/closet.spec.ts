import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { projectJson, settle } from './helpers';

/** Create a closet project from the home page; returns its id and the elevation. */
async function createCloset(page: Page, name: string): Promise<{ id: string; svg: Locator }> {
  await page.goto('/');
  await page.getByRole('group', { name: 'Design a' }).getByText('Closet').click();
  await page.getByLabel('New project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  const svg = page.getByRole('img', { name: 'Closet elevation' });
  await expect(svg).toBeVisible();
  return { id: page.url().split('/').pop()!, svg };
}

/**
 * Page point of a closet point (x from the left side, y up from the floor),
 * for the default 1830 × 2440 closet: viewBox (−60, −60, 1950, 2560), fitted
 * uniformly and centred in the <svg> box.
 */
async function closetPoint(svg: Locator, x: number, y: number): Promise<[number, number]> {
  const box = (await svg.boundingBox())!;
  const scale = Math.min(box.width / 1950, box.height / 2560);
  const offX = (box.width - 1950 * scale) / 2;
  const offY = (box.height - 2560 * scale) / 2;
  return [box.x + offX + (x + 60) * scale, box.y + offY + (2440 - y + 60) * scale];
}

test('design a closet: place, drag, warnings, undo, export, list', async ({ page }) => {
  const { id, svg } = await createCloset(page, 'E2E closet');
  expect(projectJson(id)).toMatchObject({ kind: 'closet', closet: { widthMm: 1830, components: [] } });

  // Place a top shelf and a rod by tapping. Picking one scrolls the closet into view.
  await page.getByRole('button', { name: 'Shelf', exact: true }).click();
  await settle(svg);
  await page.mouse.click(...(await closetPoint(svg, 915, 2134)));
  await expect(page.getByText('Revision 1')).toBeVisible();
  await page.getByRole('button', { name: 'Hanging rod' }).click();
  await settle(svg);
  await page.mouse.click(...(await closetPoint(svg, 450, 800)));
  await expect(page.getByText('Revision 2')).toBeVisible();
  const [shelf, rod] = projectJson(id).closet.components;
  expect(shelf).toMatchObject({ kind: 'shelf', yMm: 2125 });
  expect(rod).toMatchObject({ kind: 'rod', xMm: 0, yMm: 800 });

  // A rod at 800 mm leaves clothes on the floor: warned, not refused.
  await expect(page.getByRole('list', { name: 'Closet warnings' })).toContainText('would touch the floor');

  // Drag the rod up; the warning goes.
  const from = await closetPoint(svg, 450, 800);
  const to = await closetPoint(svg, 450, 1727);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(from[0], (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(...to, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText('Revision 3')).toBeVisible();
  expect(projectJson(id).closet.components[1].yMm).toBe(1725);
  await expect(page.getByRole('list', { name: 'Closet warnings' })).toHaveCount(0);

  // Undo puts it back.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Revision 4')).toBeVisible();
  expect(projectJson(id).closet.components[1].yMm).toBe(800);

  // Export.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'PNG', exact: true }).click()]);
  expect(download.suggestedFilename()).toBe('e2e-closet.png');
  expect((await sharp((await download.path())!).metadata()).format).toBe('png');
  const [svgDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'SVG', exact: true }).click()]);
  expect(readFileSync((await svgDownload.path())!, 'utf8')).toContain('Front elevation');

  // The project list shows it as a closet.
  await page.getByRole('link', { name: 'All projects' }).click();
  const card = page.getByRole('listitem').filter({ hasText: 'E2E closet' });
  await expect(card.getByRole('img', { name: 'Elevation of E2E closet' })).toBeVisible();
  await expect(card.getByText('Closet', { exact: true })).toBeVisible();
});

test('change the size and doors, and ask the chat for a layout', async ({ page }) => {
  const { id } = await createCloset(page, 'E2E closet chat');

  await page.getByLabel('Inside width (mm)').fill('2400');
  await page.getByLabel('Doors').selectOption('sliding');
  await page.getByRole('button', { name: 'Save size and doors' }).click();
  await expect(page.getByText('Revision 1')).toBeVisible();
  expect(projectJson(id).closet).toMatchObject({ widthMm: 2400, opening: { style: 'sliding', leftMm: 0, widthMm: 2400 } });

  // The e2e server has no LLM key, so the refine response is mocked in the browser.
  await page.route(`**/api/projects/${id}/refine`, async (route) => {
    await route.fulfill({
      json: {
        commands: [{ type: 'addComponent', kind: 'drawers', xMm: 1300 }],
        patch: [
          {
            op: 'add',
            path: '/closet/components/0',
            value: { id: 'f1e2d3c4-0000-4000-8000-000000000001', kind: 'drawers', xMm: 1300, widthMm: 610, yMm: 0, heightMm: 914, depthMm: 406, count: 4 },
          },
        ],
        summary: 'Add a drawer unit',
        reply: 'Added a 4-drawer unit in the right half.',
        warnings: [],
        baseRevision: 1,
      },
    });
  });
  await page.getByLabel('Ask for a change').fill('add drawers on the right');
  await page.getByLabel('Ask for a change').press('Enter');
  const review = page.getByRole('region', { name: 'Review proposed change' });
  await expect(review.getByText('Drawer unit, 610 × 914 mm, 4 drawers, at 1300 mm from the left, 0 mm up')).toBeVisible();
  await expect(review.getByRole('img', { name: 'Proposed closet' })).toBeVisible();
  await review.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Revision 2')).toBeVisible();
  expect(projectJson(id).closet.components[0]).toMatchObject({ kind: 'drawers', xMm: 1300 });
});
