import { test, expect } from '@playwright/test';
import { projectJson } from './helpers';

test('a kitchen template furnishes the new project and opens in the editor', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Start from').selectOption({ label: 'U-shape' });
  await expect(page.getByText(/Three runs around/)).toBeVisible();
  await page.getByLabel('New project name').fill('Template U');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);

  await expect(page.getByTestId('floor-plan').locator('canvas').first()).toBeVisible();
  const project = projectJson(page.url().split('/').pop()!);
  expect(project.name).toBe('Template U');
  expect(project.room.polygon[2]).toEqual([3200, 3400]);
  const ids = project.items.map((it: { catalogId: string }) => it.catalogId);
  for (const id of ['sink-base-900', 'range-760', 'fridge-600', 'dishwasher-600']) expect(ids).toContain(id);
});

test('a closet template furnishes the new project, named after the template when no name is typed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('group', { name: 'Design a' }).getByText('Closet').click();
  await page.getByLabel('Start from').selectOption({ label: 'Hanging and drawers' });
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);

  await expect(page.getByRole('img', { name: 'Closet elevation' })).toBeVisible();
  const project = projectJson(page.url().split('/').pop()!);
  expect(project.name).toBe('Hang-and-drawers closet');
  expect(project.kind).toBe('closet');
  const kinds = project.closet.components.map((c: { kind: string }) => c.kind);
  expect(kinds).toContain('drawers');
  expect(kinds.filter((k: string) => k === 'rod')).toHaveLength(3);
});
