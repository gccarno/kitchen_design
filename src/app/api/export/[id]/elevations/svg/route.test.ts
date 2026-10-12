import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, loadProject, saveProject } from '@/lib/storage/projects';
import { GET } from './route';

const get = (id: string) => GET(new Request(`http://localhost/api/export/${id}/elevations/svg`), { params: Promise.resolve({ id }) });
const dw = { id: 'dw', catalogId: 'dishwasher-600', tag: 'dishwasher', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 1250, y: 290 }, rotationDeg: 0 };

describe('GET /api/export/[id]/elevations/svg', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-elev-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('returns the wall elevations as SVG', async () => {
    const p = createProject(dataDir, { name: 'Our Kitchen!' });
    saveProject(dataDir, { ...loadProject(dataDir, p.id), items: [dw] });
    const res = await get(p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="our-kitchen-elevations.svg"');
    expect(await res.text()).toContain('>Dishwasher</text>');
  });

  it('404s a kitchen with nothing on a wall, a closet, and an unknown project; 400s a bad id', async () => {
    const empty = createProject(dataDir, { name: '***' });
    const res = await get(empty.id);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/nothing is against a wall/);
    const closet = createProject(dataDir, { name: 'c', kind: 'closet' });
    expect((await (await get(closet.id)).json()).error).toMatch(/closet/);
    expect((await get('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get('../etc')).status).toBe(400);
  });
});
