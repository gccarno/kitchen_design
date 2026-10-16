import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { markOffline, markOnline } from '@/lib/client/online';

const cacheUrls = vi.fn();
vi.mock('@/lib/client/offline-cache', () => ({ cacheUrls: (u: string[]) => cacheUrls(u) }));
import KeepOfflineButton from './KeepOfflineButton';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('KeepOfflineButton', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    cacheUrls.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    act(() => markOnline());
    vi.unstubAllGlobals();
  });

  it('caches the page, the document and one URL per photo', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'p1', photos: [{ id: 'a' }, { id: 'b' }] }));
    cacheUrls.mockResolvedValueOnce({ cached: 4, failed: 0 });
    render(<KeepOfflineButton projectId="p1" projectName="Kitchen" />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep Kitchen offline' }));
    await screen.findByText('Saved offline (2 photos)');
    expect(cacheUrls).toHaveBeenCalledWith([
      '/project/p1',
      '/api/projects/p1',
      '/api/projects/p1/photos/a',
      '/api/projects/p1/photos/b',
    ]);
  });

  it('reports failures', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'p1', photos: [{ id: 'a' }] }));
    cacheUrls.mockResolvedValueOnce({ cached: 2, failed: 1 });
    render(<KeepOfflineButton projectId="p1" projectName="Kitchen" />);
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('Some items failed');
  });

  it('still caches the page and document when the document cannot be read, and reports failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('nope'));
    cacheUrls.mockResolvedValueOnce({ cached: 2, failed: 0 });
    render(<KeepOfflineButton projectId="p1" projectName="Kitchen" />);
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('Some items failed');
    expect(cacheUrls).toHaveBeenCalledWith(['/project/p1', '/api/projects/p1']);
  });

  it('is disabled offline', () => {
    render(<KeepOfflineButton projectId="p1" projectName="Kitchen" />);
    act(() => markOffline());
    const b = screen.getByRole('button') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe('Offline');
  });
});
