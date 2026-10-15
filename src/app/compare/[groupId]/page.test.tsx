import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { createProject } from '@/lib/storage/projects';
import { duplicateAsOption, fsStorage } from '@/lib/storage';
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

  it('renders a group, showing every option', async () => {
    const original = createProject(dataDir, { name: 'Kitchen' });
    const b = (await duplicateAsOption(fsStorage(dataDir), original.id))!;
    render(await page(original.id));
    expect(screen.getAllByText(original.name).length).toBeGreaterThan(0);
    expect(screen.getAllByText(b.name).length).toBeGreaterThan(0);
  });

  it('is not found for an invalid or unknown group id', async () => {
    const notFound = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };
    await expect(page('../etc')).rejects.toMatchObject(notFound);
    await expect(page('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject(notFound);
  });
});
