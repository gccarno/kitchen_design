import { loadCatalog } from '@/lib/catalog/loader';
import { loadExportProject, specSheetFileName } from '@/lib/export/drawing';
import { buildSpecSheet } from '@/lib/export/spec-sheet';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/export/[id]/pdf — the spec sheet: plan (or closet front), wall
 * elevations, parts list and estimate, layout check, as one PDF.
 *   200 application/pdf · 400 invalid id · 404 unknown project
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const loaded = await loadExportProject((await params).id);
  if ('error' in loaded) return loaded.error;
  const pdf = await buildSpecSheet(loaded.project, loadCatalog());
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${specSheetFileName(loaded.project)}"`,
      'cache-control': 'no-store',
    },
  });
}
