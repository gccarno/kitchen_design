// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { describeBlobStore } from './contract';
import { createFakeBucket } from './fake-bucket';
import { GcsBlobStore } from './gcs-blobs';

describeBlobStore('GCS (fake bucket)', async () => ({ store: new GcsBlobStore(createFakeBucket()) }));
describeBlobStore('GCS (fake bucket, with prefix)', async () => ({ store: new GcsBlobStore(createFakeBucket(), 'test-run/') }));

describe('GcsBlobStore', () => {
  it('stores under the prefix with the given content type', async () => {
    const bucket = createFakeBucket();
    await new GcsBlobStore(bucket, 'e2e/').put('projects/p1/photos/a.jpg', Buffer.from('x'), 'image/jpeg');
    expect(bucket.objects.get('e2e/projects/p1/photos/a.jpg')?.contentType).toBe('image/jpeg');
  });

  it('rethrows errors other than "not found"', async () => {
    const bucket = createFakeBucket();
    bucket.file = () => ({
      save: async () => undefined,
      download: async () => {
        throw Object.assign(new Error('forbidden'), { code: 403 });
      },
      delete: async () => undefined,
      copy: async () => undefined,
    });
    await expect(new GcsBlobStore(bucket).get('projects/p1/photos/a.jpg')).rejects.toThrow('forbidden');
  });
});
