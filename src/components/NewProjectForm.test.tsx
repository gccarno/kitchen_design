import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { markOffline, markOnline } from '@/lib/client/online';
import { templatesForKind } from '@/lib/templates/info';

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

describe('NewProjectForm templates', () => {
  const created = () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ project: { id: 'p1' } }) });
  const options = () => within(screen.getByLabelText('Start from')).getAllByRole('option').map((o) => o.textContent);

  afterEach(() => vi.unstubAllGlobals());

  it('lists the kitchen templates, then the closet ones after switching kind', () => {
    render(<NewProjectForm />);
    expect(options()).toEqual(['An empty room', ...templatesForKind('kitchen').map((t) => t.name)]);
    fireEvent.click(screen.getByLabelText('Closet'));
    expect(options()).toEqual(['An empty closet', ...templatesForKind('closet').map((t) => t.name)]);
  });

  it('sends the chosen template id and shows its description', async () => {
    const fetchMock = created();
    vi.stubGlobal('fetch', fetchMock);
    render(<NewProjectForm />);
    fireEvent.change(screen.getByLabelText('New project name'), { target: { value: 'Flat' } });
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: 'kitchen-galley' } });
    expect(screen.getByText(/Two facing runs/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create project' })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Flat', kind: 'kitchen', templateId: 'kitchen-galley' });
  });

  it('names the project after the template when no name is typed', async () => {
    const fetchMock = created();
    vi.stubGlobal('fetch', fetchMock);
    render(<NewProjectForm />);
    expect((screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: 'kitchen-u-shape' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create project' })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'U-shaped kitchen', kind: 'kitchen', templateId: 'kitchen-u-shape' });
  });

  it('sends no template for a blank project, and drops the choice when the kind changes', async () => {
    const fetchMock = created();
    vi.stubGlobal('fetch', fetchMock);
    render(<NewProjectForm />);
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: 'kitchen-galley' } });
    fireEvent.click(screen.getByLabelText('Closet'));
    expect((screen.getByLabelText('Start from') as HTMLSelectElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('New project name'), { target: { value: 'Hall' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create project' })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Hall', kind: 'closet' });
  });
});
