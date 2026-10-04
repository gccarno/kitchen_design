import { drawingFileName, loadDrawing } from '@/lib/export/drawing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/export/[id]/svg — the current plan as a dimensioned SVG drawing
 * (1:50), items labelled with catalog names.
 *   200 image/svg+xml · 400 invalid id · 404 unknown project
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const drawing = loadDrawing((await params).id);
  if ('error' in drawing) return drawing.error;
  return new Response(drawing.svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-disposition': `inline; filename="${drawingFileName(drawing.project, 'svg')}"`,
      'cache-control': 'no-store',
    },
  });
}
