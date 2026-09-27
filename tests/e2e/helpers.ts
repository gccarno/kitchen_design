import { expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type View = { scale: number; x: number; y: number };

/** Create a project from the home page and return its id once the canvas is ready. */
export async function createProject(page: Page, name: string): Promise<{ id: string; canvas: Locator }> {
  await page.goto('/');
  await page.getByLabel('New project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  const canvas = page.getByTestId('floor-plan');
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas.locator('canvas').first()).toBeVisible();
  await expect.poll(() => view(canvas).then((v) => v.scale)).toBeGreaterThan(0);
  return { id: page.url().split('/').pop()!, canvas };
}

export function projectJson(id: string) {
  return JSON.parse(readFileSync(join(process.env.E2E_DATA_DIR!, 'projects', id, 'project.json'), 'utf-8'));
}

export async function view(canvas: Locator): Promise<View> {
  const [scale, x, y] = await Promise.all(['data-scale', 'data-x', 'data-y'].map((a) => canvas.getAttribute(a)));
  return { scale: Number(scale), x: Number(x), y: Number(y) };
}

/** The canvas's inner (padding-box) rectangle in page coordinates — where the stage is drawn. */
export async function inner(canvas: Locator) {
  const box = (await canvas.boundingBox())!;
  const { left, top, width, height } = await canvas.evaluate((el) => ({
    left: el.clientLeft,
    top: el.clientTop,
    width: el.clientWidth,
    height: el.clientHeight,
  }));
  return { x: box.x + left, y: box.y + top, width, height };
}

export const toScreen = (v: View, [wx, wy]: [number, number]): [number, number] => [wx * v.scale + v.x, wy * v.scale + v.y];
export const toWorld = (v: View, [sx, sy]: [number, number]): [number, number] => [(sx - v.x) / v.scale, (sy - v.y) / v.scale];

/** Page coordinates of a world point on the canvas. */
export async function pagePoint(canvas: Locator, world: [number, number]): Promise<[number, number]> {
  const [v, box] = await Promise.all([view(canvas), inner(canvas)]);
  const [sx, sy] = toScreen(v, world);
  return [box.x + sx, box.y + sy];
}
