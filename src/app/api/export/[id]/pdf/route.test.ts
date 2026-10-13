import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, loadProject } from '@/lib/storage/projects';
import { specSheetFileName } from '@/lib/export/drawing';
import { GET } from './route';

const get = (id: string) => GET(new Request(`http://localhost/api/export/${id}/pdf`), { params: Promise.resolve({ id }) });

describe('GET /api/export/[id]/pdf', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-pdf-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('downloads the spec sheet as a PDF', async () => {
    const p = createProject(dataDir, { name: 'Our Kitchen!' });
    const res = await get(p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="our-kitchen-spec-sheet.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('names the download after the kind when the name slugifies to nothing', () => {
    expect(specSheetFileName(loadProject(dataDir, createProject(dataDir, { name: '***' }).id))).toBe('kitchen-spec-sheet.pdf');
    expect(specSheetFileName(loadProject(dataDir, createProject(dataDir, { name: '***', kind: 'closet' }).id))).toBe('closet-spec-sheet.pdf');
  });

  it('400s a bad id and 404s an unknown project', async () => {
    expect((await get('../etc')).status).toBe(400);
    expect((await get('00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});
