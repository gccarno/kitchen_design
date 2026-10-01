import { NextResponse } from 'next/server';
import { loadCatalog } from '@/lib/catalog/loader';
import { exportFileName, planToSvg } from '@/lib/plan/svg';
import { isValidProjectId, loadProject, projectExists, resolveDataDir } from '@/lib/storage/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/export/[id]/svg — the current plan as a dimensioned SVG drawing
 * (1:50), items labelled with catalog names.
 *   200 image/svg+xml · 400 invalid id · 404 unknown project
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 });
  const dataDir = resolveDataDir();
  if (!projectExists(dataDir, id)) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  const project = loadProject(dataDir, id);
  const catalog = loadCatalog();
  const labels = Object.fromEntries(project.items.map((it) => [it.id, catalog.byId.get(it.catalogId)?.name ?? it.catalogId]));
  return new Response(planToSvg(project, { labels }), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-disposition': `inline; filename="${exportFileName(project.name, 'svg')}"`,
      'cache-control': 'no-store',
    },
  });
}
