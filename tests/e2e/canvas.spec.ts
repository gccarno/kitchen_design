import { test, expect, type Locator, type Page } from '@playwright/test';
import { createProject, inner, toScreen, toWorld, view } from './helpers';

async function openNewProject(page: Page): Promise<Locator> {
  return (await createProject(page, 'Canvas e2e')).canvas;
}

/** Darkest channel value at a CSS-pixel point, across all Konva layer canvases (255 = white/empty). */
async function darkness(canvas: Locator, [x, y]: [number, number]): Promise<number> {
  return canvas.evaluate(
    (el, [px, py]) => {
      let min = 255;
      for (const c of Array.from(el.querySelectorAll('canvas'))) {
        const ratio = c.width / c.clientWidth;
        const d = c.getContext('2d')!.getImageData(Math.round(px * ratio), Math.round(py * ratio), 1, 1).data;
        if (d[3] > 0) min = Math.min(min, d[0], d[1], d[2]);
      }
      return min;
    },
    [x, y]
  );
}

test('draws the default 3000 × 4000 room fitted to the view, with metric rulers', async ({ page }) => {
  const canvas = await openNewProject(page);
  const v = await view(canvas);
  const box = await inner(canvas);

  // Fitted: the room's centre is at the centre of the area the rulers don't cover.
  const ruler = await page.getByTestId('ruler-y').evaluate((el) => (el as HTMLElement).offsetWidth);
  const [cx, cy] = toScreen(v, [1500, 2000]);
  expect(cx).toBeCloseTo(ruler + (box.width - ruler) / 2, 0);
  expect(cy).toBeCloseTo(ruler + (box.height - ruler) / 2, 0);

  // Floor fill inside, a dark wall on the top edge, nothing well outside the room.
  expect(await darkness(canvas, [cx, cy])).toBeLessThan(250);
  expect(await darkness(canvas, toScreen(v, [1500, 0]))).toBeLessThan(80);
  expect(await darkness(canvas, toScreen(v, [-1500, 2000]))).toBeGreaterThan(200);

  await expect(page.getByTestId('ruler-x')).toContainText('1 m');
  await expect(page.getByTestId('ruler-y')).toContainText('2 m');
});

test('wheel zooms about the cursor without scrolling the page', async ({ page }) => {
  const canvas = await openNewProject(page);
  const box = await inner(canvas);
  const before = await view(canvas);
  const cursor: [number, number] = [Math.round(box.width * 0.3), Math.round(box.height * 0.6)];
  const worldUnderCursor = toWorld(before, cursor);
  const scrollBefore = await page.evaluate(() => window.scrollY);

  await page.mouse.move(box.x + cursor[0], box.y + cursor[1]);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => view(canvas).then((v) => v.scale)).toBeGreaterThan(before.scale * 1.5);

  const after = await view(canvas);
  const stillUnder = toWorld(after, cursor);
  // Within 5 mm: the browser rounds the mouse position to device pixels.
  expect(Math.abs(stillUnder[0] - worldUnderCursor[0])).toBeLessThan(5);
  expect(Math.abs(stillUnder[1] - worldUnderCursor[1])).toBeLessThan(5);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
});

test('dragging pans by exactly the drag distance', async ({ page }) => {
  const canvas = await openNewProject(page);
  const box = (await canvas.boundingBox())!;
  const before = await view(canvas);

  await page.mouse.move(box.x + 200, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 190, { steps: 4 });
  await page.mouse.move(box.x + 300, box.y + 200, { steps: 4 });
  await page.mouse.up();

  const after = await view(canvas);
  expect(after.scale).toBe(before.scale);
  expect(after.x - before.x).toBeCloseTo(100, 0);
  expect(after.y - before.y).toBeCloseTo(50, 0);
});

test('zoom buttons zoom about the centre and Fit restores the fitted view', async ({ page }) => {
  const canvas = await openNewProject(page);
  const fitted = await view(canvas);

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => view(canvas).then((v) => v.scale)).toBeCloseTo(fitted.scale * 1.25 * 1.25, 6);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => view(canvas).then((v) => v.scale)).toBeCloseTo(fitted.scale * 1.25, 6);

  await page.getByRole('button', { name: 'Fit' }).click();
  await expect.poll(() => view(canvas)).toEqual(fitted);
});

test('two-finger pinch zooms (real touch events)', async ({ page }) => {
  const canvas = await openNewProject(page);
  const box = (await canvas.boundingBox())!;
  const before = await view(canvas);
  const cdp = await page.context().newCDPSession(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const fingers = (spread: number) => [
    { x: cx - spread, y: cy, id: 1 },
    { x: cx + spread, y: cy, id: 2 },
  ];

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(40) });
  for (const spread of [50, 60, 70, 80]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(spread) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  // Fingers went from 80 px to 160 px apart: about 2× zoom.
  await expect.poll(() => view(canvas).then((v) => v.scale / before.scale)).toBeGreaterThan(1.7);
  expect((await view(canvas)).scale / before.scale).toBeLessThan(2.3);
});
