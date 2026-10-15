// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { UnauthorizedError } from './session';
import { getPageStorage } from './page';

const state = vi.hoisted(() => ({ result: undefined as unknown }));
vi.mock('../storage', () => ({
  getStorage: async () => {
    if (state.result instanceof Error) throw state.result;
    return state.result;
  },
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

afterEach(() => {
  state.result = undefined;
});

describe('getPageStorage', () => {
  it('returns the storage', async () => {
    state.result = { projects: 'p', blobs: 'b' };
    expect(await getPageStorage()).toEqual({ projects: 'p', blobs: 'b' });
  });

  it('redirects to /login on UnauthorizedError', async () => {
    state.result = new UnauthorizedError();
    await expect(getPageStorage()).rejects.toThrow('REDIRECT /login');
  });

  it('rethrows anything else', async () => {
    state.result = new Error('db down');
    await expect(getPageStorage()).rejects.toThrow('db down');
  });
});
