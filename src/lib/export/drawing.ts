/**
 * Shared by the export routes: load a project and draw it, and rasterize
 * the drawing. Server-only (reads project files; sharp is native).
 */

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { loadCatalog } from '../catalog/loader';
import type { Project } from '../plan/schemas';
import { planToSvg, SVG_SCALE } from '../plan/svg';
import { isValidProjectId, loadProject, projectExists, resolveDataDir } from '../storage/projects';

/** At 1×, one pixel per this many plan millimetres (a 5 m room is ~1000 px wide). */
export const PNG_MM_PER_PX = 5;
export const PNG_SCALES = [1, 2] as const;
export type PngScale = (typeof PNG_SCALES)[number];

/** The project and its drawing (items labelled with catalog names), or an error response. */
export function loadDrawing(id: string): { project: Project; svg: string } | { error: NextResponse } {
  if (!isValidProjectId(id)) return { error: NextResponse.json({ error: 'invalid project id' }, { status: 400 }) };
  const dataDir = resolveDataDir();
  if (!projectExists(dataDir, id)) return { error: NextResponse.json({ error: 'project not found' }, { status: 404 }) };
  const project = loadProject(dataDir, id);
  const catalog = loadCatalog();
  const labels = Object.fromEntries(project.items.map((it) => [it.id, catalog.byId.get(it.catalogId)?.name ?? it.catalogId]));
  return { project, svg: planToSvg(project, { labels }) };
}

/**
 * Rasterize a drawing from `planToSvg`. The SVG is sized in paper mm at
 * 1:SVG_SCALE, so the density that gives PNG_MM_PER_PX / scale plan mm per
 * pixel is 25.4 × SVG_SCALE / PNG_MM_PER_PX × scale dpi.
 */
export function svgToPng(svg: string, scale: PngScale): Promise<Buffer> {
  const density = ((25.4 * SVG_SCALE) / PNG_MM_PER_PX) * scale;
  return sharp(Buffer.from(svg), { density }).flatten({ background: '#ffffff' }).png().toBuffer();
}
