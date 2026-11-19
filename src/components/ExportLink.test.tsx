import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

const native = vi.hoisted(() => ({ isNative: vi.fn(() => false) }));
vi.mock('@/lib/client/native', () => native);
const download = vi.hoisted(() => ({ saveAndShare: vi.fn() }));
vi.mock('@/lib/client/download', () => download);
import ExportLink from './ExportLink';

describe('ExportLink', () => {
  beforeEach(() => {
    native.isNative.mockReturnValue(false);
    download.saveAndShare.mockReset();
  });

  it('is a plain download link in a browser', () => {
    render(<ExportLink online href="/api/export/p/svg?rev=1">SVG</ExportLink>);
    const link = screen.getByRole('link', { name: 'SVG' });
    expect(link.getAttribute('href')).toBe('/api/export/p/svg?rev=1');
    expect(link.hasAttribute('download')).toBe(true);
  });

  it('is a disabled label offline', () => {
    render(<ExportLink online={false} href="/api/export/p/svg">SVG</ExportLink>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('SVG').getAttribute('aria-disabled')).toBe('true');
  });

  it('in the app, saves and shares the file under a name from the link', async () => {
    native.isNative.mockReturnValue(true);
    download.saveAndShare.mockResolvedValue(undefined);
    render(<ExportLink online href="/api/export/p/elevations/png?scale=1">PNG</ExportLink>);
    fireEvent.click(screen.getByRole('link', { name: 'PNG' }));
    expect(download.saveAndShare).toHaveBeenCalledWith('/api/export/p/elevations/png?scale=1', 'elevations-png');
  });

  it('in the app, says why a download failed on the page instead of in a pop-up', async () => {
    native.isNative.mockReturnValue(true);
    download.saveAndShare.mockRejectedValue(new Error('No space left'));
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    render(<ExportLink online href="/api/export/p/pdf">Spec sheet (PDF)</ExportLink>);
    fireEvent.click(screen.getByRole('link', { name: 'Spec sheet (PDF)' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn.t download spec sheet \(pdf\): no space left/i);
    expect(alertSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
