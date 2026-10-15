import type { BlobStore } from './store';

/** The slice of @google-cloud/storage's Bucket that GcsBlobStore uses (so tests can fake it). */
export interface BucketLike {
  file(name: string): {
    save(data: Buffer, options: { contentType: string; resumable: boolean }): Promise<unknown>;
    download(): Promise<[Buffer]>;
    delete(options: { ignoreNotFound: boolean }): Promise<unknown>;
    copy(destination: string): Promise<unknown>;
  };
  deleteFiles(options: { prefix: string; force: boolean }): Promise<unknown>;
}

const isNotFound = (err: unknown) => (err as { code?: unknown })?.code === 404;

/**
 * Blobs as objects in a private GCS bucket, optionally under a key prefix
 * (e.g. "e2e/" so a test run never touches real photos).
 */
export class GcsBlobStore implements BlobStore {
  constructor(
    private readonly bucket: BucketLike,
    private readonly prefix = ''
  ) {}

  private name(key: string): string {
    return `${this.prefix}${key}`;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    // Photos are a few MB at most: a single-request upload is faster than resumable.
    await this.bucket.file(this.name(key)).save(bytes, { contentType, resumable: false });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const [bytes] = await this.bucket.file(this.name(key)).download();
      return bytes;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.file(this.name(key)).delete({ ignoreNotFound: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    if (!prefix.endsWith('/')) throw new Error('prefix must end with "/"');
    await this.bucket.deleteFiles({ prefix: this.name(prefix), force: true });
  }

  async copy(from: string, to: string): Promise<boolean> {
    try {
      await this.bucket.file(this.name(from)).copy(this.name(to));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}

/** A store on the real bucket. Credentials come from GOOGLE_APPLICATION_CREDENTIALS (ADC). */
export async function gcsBlobStore(bucketName: string, prefix = ''): Promise<GcsBlobStore> {
  const { Storage } = await import('@google-cloud/storage');
  const bucket = new Storage().bucket(bucketName);
  return new GcsBlobStore(bucket as unknown as BucketLike, prefix);
}
