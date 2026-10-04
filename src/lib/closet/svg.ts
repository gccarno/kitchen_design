/**
 * The closet as a dimensioned front-elevation SVG, for export: the shapes
 * from `closetDrawing`, the width and height on dimension lines, and a title
 * block. Sized to print at 1:SVG_SCALE like the kitchen plan, so the same
 * PNG rasterizer applies. Pure: no DOM, no I/O.
 */

import { escapeXml, SVG_SCALE } from '../plan/svg';
import { formatLength } from '../plan/viewport';
import type { Project } from '../plan/schemas';
import { closetDrawing, INK, type Shape } from './drawing';

const FONT = 'Helvetica, Arial, sans-serif';
const TEXT_MM = 90;
const r = (n: number) => Math.round(n * 10) / 10;

const DOOR_NAME = { bifold: 'Bifold doors', sliding: 'Sliding doors', hinged: 'Hinged doors', open: 'No doors' } as const;

export function shapeToSvg(s: Shape): string {
  const dash = 'dash' in s && s.dash ? ` stroke-dasharray="${s.dash.join(' ')}"` : '';
  switch (s.type) {
    case 'rect':
      return `<rect x="${r(s.x)}" y="${r(s.y)}" width="${r(s.w)}" height="${r(s.h)}" fill="${s.fill}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth ?? 1}"` : ''}${dash}/>`;
    case 'line':
      return `<line x1="${r(s.x1)}" y1="${r(s.y1)}" x2="${r(s.x2)}" y2="${r(s.y2)}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}"${dash}/>`;
    case 'circle':
      return `<circle cx="${r(s.cx)}" cy="${r(s.cy)}" r="${r(s.r)}" fill="${s.fill}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth ?? 1}"` : ''}/>`;
    case 'text':
      return `<text x="${r(s.x)}" y="${r(s.y)}" font-size="${r(s.size)}" text-anchor="${s.anchor}" dominant-baseline="middle" fill="${s.fill}">${escapeXml(s.text)}</text>`;
  }
}

export function closetToSvg(project: Project, opts: { date?: string } = {}): string {
  const closet = project.closet;
  if (!closet) throw new Error('not a closet project');
  const { widthMm: W, heightMm: H, depthMm: D, opening } = closet;
  const units = project.units;

  const left = 500;
  const top = 250;
  const bottom = 900;
  const x0 = -left;
  const y0 = -top;
  // Wide enough for the title block even for a narrow closet.
  const width = Math.max(W + left + 300, 3000);
  const height = H + top + bottom;

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(x0)} ${r(y0)} ${r(width)} ${r(height)}" width="${r(width / SVG_SCALE)}mm" height="${r(height / SVG_SCALE)}mm" font-family="${FONT}">`,
    `<title>${escapeXml(project.name)}</title>`,
    `<rect x="${r(x0)}" y="${r(y0)}" width="${r(width)}" height="${r(height)}" fill="#ffffff"/>`,
    '<g id="closet">',
    ...closetDrawing(closet, { showHangZones: true }).map(shapeToSvg),
    '</g>',
  ];

  // Dimensions: width under the floor, height left of the closet.
  const dy = H + 180;
  const dx = -250;
  out.push(
    `<g id="dimensions" stroke="#374151" stroke-width="8" fill="${INK}" font-size="${TEXT_MM}">`,
    `<line x1="0" y1="${dy}" x2="${r(W)}" y2="${dy}"/><line x1="0" y1="${dy - 50}" x2="0" y2="${dy + 50}"/><line x1="${r(W)}" y1="${dy - 50}" x2="${r(W)}" y2="${dy + 50}"/>`,
    `<text x="${r(W / 2)}" y="${dy + TEXT_MM}" text-anchor="middle" dominant-baseline="middle" stroke="none">${escapeXml(formatLength(W, units))}</text>`,
    `<line x1="${dx}" y1="0" x2="${dx}" y2="${r(H)}"/><line x1="${dx - 50}" y1="0" x2="${dx + 50}" y2="0"/><line x1="${dx - 50}" y1="${r(H)}" x2="${dx + 50}" y2="${r(H)}"/>`,
    `<text x="${dx - TEXT_MM}" y="${r(H / 2)}" transform="rotate(-90 ${dx - TEXT_MM} ${r(H / 2)})" text-anchor="middle" dominant-baseline="middle" stroke="none">${escapeXml(formatLength(H, units))}</text>`,
    '</g>'
  );

  const door =
    opening.style === 'open'
      ? DOOR_NAME.open
      : `${DOOR_NAME[opening.style]}, ${formatLength(opening.widthMm, units)} opening at ${formatLength(opening.leftMm, units)} from the left`;
  const date = (opts.date ?? project.updatedAt).slice(0, 10);
  const fy = H + 450;
  out.push(
    `<g id="title" fill="${INK}">`,
    `<text x="0" y="${fy}" font-size="${TEXT_MM * 1.6}" font-weight="bold">${escapeXml(project.name)}</text>`,
    `<text x="0" y="${fy + 170}" font-size="${TEXT_MM}">${escapeXml(`Front elevation · ${formatLength(D, units)} deep · ${door}`)}</text>`,
    `<text x="0" y="${fy + 300}" font-size="${TEXT_MM}">${escapeXml(`Scale 1:${SVG_SCALE} · revision ${project.revision} · ${date}`)}</text>`,
    '</g>',
    '</svg>'
  );
  return out.join('\n');
}
