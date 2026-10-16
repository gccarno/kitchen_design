import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

const clearOfflineCaches = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/client/offline-cache', () => ({ clearOfflineCaches: () => clearOfflineCaches() }));
import SignOutButton from './SignOutButton';

const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  clearOfflineCaches.mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  Object.defineProperty(window, 'location', { value: { assign }, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('SignOutButton', () => {
  it('clears the offline caches, then goes to /login', async () => {
    render(<SignOutButton email="a@x.io" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
    expect(clearOfflineCaches).toHaveBeenCalledTimes(1);
  });

  it('still clears them when the logout request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    render(<SignOutButton email="a@x.io" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
    expect(clearOfflineCaches).toHaveBeenCalledTimes(1);
  });
});
