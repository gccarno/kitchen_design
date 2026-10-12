import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createProject, loadProject, saveProject } from '@/lib/storage/projects';
import { GET } from './route';

const get = (id: string, scale?: string) =>
  GET(new Request(`http://localhost/api/export/${id}/elevations/png${scale ? `?scale=${scale}` : ''}`), { params: Promise.resolve({ id }) });
const dw = { id: 'dw', catalogId: 'dishwasher-600', tag: 'dishwasher', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 1250, y: 290 }, rotationDeg: 0 };

describe('GET /api/export/[id]/elevations/png', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-elevpng-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('rasterizes the elevations at 1× and 2×', async () => {
    const p = createProject(dataDir, { name: 'Our Kitchen' });
    saveProject(dataDir, { ...loadProject(dataDir, p.id), items: [dw] });
    const one = await get(p.id);
    expect(one.headers.get('content-type')).toBe('image/png');
    expect(one.headers.get('content-disposition')).toBe('inline; filename="our-kitchen-elevations.png"');
    const two = await get(p.id, '2');
    expect(two.headers.get('content-disposition')).toBe('inline; filename="our-kitchen-elevations@2x.png"');
    const [m1, m2] = await Promise.all([sharp(Buffer.from(await one.arrayBuffer())).metadata(), sharp(Buffer.from(await two.arrayBuffer())).metadata()]);
    expect(m2.width).toBeGreaterThan(m1.width! * 1.9);
  });

  it('400s a bad scale and 404s a kitchen with nothing on a wall', async () => {
    const p = createProject(dataDir, { name: 'x' });
    expect((await get(p.id, '3')).status).toBe(400);
    const empty = await get(p.id);
    expect(empty.status).toBe(404);
    expect((await empty.json()).error).toBe('nothing is against a wall yet');
  });

  it('404s a closet with the reason', async () => {
    const c = createProject(dataDir, { name: 'c', kind: 'closet' });
    const res = await get(c.id);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('closets have a front elevation, not wall elevations');
  });
});
