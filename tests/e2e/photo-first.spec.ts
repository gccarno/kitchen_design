import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planToJsonPatch } from '../../src/lib/plan/diff';
import { createProject, mockJob, projectJson } from './helpers';

test('photos with no tape measure → an estimated room → confirm one real size', async ({ page }) => {
  const { id } = await createProject(page, 'Photo first');

  const photo = readFileSync(join(__dirname, 'fixtures', 'kitchen-photo.jpg'));
  await page.getByLabel('Choose photos').setInputFiles({ name: 'kitchen-photo.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect.poll(() => projectJson(id).photos.length).toBe(1);

  // The model's guess, with no measurements: the server marks the room as estimated.
  const before = projectJson(id);
  const guessed = {
    ...before,
    room: { ...before.room, polygon: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], sizeEstimated: true },
  };
  await mockJob(
    page,
    `**/api/projects/${id}/extract`,
    {
      room: guessed.room,
      confidence: 0.5,
      notes: 'Scaled from the 900 mm counter.',
      scale: 1,
      residual: 0,
      warnings: ['No measured walls: all sizes are the model’s estimate. After applying, confirm one real size in the Room step.'],
      baseRevision: before.revision,
      patch: planToJsonPatch(before, guessed),
    },
    (body) => expect(body).toEqual({ measurements: [] })
  );

  // No measurement typed: the button just works.
  await page.getByRole('button', { name: 'Get room from photos' }).click();
  const review = page.getByRole('region', { name: 'Review proposed change' });
  await expect(review.getByText('Scaled from the 900 mm counter.')).toBeVisible();
  await review.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Revision 1')).toBeVisible();

  // The room is marked as a guess until a real size is confirmed.
  expect(projectJson(id).room.sizeEstimated).toBe(true);
  const notice = page.getByRole('note').filter({ hasText: 'Sizes are estimated from photos' });
  await expect(notice).toBeVisible();

  await page.getByLabel(/real size/i).fill('3.6 m');
  await expect(page.getByText(/changes the room by −10%/)).toBeVisible();
  await page.getByRole('button', { name: 'Rescale the room' }).click();
  const confirm = page.getByRole('region', { name: 'Review proposed change' });
  await expect(confirm.getByText('Confirm the room size: Wall 1 is 3600 mm')).toBeVisible();
  await confirm.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Revision 2')).toBeVisible();

  // Wall 1 is now exactly what was typed, and the guess flag is gone.
  const room = projectJson(id).room;
  expect(room.sizeEstimated).toBeUndefined();
  expect(room.polygon[1][0]).toBeCloseTo(3600, 0);
  expect(room.polygon[2][1]).toBeCloseTo(2700, 0);
  await expect(notice).toHaveCount(0);

  // It is one undoable revision.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Revision 3')).toBeVisible();
  expect(projectJson(id).room.sizeEstimated).toBe(true);
  expect(projectJson(id).room.polygon[1][0]).toBeCloseTo(4000, 0);
});
