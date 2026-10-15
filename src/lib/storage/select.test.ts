// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { closeDb } from '../db/client';
import { FsBlobStore } from './fs-blobs';
import { FsProjectStore } from './fs-projects';
import { GcsBlobStore } from './gcs-blobs';
import { PgProjectStore } from './pg-projects';
import { getStorage, getStorageFor } from './index';

const KEYS = ['DATABASE_URL', 'GCS_BUCKET', 'GCS_PREFIX'] as const;

describe('getStorage() backend selection', () => {
  afterEach(async () => {
    for (const k of KEYS) delete process.env[k];
    await closeDb();
  });

  it('is all disk with nothing configured', async () => {
    const s = await getStorage();
    expect(s.projects).toBeInstanceOf(FsProjectStore);
    expect(s.blobs).toBeInstanceOf(FsBlobStore);
  });

  // With DATABASE_URL set, getStorage() also needs a signed-in user (see index.test.ts);
  // the backend choice itself is getStorageFor's.
  it('uses Postgres when DATABASE_URL is set (connects lazily, so no server is needed here)', async () => {
    process.env.DATABASE_URL = 'postgres://u:p@localhost:1/none';
    const s = await getStorageFor(null);
    expect(s.projects).toBeInstanceOf(PgProjectStore);
    expect(s.blobs).toBeInstanceOf(FsBlobStore);
  });

  it('uses GCS when GCS_BUCKET is set, independently of the database', async () => {
    process.env.GCS_BUCKET = 'some-bucket';
    const s = await getStorage();
    expect(s.projects).toBeInstanceOf(FsProjectStore);
    expect(s.blobs).toBeInstanceOf(GcsBlobStore);
  });
});
