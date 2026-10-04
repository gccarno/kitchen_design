import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createProject } from '@/lib/storage/projects';
import { GET } from './route';

const get = (id: string, query = '') =>
  GET(new Request(`http://localhost/api/export/${id}/png${query}`), { params: Promise.resolve({ id }) });

describe('GET /api/export/[id]/png', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-png-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('rasterizes the drawing at 1 px per 5 mm, and twice that at 2×', async () => {
    const p = createProject(dataDir, { name: 'Our kitchen' });
    const one = await get(p.id);
    expect(one.status).toBe(200);
    expect(one.headers.get('content-type')).toBe('image/png');
    expect(one.headers.get('content-disposition')).toBe('inline; filename="our-kitchen.png"');
    const m1 = await sharp(Buffer.from(await one.arrayBuffer())).metadata();
    expect(m1.format).toBe('png');
    // The default 3000 mm wide room plus margins: a bit over 600 px.
    expect(m1.width).toBeGreaterThan(3000 / 5);
    expect(m1.width).toBeLessThan(6000 / 5);
    expect(m1.hasAlpha).toBe(false);

    const two = await get(p.id, '?scale=2');
    expect(two.headers.get('content-disposition')).toBe('inline; filename="our-kitchen@2x.png"');
    const m2 = await sharp(Buffer.from(await two.arrayBuffer())).metadata();
    expect(Math.abs(m2.width! - 2 * m1.width!)).toBeLessThanOrEqual(2);
    expect(Math.abs(m2.height! - 2 * m1.height!)).toBeLessThanOrEqual(2);
  });

  it('rasterizes a closet elevation', async () => {
    const p = createProject(dataDir, { name: 'Hall closet', kind: 'closet' });
    const res = await get(p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('inline; filename="hall-closet.png"');
    const m = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    // 1830 mm wide closet plus margins.
    expect(m.width).toBeGreaterThan(1830 / 5);
  });

  it('rejects other scales, unknown projects, and bad ids', async () => {
    const p = createProject(dataDir, { name: 'P' });
    expect((await get(p.id, '?scale=3')).status).toBe(400);
    expect((await get('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get('../etc')).status).toBe(400);
  });
});
