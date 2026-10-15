/**
 * Shared by the export routes: load a project and draw it, and rasterize
 * the drawing. Server-only (loads the project from storage; sharp is native).
 */

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { loadCatalog } from '../catalog/loader';
import { closetToSvg } from '../closet/svg';
import { wallElevations } from '../plan/elevation';
import { elevationsToSvg } from '../plan/elevation-svg';
import { projectKind, type Project } from '../plan/schemas';
import { exportFileName, planToSvg, SVG_SCALE } from '../plan/svg';
import { UnauthorizedError } from '../auth/session';
import { getStorage, isValidProjectId, type Storage } from '../storage';

/** At 1×, one pixel per this many plan millimetres (a 5 m room is ~1000 px wide). */
export const PNG_MM_PER_PX = 5;
export const PNG_SCALES = [1, 2] as const;
export type PngScale = (typeof PNG_SCALES)[number];

/** A download name for the project's drawing, e.g. "our-kitchen.svg". */
export function drawingFileName(project: Project, ext: string): string {
  return exportFileName(project.name, ext, projectKind(project) === 'closet' ? 'closet-elevation' : 'kitchen-plan');
}

/** The project to export, or a 400 (bad id) / 401 (no valid session) / 404 (unknown project) response. */
export async function loadExportProject(id: string): Promise<{ project: Project } | { error: NextResponse }> {
  if (!isValidProjectId(id)) return { error: NextResponse.json({ error: 'invalid project id' }, { status: 400 }) };
  let storage: Storage;
  try {
    storage = await getStorage();
  } catch (err) {
    if (err instanceof UnauthorizedError) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    throw err;
  }
  const project = await storage.projects.load(id);
  if (!project) return { error: NextResponse.json({ error: 'project not found' }, { status: 404 }) };
  return { project };
}

/**
 * The project and its drawing, or an error response: a kitchen's plan (items
 * labelled with catalog names), or a closet's front elevation.
 */
export async function loadDrawing(id: string): Promise<{ project: Project; svg: string } | { error: NextResponse }> {
  const loaded = await loadExportProject(id);
  if ('error' in loaded) return loaded;
  const { project } = loaded;
  if (projectKind(project) === 'closet') return { project, svg: closetToSvg(project) };
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

/** A download name for the elevations, e.g. "our-kitchen-elevations.svg". */
export function elevationsFileName(project: Project, ext: string): string {
  return exportFileName(project.name, ext, 'kitchen').replace(new RegExp(`\\.${ext}$`), `-elevations.${ext}`);
}

/** A download name for the spec sheet, e.g. "our-kitchen-spec-sheet.pdf". */
export function specSheetFileName(project: Project): string {
  return exportFileName(project.name, 'pdf', projectKind(project) === 'closet' ? 'closet' : 'kitchen').replace(/\.pdf$/, '-spec-sheet.pdf');
}

/** The kitchen and its wall elevations as SVG, or an error response (400, or 404 with the reason). */
export async function loadElevations(id: string): Promise<{ project: Project; svg: string } | { error: NextResponse }> {
  const loaded = await loadExportProject(id);
  if ('error' in loaded) return loaded;
  const { project } = loaded;
  if (projectKind(project) === 'closet') {
    return { error: NextResponse.json({ error: 'closets have a front elevation, not wall elevations' }, { status: 404 }) };
  }
  const catalog = loadCatalog();
  if (wallElevations(project, catalog).length === 0) {
    return { error: NextResponse.json({ error: 'nothing is against a wall yet' }, { status: 404 }) };
  }
  return { project, svg: elevationsToSvg(project, catalog) };
}
