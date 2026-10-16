import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import OfflineBanner from './OfflineBanner';
import { markOffline, markOnline } from '@/lib/client/online';

afterEach(() => act(() => markOnline()));

describe('OfflineBanner', () => {
  it('renders nothing while online', () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the status message when offline', () => {
    render(<OfflineBanner />);
    act(() => markOffline());
    expect(screen.getByRole('status').textContent).toBe("You're offline — viewing saved data. Editing is disabled.");
  });
});
