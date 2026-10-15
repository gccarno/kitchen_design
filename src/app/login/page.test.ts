// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  })
);
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/db/client', () => ({
  getDb: () => {
    throw new Error('db must not be touched when auth is disabled');
  },
}));

import LoginPage from './page';

afterEach(() => vi.unstubAllEnvs());

describe('/login', () => {
  it('redirects to / when auth is disabled, without touching the database', async () => {
    vi.stubEnv('DATABASE_URL', '');
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/');
    expect(redirect).toHaveBeenCalledWith('/');
  });
});
