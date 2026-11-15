import { describe, it, expect, vi } from 'vitest';
import { STORED_MAX_EDGE_PX } from '@/lib/storage/limits';
import { fitWithin, shrinkPhoto } from './shrink-photo';

const file = (bytes: number) => new File([new Uint8Array(bytes)], 'a.jpg', { type: 'image/jpeg' });

describe('fitWithin', () => {
  it('scales the long edge down to the cap, keeping the shape', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });
  it('never enlarges', () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });
});

describe('shrinkPhoto', () => {
  it('sends the re-encoded photo when it is smaller, capped at the stored size', async () => {
    const small = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
    const encode = vi.fn().mockResolvedValue(small);
    const original = file(100);
    expect(await shrinkPhoto(original, encode)).toBe(small);
    expect(encode).toHaveBeenCalledWith(original, STORED_MAX_EDGE_PX);
  });
  it('keeps the original when the browser cannot decode it', async () => {
    const original = file(100);
    expect(await shrinkPhoto(original, vi.fn().mockRejectedValue(new Error('no HEIC')))).toBe(original);
  });
  it('keeps the original when re-encoding would not make it smaller', async () => {
    const original = file(100);
    expect(await shrinkPhoto(original, vi.fn().mockResolvedValue(new Blob([new Uint8Array(100)])))).toBe(original);
    expect(await shrinkPhoto(original, vi.fn().mockResolvedValue(new Blob([])))).toBe(original);
  });
});
