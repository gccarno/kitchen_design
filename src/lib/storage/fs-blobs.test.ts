// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeBlobStore } from './contract';
import { FsBlobStore } from './fs-blobs';

describeBlobStore('disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kd-fs-blobs-'));
  return { store: new FsBlobStore(dir), teardown: async () => rmSync(dir, { recursive: true, force: true }) };
});

describe('FsBlobStore on disk', () => {
  it('keeps the existing layout: <root>/projects/<id>/photos/<photo>.jpg', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-fs-blobs-'));
    try {
      await new FsBlobStore(dir).put('projects/p1/photos/a.jpg', Buffer.from('x'), 'image/jpeg');
      expect(existsSync(join(dir, 'projects', 'p1', 'photos', 'a.jpg'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects keys that could leave the root', async () => {
    const store = new FsBlobStore(mkdtempSync(join(tmpdir(), 'kd-fs-blobs-')));
    for (const key of ['../x.jpg', 'projects/../../x.jpg', '/etc/passwd', 'projects\\x.jpg', 'projects//x.jpg']) {
      await expect(store.get(key)).rejects.toThrow('invalid blob key');
    }
  });
});
