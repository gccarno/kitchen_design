import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BlobStore } from './store';

const SEGMENT = /^[A-Za-z0-9._-]+$/;
const isNotFound = (err: unknown) => (err as NodeJS.ErrnoException)?.code === 'ENOENT';

/**
 * Blobs as files under `root`, at the paths the app has always used
 * (`<DATA_DIR>/projects/<id>/photos/<photo>.jpg`), so existing data needs no move.
 */
export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  /** Every key segment must be a plain name: no "..", no empty segment, no backslash. */
  private path(key: string): string {
    const segments = key.split('/');
    if (segments.some((s) => !SEGMENT.test(s) || s === '.' || s === '..')) {
      throw new Error(`invalid blob key: ${JSON.stringify(key)}`);
    }
    return join(this.root, ...segments);
  }

  async put(key: string, bytes: Buffer, _contentType?: string): Promise<void> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    if (!prefix.endsWith('/')) throw new Error('prefix must end with "/"');
    await rm(this.path(prefix.slice(0, -1)), { recursive: true, force: true });
  }

  async copy(from: string, to: string): Promise<boolean> {
    const src = this.path(from);
    const dest = this.path(to);
    try {
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}
