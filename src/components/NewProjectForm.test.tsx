import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { markOffline, markOnline } from '@/lib/client/online';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import NewProjectForm from './NewProjectForm';

describe('NewProjectForm offline', () => {
  afterEach(() => act(() => markOnline()));
  it('disables Create and the sample button while offline', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<NewProjectForm />);
    fireEvent.change(screen.getByLabelText('New project name'), { target: { value: 'Home' } });
    expect((screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement).disabled).toBe(false);
    act(() => markOffline());
    const create = screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement;
    const sample = screen.getByRole('button', { name: /sample kitchen/i }) as HTMLButtonElement;
    for (const b of [create, sample]) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe('Offline');
    }
    fireEvent.submit(create.closest('form')!);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
