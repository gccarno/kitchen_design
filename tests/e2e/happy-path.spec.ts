import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planToJsonPatch } from '../../src/lib/plan/diff';
import { createProject, pagePoint, projectJson, settle } from './helpers';

/**
 * The whole v1 journey in one test: new project → photo → measured wall →
 * extract → review and apply → place a cabinet → export the drawing.
 *
 * The e2e server has no LLM key, so the extract call is answered in the browser
 * with a room outline built the way the server builds it (a JSON Patch computed
 * from the saved project). The real endpoint → provider path is covered by
 * tests/integration/dev-server.test.ts against a fake OpenAI-compatible server.
 */
test('photo + measured wall → extracted room → cabinet → SVG export', async ({ page }) => {
  const { id, canvas } = await createProject(page, 'Happy path');

  // Upload one photo (a synthetic kitchen with a credit-card-sized marker).
  const photo = readFileSync(join(__dirname, 'fixtures', 'kitchen-photo.jpg'));
  await page.getByLabel('Choose photos').setInputFiles({ name: 'kitchen-photo.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.getByRole('img', { name: /mark the reference object/i })).toBeVisible();
  await expect.poll(() => projectJson(id).photos.length).toBe(1);

  // Mock the LLM: a 4000 × 3000 mm room whose measured wall is exactly 4000 mm.
  const before = projectJson(id);
  const after = {
    ...before,
    room: { ...before.room, polygon: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] },
  };
  await page.route(`**/api/projects/${id}/extract`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ measurements: [{ description: 'sink wall', lengthMm: 4000 }] });
    await route.fulfill({
      json: {
        room: after.room,
        confidence: 0.8,
        notes: 'mocked extraction',
        scale: 1,
        residual: 0,
        warnings: [],
        baseRevision: before.revision,
        patch: planToJsonPatch(before, after),
      },
    });
  });

  await page.getByLabel(/Which wall/).fill('sink wall');
  await page.getByLabel('Length (mm)').fill('4000');
  await page.getByRole('button', { name: 'Get room from photos' }).click();

  // Nothing is saved until the diff is confirmed.
  const review = page.getByRole('region', { name: 'Review proposed change' });
  await expect(review.getByRole('heading', { name: 'Room from photos' })).toBeVisible();
  await expect(review.getByText('Model confidence: 80%')).toBeVisible();
  expect(projectJson(id).revision).toBe(0);
  await review.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Revision 1')).toBeVisible();
  expect(projectJson(id).room.polygon).toEqual(after.room.polygon);

  // Place one cabinet against the north wall.
  await page.getByLabel('Search catalog').fill('600');
  await page.getByRole('button', { name: /^Base cabinet 600 mm\b(?! \()/ }).click();
  await expect(page.getByText(/Tap the plan to place/)).toBeVisible();
  await settle(canvas);
  const [x, y] = await pagePoint(canvas, [2000, 100]);
  await page.mouse.click(x, y);
  await expect(page.getByText('Revision 2')).toBeVisible();
  expect(projectJson(id).items).toHaveLength(1);

  // Export the drawing.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'SVG', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('happy-path.svg');
  const svg = readFileSync((await download.path())!, 'utf8');
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  expect(svg).toContain('>1 · 4000 mm</text>');
  expect(svg).toContain('>Happy path</text>');
  expect(svg).toContain('Base cabinet 600 mm');
});
