import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createProject } from './helpers';

test('download the plan as an SVG drawing', async ({ page }) => {
  await createProject(page, 'Export me');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download drawing (SVG)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('export-me.svg');
  const svg = readFileSync((await download.path())!, 'utf8');
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  expect(svg).toContain('>1 · 3000 mm</text>');
  expect(svg).toContain('>Export me</text>');
});
