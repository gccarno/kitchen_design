/** Test-only: an in-memory stand-in for a GCS bucket, with GCS's 404 errors. */
import type { BucketLike } from './gcs-blobs';

const notFound = () => Object.assign(new Error('No such object'), { code: 404 });

export function createFakeBucket(): BucketLike & { objects: Map<string, { bytes: Buffer; contentType: string }> } {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  return {
    objects,
    file(name: string) {
      return {
        async save(data: Buffer, opts: { contentType: string }) {
          objects.set(name, { bytes: Buffer.from(data), contentType: opts.contentType });
        },
        async download(): Promise<[Buffer]> {
          const o = objects.get(name);
          if (!o) throw notFound();
          return [Buffer.from(o.bytes)];
        },
        async delete(opts?: { ignoreNotFound?: boolean }) {
          if (!objects.delete(name) && !opts?.ignoreNotFound) throw notFound();
        },
        async copy(dest: string) {
          const o = objects.get(name);
          if (!o) throw notFound();
          objects.set(dest, { ...o });
        },
      };
    },
    async deleteFiles(opts: { prefix: string }) {
      for (const key of [...objects.keys()]) if (key.startsWith(opts.prefix)) objects.delete(key);
    },
  };
}
