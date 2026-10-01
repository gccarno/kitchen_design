import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, loadProject, saveProject } from '@/lib/storage/projects';
import { exportFileName } from '@/lib/plan/svg';
import { GET } from './route';

const get = (id: string) => GET(new Request(`http://localhost/api/export/${id}/svg`), { params: Promise.resolve({ id }) });

describe('GET /api/export/[id]/svg', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-svg-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('returns the plan as SVG, labelling items with catalog names', async () => {
    const p = createProject(dataDir, { name: 'Our Kitchen!' });
    saveProject(dataDir, {
      ...loadProject(dataDir, p.id),
      items: [{ id: 'dw', catalogId: 'dishwasher-600', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 1250, y: 290 }, rotationDeg: 0 }],
    });
    const res = await get(p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="our-kitchen.svg"');
    const body = await res.text();
    expect(body).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(body).toContain('>Dishwasher (600 mm)</text>');
  });

  it('404s an unknown project and 400s a bad id', async () => {
    expect((await get('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get('../etc')).status).toBe(400);
  });

  it('makes safe file names', () => {
    expect(exportFileName('Mum & Dad’s "kitchen" / v2', 'svg')).toBe('mum-dads-kitchen-v2.svg');
    expect(exportFileName('***', 'png')).toBe('kitchen-plan.png');
  });
});
