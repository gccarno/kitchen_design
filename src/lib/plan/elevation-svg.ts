/**
 * Every wall elevation of a kitchen in one SVG, stacked down the page at
 * 1:SVG_SCALE (so the PNG rasterizer applies), with a heading per wall and
 * one title block. Pure: no DOM, no I/O.
 */

import type { Catalog } from '../catalog/loader';
import { INK, shapeToSvg } from '../drawing/shapes';
import { wallElevations, type WallElevation } from './elevation';
import { elevationDrawing, elevationFrame } from './elevation-drawing';
import type { Project } from './schemas';
import { escapeXml, SVG_SCALE } from './svg';

const FONT = 'Helvetica, Arial, sans-serif';
const HEADING_MM = 110;
const TEXT_MM = 90;
const r = (n: number) => Math.round(n * 10) / 10;

export function elevationsToSvg(project: Project, catalog: Catalog, opts: { date?: string } = {}): string {
  const elevations = wallElevations(project, catalog);
  if (elevations.length === 0) throw new Error('no wall elevations');
  const pad = 200;
  const width = Math.max(3000, ...elevations.map((e) => elevationFrame(e).w)) + 2 * pad;

  const body: string[] = [];
  let y = pad;
  for (const e of elevations) {
    const f = elevationFrame(e);
    body.push(`<text x="${pad}" y="${r(y + HEADING_MM)}" font-size="${HEADING_MM}" font-weight="bold" fill="${INK}">${escapeXml(e.label)}</text>`);
    y += HEADING_MM + 100;
    body.push(`<g transform="translate(${r(pad - f.x)} ${r(y - f.y)})">`, ...elevationDrawing(e, project.units).map(shapeToSvg), '</g>');
    y += f.h + 150;
  }
  const date = (opts.date ?? project.updatedAt).slice(0, 10);
  body.push(
    `<g id="title" fill="${INK}">`,
    `<text x="${pad}" y="${r(y + TEXT_MM * 1.6)}" font-size="${TEXT_MM * 1.6}" font-weight="bold">${escapeXml(project.name)}</text>`,
    `<text x="${pad}" y="${r(y + TEXT_MM * 1.6 + 170)}" font-size="${TEXT_MM}">${escapeXml(`Wall elevations · Scale 1:${SVG_SCALE} · revision ${project.revision} · ${date}`)}</text>`,
    '</g>'
  );
  const height = y + TEXT_MM * 1.6 + 170 + pad;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(width)} ${r(height)}" width="${r(width / SVG_SCALE)}mm" height="${r(height / SVG_SCALE)}mm" font-family="${FONT}">`,
    `<title>${escapeXml(`${project.name} — wall elevations`)}</title>`,
    `<rect x="0" y="0" width="${r(width)}" height="${r(height)}" fill="#ffffff"/>`,
    ...body,
    '</svg>',
  ].join('\n');
}

/** One wall's elevation alone, framed by `elevationFrame` and sized to print at 1:SVG_SCALE (for the spec sheet). */
export function wallElevationSvg(e: WallElevation, units: 'mm' | 'in'): string {
  const f = elevationFrame(e);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(f.x)} ${r(f.y)} ${r(f.w)} ${r(f.h)}" width="${r(f.w / SVG_SCALE)}mm" height="${r(f.h / SVG_SCALE)}mm" font-family="${FONT}">`,
    `<rect x="${r(f.x)}" y="${r(f.y)}" width="${r(f.w)}" height="${r(f.h)}" fill="#ffffff"/>`,
    ...elevationDrawing(e, units).map(shapeToSvg),
    '</svg>',
  ].join('\n');
}
