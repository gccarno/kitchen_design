import { NextResponse } from 'next/server';
import { elevationsFileName, loadElevations, PNG_SCALES, svgToPng, type PngScale } from '@/lib/export/drawing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/export/[id]/elevations/png?scale=1|2 — the elevations SVG as a PNG.
 *   200 image/png · 400 invalid id or scale · 404 unknown project, closet, or nothing on a wall
 */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const scale = Number(new URL(req.url).searchParams.get('scale') ?? '1');
  if (!PNG_SCALES.includes(scale as PngScale)) {
    return NextResponse.json({ error: `scale must be ${PNG_SCALES.join(' or ')}` }, { status: 400 });
  }
  const drawing = loadElevations((await params).id);
  if ('error' in drawing) return drawing.error;
  const png = await svgToPng(drawing.svg, scale as PngScale);
  const suffix = scale === 1 ? '' : `@${scale}x`;
  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      'content-disposition': `inline; filename="${elevationsFileName(drawing.project, 'png').replace(/\.png$/, `${suffix}.png`)}"`,
      'cache-control': 'no-store',
    },
  });
}
