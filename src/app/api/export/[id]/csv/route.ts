import { loadCatalog } from '@/lib/catalog/loader';
import { estimateToCsv } from '@/lib/estimate/csv';
import { buildEstimate } from '@/lib/estimate/estimate';
import { loadExportProject } from '@/lib/export/drawing';
import { exportFileName } from '@/lib/plan/svg';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/export/[id]/csv — the parts list and cost estimate as CSV.
 *   200 text/csv · 400 invalid id · 404 unknown project
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const loaded = await loadExportProject((await params).id);
  if ('error' in loaded) return loaded.error;
  const { project } = loaded;
  return new Response(estimateToCsv(buildEstimate(project, loadCatalog())), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFileName(project.name, 'csv', 'estimate')}"`,
      'cache-control': 'no-store',
    },
  });
}
