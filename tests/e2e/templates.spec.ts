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

test('"Scroll page" hands touch back to the page so a phone can scroll past the plan', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  const plan = page.getByTestId('floor-plan');
  await expect(plan).toHaveClass(/touch-none/);
  const toggle = page.getByRole('button', { name: 'Scroll page' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(plan).toHaveClass(/touch-pan-y/);
  await toggle.click();
  await expect(plan).toHaveClass(/touch-none/);
});

test('with "Scroll page" on, a finger swipe over the plan scrolls the page and leaves the plan alone', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 800 } });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  const plan = page.getByTestId('floor-plan');
  await expect(plan.locator('canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Scroll page' }).click();
  await plan.scrollIntoViewIfNeeded();
  const before = { x: await plan.getAttribute('data-x'), y: await plan.getAttribute('data-y'), scroll: await page.evaluate(() => window.scrollY) };
  const box = (await plan.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const x = box.x + box.width / 2;
  const from = Math.min(box.y + box.height - 20, 760);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from - i * 30 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before.scroll + 50);
  expect(await plan.getAttribute('data-x')).toBe(before.x);
  expect(await plan.getAttribute('data-y')).toBe(before.y);
  await context.close();
});
