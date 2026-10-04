import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
import ProjectList from './ProjectList';
import { ProjectSchema } from '@/lib/plan/schemas';
import type { ProjectSummary } from '@/lib/storage/projects';

const base = ProjectSchema.parse({
  id: 'x',
  name: 'x',
  units: 'mm',
  createdAt: 'x',
  updatedAt: 'x',
  revision: 0,
  photos: [],
  room: {
    polygon: [
      [0, 0],
      [3000, 0],
      [3000, 4000],
      [0, 4000],
    ],
    walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
    openings: [],
  },
  items: [{ id: 'i', catalogId: 'dishwasher-600', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 1250, y: 290 }, rotationDeg: 0 }],
  history: [],
});
const A = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const B = '4a3b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6c';
const summary = (id: string, name: string, revision: number): ProjectSummary => ({
  id,
  name,
  revision,
  updatedAt: '2026-09-30T23:30:00.000Z',
  room: base.room,
  items: base.items,
});
const projects = [summary(A, 'Our kitchen', 3), summary(B, 'Cabin', 0)];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('ProjectList', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    refresh.mockClear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows a card per project: thumbnail, name, revision, and the UTC date, linking to the project', () => {
    render(<ProjectList projects={projects} />);
    const link = screen.getByRole('link', { name: /Our kitchen/ });
    expect(link.getAttribute('href')).toBe(`/project/${A}`);
    expect(link.textContent).toContain('revision 3 · 2026-09-30');
    expect(within(link).getByRole('img', { name: 'Plan of Our kitchen' })).not.toBeNull();
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('shows a closet as its elevation, with a Closet badge', () => {
    const closet = {
      widthMm: 1830,
      heightMm: 2440,
      depthMm: 610,
      opening: { style: 'bifold' as const, leftMm: 0, widthMm: 1830 },
      components: [{ id: 'r', kind: 'rod' as const, xMm: 0, widthMm: 900, yMm: 1727 }],
    };
    render(<ProjectList projects={[{ ...summary(A, 'Hall', 1), kind: 'closet', closet }]} />);
    const link = screen.getByRole('link', { name: /Hall/ });
    expect(within(link).getByRole('img', { name: 'Elevation of Hall' })).not.toBeNull();
    expect(within(link).getByText('Closet')).not.toBeNull();
  });

  it('renames through a revision against the listed revision, then refreshes', async () => {
    fetchMock.mockResolvedValueOnce(json({ project: { ...base, name: 'Home' } }));
    render(<ProjectList projects={projects} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Our kitchen' }));
    const input = screen.getByLabelText('New name for Our kitchen') as HTMLInputElement;
    expect(input.value).toBe('Our kitchen');
    fireEvent.change(input, { target: { value: '  Home  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${A}/revisions`);
    expect(JSON.parse(init.body as string)).toEqual({
      baseRevision: 3,
      patch: [{ op: 'replace', path: '/name', value: 'Home' }],
      summary: 'Rename to Home',
      source: 'user',
    });
    expect(screen.queryByLabelText('New name for Our kitchen')).toBeNull();
  });

  it('does nothing when the name is unchanged or Cancel is pressed', () => {
    render(<ProjectList projects={projects} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Cabin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByLabelText('New name for Cabin')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rename Cabin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('explains a failed or stale rename', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'stale', currentRevision: 4 }, 409));
    render(<ProjectList projects={projects} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Our kitchen' }));
    fireEvent.change(screen.getByLabelText('New name for Our kitchen'), { target: { value: 'Home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain('changed in another tab');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('asks before deleting, and only then deletes and refreshes', async () => {
    fetchMock.mockResolvedValueOnce(json({ deleted: true }));
    render(<ProjectList projects={projects} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Cabin' }));
    expect(fetchMock).not.toHaveBeenCalled();
    screen.getByText(/Delete “Cabin” and its photos for good\?/);

    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByText(/for good/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Cabin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${B}`, { method: 'DELETE' });
  });

  it('shows why a delete failed, and treats an already-deleted project as done', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'disk on fire' }, 500)).mockResolvedValueOnce(json({ error: 'project not found' }, 404));
    render(<ProjectList projects={projects} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Cabin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect((await screen.findByRole('alert')).textContent).toContain('disk on fire');
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
