import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, loadProject, saveProject } from '@/lib/storage/projects';
import { GET } from './route';

const get = (id: string) => GET(new Request(`http://localhost/api/export/${id}/csv`), { params: Promise.resolve({ id }) });

describe('GET /api/export/[id]/csv', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-csv-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('returns the estimate as a CSV download, using the project prices', async () => {
    const p = createProject(dataDir, { name: 'Our Kitchen!' });
    saveProject(dataDir, {
      ...loadProject(dataDir, p.id),
      items: [{ id: 'dw', catalogId: 'dishwasher-600', tag: 'dishwasher', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 1250, y: 290 }, rotationDeg: 0 }],
      pricing: { currency: 'USD', unitPrices: { 'dishwasher-600': 800 }, installPct: 0 },
    });
    const res = await get(p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="our-kitchen.csv"');
    const rows = (await res.text()).split('\r\n');
    expect(rows.slice(0, 3)).toEqual(['# Currency: USD', 'Item,Quantity,Unit,Unit price,Total', 'Dishwasher (600 mm),1,each,800.00,800.00']);
    // 600 × 605 mm of counter on the dishwasher = 0.36 m² at 350.
    expect(rows[3]).toBe('Countertop,0.36,m²,350.00,126.00');
    expect(rows).toContain('Total,,,,926.00');
  });

  it('exports a closet, named "estimate" when the name has no letters', async () => {
    const p = createProject(dataDir, { name: '***', kind: 'closet' });
    const res = await get(p.id);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="estimate.csv"');
    expect(await res.text()).toContain('Total,,,,0.00');
  });

  it('404s an unknown project and 400s a bad id', async () => {
    expect((await get('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get('../etc')).status).toBe(400);
  });
});
