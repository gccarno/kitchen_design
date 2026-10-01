import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { createProject } from './helpers';

test('download the plan as an SVG drawing', async ({ page }) => {
  await createProject(page, 'Export me');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'SVG', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('export-me.svg');
  const svg = readFileSync((await download.path())!, 'utf8');
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  expect(svg).toContain('>1 · 3000 mm</text>');
  expect(svg).toContain('>Export me</text>');
});

test('download the plan as a PNG, at 1× and 2×', async ({ page }) => {
  await createProject(page, 'Export png');
  const save = async (name: string) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name, exact: true }).click()]);
    return { name: download.suggestedFilename(), meta: await sharp((await download.path())!).metadata() };
  };
  const one = await save('PNG');
  const two = await save('PNG (2×)');
  expect([one.name, two.name]).toEqual(['export-png.png', 'export-png@2x.png']);
  expect(one.meta.format).toBe('png');
  expect(Math.abs(two.meta.width! - 2 * one.meta.width!)).toBeLessThanOrEqual(2);
});
