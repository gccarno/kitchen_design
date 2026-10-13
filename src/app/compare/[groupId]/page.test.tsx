import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, duplicateAsOption } from '@/lib/storage/projects';
import ComparePage from './page';

const page = (groupId: string) => ComparePage({ params: Promise.resolve({ groupId }) });

describe('/compare/[groupId]', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-compare-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('renders a group', async () => {
    const original = createProject(dataDir, { name: 'Kitchen' });
    duplicateAsOption(dataDir, original.id);
    expect(await page(original.id)).toBeTruthy();
  });

  it('is not found for an invalid or unknown group id', async () => {
    await expect(page('../etc')).rejects.toThrow();
    await expect(page('00000000-0000-4000-8000-000000000000')).rejects.toThrow();
  });
});
