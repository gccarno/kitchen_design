import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDataDir, projectDir } from '@/lib/storage/projects';
import { normalizeOrientation, readImageDimensions } from '@/lib/exif';
import { ReferenceObjectKind, type ReferenceObjectKind as ReferenceObjectKindType } from '@/lib/plan/schemas';

// Disable any caching on this route.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB per photo

// Built-in reference object sizes (mm). "custom" uses the user-supplied value.
const KNOWN_SIZES_MM: Record<Exclude<ReferenceObjectKind, 'custom'>, number> = {
  credit_card: 85.6, // long edge of a CR-80 (ISO/IEC 7810 ID-1)
  a4_paper: 297, // long edge of A4
  us_letter: 279.4, // long edge of US Letter (11")
  tape_measure: 50, // typical tape measure width — not a length, but the
  // user's drawn pixel box width is used to derive length, so we treat
  // the 50mm housing width as the known side
  coin_us_quarter: 24.26, // diameter
};

interface UploadResult {
  photo: {
    id: string;
    path: string; // relative to project dir, e.g. "photos/abc.jpg"
    width: number;
    height: number;
  };
}

/**
 * POST /api/upload
 *
 * multipart/form-data fields:
 *   - projectId: string
 *   - file: the image (jpeg/png/heic)
 *   - referenceKind?: 'credit_card' | 'a4_paper' | ... | 'custom'
 *   - referenceCustomSizeMm?: string (number, mm)
 *   - wallHint?: 'north' | 'east' | 'south' | 'west' | 'unknown'
 *
 * Saves the photo (EXIF orientation applied) into the project's
 * photos/ directory and returns the photo metadata. The reference
 * object details are stored later via a separate "setReference" call
 * once the user has drawn the box.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: 'expected multipart/form-data' },
      { status: 400 }
    );
  }

  const projectId = formData.get('projectId');
  const file = formData.get('file');
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_BYTES / 1024 / 1024}MB)` },
      { status: 413 }
    );
  }

  // Validate reference kind (if provided) and capture custom size.
  const refKindRaw = formData.get('referenceKind');
  const refCustomRaw = formData.get('referenceCustomSizeMm');
  let referenceKind: ReferenceObjectKind | null = null;
  let referenceKnownSizeMm: number | null = null;
  if (typeof refKindRaw === 'string' && refKindRaw.length > 0) {
    const parsed = ReferenceObjectKind.safeParse(refKindRaw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid referenceKind' }, { status: 400 });
    }
    referenceKind = parsed.data as ReferenceObjectKindType;
    if (referenceKind === 'custom') {
      const custom = Number(refCustomRaw);
      if (!Number.isFinite(custom) || custom <= 0) {
        return NextResponse.json(
          { error: 'referenceCustomSizeMm must be a positive number' },
          { status: 400 }
        );
      }
      referenceKnownSizeMm = custom;
    } else {
      // TS has narrowed referenceKind to the known set; KNOWN_SIZES_MM is keyed
      // by the same set, so this is exhaustive.
      referenceKnownSizeMm = KNOWN_SIZES_MM[referenceKind];
    }
  }

  const dataDir = resolveDataDir();
  const dir = projectDir(dataDir, projectId);
  const photosDir = join(dir, 'photos');
  await mkdir(photosDir, { recursive: true });

  const photoId = randomUUID();
  const ext = guessExtension(file);
  const filename = `${photoId}.${ext}`;
  const outPath = join(photosDir, filename);

  // Read the uploaded bytes, normalize EXIF orientation, write.
  const arrayBuf = await file.arrayBuffer();
  const input = Buffer.from(arrayBuf);
  const normalized = await normalizeOrientation(input);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(outPath, normalized);

  const dims = await readImageDimensions(normalized);

  // Silently record reference metadata on the side so the next task can
  // surface it via a dedicated endpoint. We don't mutate the project
  // document here — that's a separate, audited write.
  if (referenceKind && referenceKnownSizeMm != null) {
    const { writeFile: writeFileAsync } = await import('node:fs/promises');
    await writeFileAsync(
      join(photosDir, `${photoId}.ref.json`),
      JSON.stringify(
        { kind: referenceKind, knownSizeMm: referenceKnownSizeMm },
        null,
        2
      )
    );
  }

  const result: UploadResult = {
    photo: {
      id: photoId,
      path: `photos/${filename}`,
      width: dims.width,
      height: dims.height,
    },
  };
  return NextResponse.json(result, { status: 201 });
}

function guessExtension(file: Blob): string {
  const t = file.type.toLowerCase();
  if (t === 'image/png') return 'jpg'; // we re-encode everything as jpeg
  if (t === 'image/webp') return 'jpg';
  return 'jpg';
}
