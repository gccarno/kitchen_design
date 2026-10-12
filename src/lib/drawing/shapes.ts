/**
 * Plain drawing shapes, shared by the on-screen elevations (React SVG) and
 * the exported drawings (SVG strings). Coordinates are mm, y down. Pure.
 */

import { escapeXml } from '../plan/svg';

export type Shape = { componentId?: string } & (
  | { type: 'rect'; x: number; y: number; w: number; h: number; fill: string; stroke?: string; strokeWidth?: number; dash?: number[] }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; dash?: number[] }
  | { type: 'circle'; cx: number; cy: number; r: number; fill: string; stroke?: string; strokeWidth?: number }
  | { type: 'text'; x: number; y: number; text: string; size: number; anchor: 'start' | 'middle' | 'end'; fill: string }
);

export const INK = '#111827';

const r = (n: number) => Math.round(n * 10) / 10;

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
