// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writeFile = vi.fn();
const share = vi.fn();
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile }, Directory: { Cache: 'CACHE' } }));
vi.mock('@capacitor/share', () => ({ Share: { share } }));

import { saveAndShare } from './download';
import { isNative } from './native';

const setNative = (v: boolean) => {
  (window as unknown as { Capacitor?: unknown }).Capacitor = v ? { isNativePlatform: () => true } : undefined;
};
const respond = (init: { ok?: boolean; status?: number; type?: string; body?: string; cd?: string }) =>
  vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers({ ...(init.type ? { 'content-type': init.type } : {}), ...(init.cd ? { 'content-disposition': init.cd } : {}) }),
    arrayBuffer: async () => new TextEncoder().encode(init.body ?? 'abc').buffer,
  }));

describe('native download', () => {
  beforeEach(() => {
    writeFile.mockReset().mockResolvedValue({ uri: 'file:///cache/x.csv' });
    share.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    setNative(false);
    vi.unstubAllGlobals();
  });

  it('is a no-op on the web', async () => {
    const f = respond({ type: 'text/csv' });
    vi.stubGlobal('fetch', f);
    expect(isNative()).toBe(false);
    expect(await saveAndShare('/api/x', 'x.csv')).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects an HTML response', async () => {
    setNative(true);
    vi.stubGlobal('fetch', respond({ type: 'text/html; charset=utf-8' }));
    await expect(saveAndShare('/api/x', 'x.csv')).rejects.toThrow(/did not return a file/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects a JSON body and an unlisted type', async () => {
    setNative(true);
    vi.stubGlobal('fetch', respond({ type: 'application/json' }));
    await expect(saveAndShare('/api/x', 'x.csv')).rejects.toThrow(/did not return a file/);
  });

  it('strips leading dots from the filename', async () => {
    setNative(true);
    vi.stubGlobal('fetch', respond({ type: 'application/pdf', cd: 'attachment; filename=".."' }));
    await saveAndShare('/api/x', 'f.pdf');
    expect(writeFile.mock.calls[0][0].path).toBe('download');
  });

  it('rejects an error status', async () => {
    setNative(true);
    vi.stubGlobal('fetch', respond({ ok: false, status: 401, type: 'application/json' }));
    await expect(saveAndShare('/api/x', 'x.csv')).rejects.toThrow(/401/);
  });

  it('writes the bytes and shares the written URI', async () => {
    setNative(true);
    vi.stubGlobal('fetch', respond({ type: 'text/csv', body: 'abc', cd: 'attachment; filename="estimate.csv"' }));
    expect(await saveAndShare('/api/x', 'fallback.csv')).toBe(true);
    expect(writeFile).toHaveBeenCalledWith({ path: 'estimate.csv', data: btoa('abc'), directory: 'CACHE' });
    expect(share).toHaveBeenCalledWith({ title: 'estimate.csv', url: 'file:///cache/x.csv' });
  });
});
