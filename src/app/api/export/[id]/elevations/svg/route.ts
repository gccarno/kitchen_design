import { elevationsFileName, loadElevations } from '@/lib/export/drawing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/export/[id]/elevations/svg — every kitchen wall with something on it, as front elevations (1:50).
 *   200 image/svg+xml · 400 invalid id · 404 unknown project, closet, or nothing on a wall
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const drawing = await loadElevations((await params).id);
  if ('error' in drawing) return drawing.error;
  return new Response(drawing.svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-disposition': `inline; filename="${elevationsFileName(drawing.project, 'svg')}"`,
      'cache-control': 'no-store',
    },
  });
}
