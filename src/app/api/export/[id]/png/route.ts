import { NextResponse } from 'next/server';
import { drawingFileName, loadDrawing, PNG_SCALES, svgToPng, type PngScale } from '@/lib/export/drawing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/export/[id]/png?scale=1|2 — the SVG drawing as a PNG. At 1× one
 * pixel is 5 mm of plan; 2× doubles the resolution.
 *   200 image/png · 400 invalid id or scale · 404 unknown project
 */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const scale = Number(new URL(req.url).searchParams.get('scale') ?? '1');
  if (!PNG_SCALES.includes(scale as PngScale)) {
    return NextResponse.json({ error: `scale must be ${PNG_SCALES.join(' or ')}` }, { status: 400 });
  }
  const drawing = loadDrawing((await params).id);
  if ('error' in drawing) return drawing.error;
  const png = await svgToPng(drawing.svg, scale as PngScale);
  const suffix = scale === 1 ? '' : `@${scale}x`;
  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      'content-disposition': `inline; filename="${drawingFileName(drawing.project, 'png').replace(/\.png$/, `${suffix}.png`)}"`,
      'cache-control': 'no-store',
    },
  });
}
