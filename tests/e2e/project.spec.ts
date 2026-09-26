import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

async function newProject(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await page.getByLabel('New project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop()!;
}

function projectJson(id: string) {
  return JSON.parse(readFileSync(join(process.env.E2E_DATA_DIR!, 'projects', id, 'project.json'), 'utf-8'));
}

test('sketch a room, review it, apply it, and it survives a reload', async ({ page }) => {
  const id = await newProject(page, 'Sketch e2e');
  await expect(page.getByText('Revision 0')).toBeVisible();

  await page.getByLabel('Width (mm)').fill('3600');
  await page.getByLabel('Depth (mm)').fill('2700');
  await page.getByRole('button', { name: 'Use rectangle' }).click();
  await page.getByRole('button', { name: 'Save room' }).click();

  const review = page.getByRole('region', { name: 'Review proposed change' });
  await expect(review.getByText(/3000 × 4000 mm.*→ 3600 × 2700 mm/)).toBeVisible();
  expect(projectJson(id).revision).toBe(0); // nothing saved before Apply

  await review.getByRole('button', { name: 'Apply' }).click();
  await expect(review).toBeHidden();
  await expect(page.getByText('Revision 1')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Revision 1')).toBeVisible();
  await expect(page.getByText(/3600 × 2700 mm, 9\.7 m²/)).toBeVisible();
  expect(projectJson(id).room.polygon).toEqual([
    [0, 0],
    [3600, 0],
    [3600, 2700],
    [0, 2700],
  ]);
});

test('upload a photo and mark a reference box with the pointer (stored in natural pixels)', async ({ page }) => {
  const id = await newProject(page, 'Photo e2e');
  // 2000×1500 photo; it is displayed much smaller, so CSS px ≠ image px.
  const jpeg = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 180, g: 170, b: 150 } } })
    .jpeg()
    .toBuffer();
  // The photo is served by an API route; wait for it (first hit compiles the route in dev).
  const photoResponse = page.waitForResponse((r) => /\/api\/projects\/[^/]+\/photos\/[^/]+$/.test(r.url()), {
    timeout: 60_000,
  });
  await page.getByLabel('Choose photos').setInputFiles({ name: 'kitchen.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  const served = await photoResponse;
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/jpeg');

  const img = page.getByRole('img', { name: /mark the reference object/i });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(2000);
  // Raw mouse events use viewport coordinates, so the image must be on screen.
  await img.scrollIntoViewIfNeeded();
  const box = (await img.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(box.width).toBeLessThan(2000);

  // Drag from 10%/20% to 30%/40% of the displayed image.
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('Saved')).toBeVisible();

  const ref = projectJson(id).photos[0].referenceObject;
  expect(ref).toMatchObject({ kind: 'credit_card', side: 'long', knownSizeMm: 85.6 });
  // Natural pixels: ≈ [200, 300, 600, 600] on the 2000×1500 image (±1 image px per CSS px of rounding).
  const tolerance = 2000 / box.width + 1;
  const expected = [200, 300, 600, 600];
  ref.pixelBox.forEach((v: number, i: number) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(tolerance));

  // With a photo present, extraction is available; with no LLM key it explains itself.
  await page.getByRole('button', { name: 'Get room from photos' }).click();
  await expect(page.getByText(/LLM_API_KEY is not set/)).toBeVisible();
});
