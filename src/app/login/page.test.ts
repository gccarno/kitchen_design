// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const state = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  })
);
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/auth/session', () => ({ currentUser: async () => state.user }));
vi.mock('@/components/LoginForm', () => ({ default: () => null }));
vi.mock('@/lib/db/client', () => ({
  getDb: () => {
    throw new Error('db must not be touched');
  },
}));

import LoginPage from './page';

beforeEach(() => {
  state.user = null;
  redirect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('/login', () => {
  it('redirects to / when auth is disabled, without touching the database', async () => {
    vi.stubEnv('DATABASE_URL', '');
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/');
    expect(redirect).toHaveBeenCalledWith('/');
  });

  it('redirects to / when auth is enabled and the visitor already has a valid session', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://test');
    state.user = { id: 'u', email: 'a@example.com' };
    await expect(LoginPage({ searchParams: Promise.resolve({ next: '/project/x' }) })).rejects.toThrow('REDIRECT:/');
  });
});
