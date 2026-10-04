import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import HistoryControls from './HistoryControls';
import { commitRevision } from '@/lib/plan/diff';
import { undoRedo } from '@/lib/plan/history';
import { ProjectSchema, type Project } from '@/lib/plan/schemas';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const at = '2026-01-01T00:00:00.000Z';
const blank: Project = ProjectSchema.parse({
  id: ID,
  name: 'Start',
  units: 'mm',
  createdAt: at,
  updatedAt: at,
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
  items: [],
  history: [],
});
const renamed = commitRevision(blank, [{ op: 'replace', path: '/name', value: 'Mine' }], {
  baseRevision: 0,
  source: 'llm',
  summary: 'Rename to Mine',
  at,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('HistoryControls', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('disables both buttons when there is no history', () => {
    render(<HistoryControls project={blank} onSaved={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/History/)).toBeNull();
  });

  it('undoes the last change on the server and hands back the saved project', async () => {
    const undone = undoRedo(renamed, 'undo', 1, at);
    fetchMock.mockResolvedValueOnce(json({ project: undone }));
    const onSaved = vi.fn();
    render(<HistoryControls project={renamed} onSaved={onSaved} />);
    screen.getByText('Last change: Rename to Mine');
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(undone));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${ID}/undo`);
    expect(JSON.parse(init.body as string)).toEqual({ action: 'undo', baseRevision: 1 });
  });

  it('offers redo after an undo, and lists the history newest first', () => {
    const undone = undoRedo(renamed, 'undo', 1, at);
    render(<HistoryControls project={undone} onSaved={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Redo' }).title).toBe('Redo: Rename to Mine (Ctrl+Shift+Z)');
    const items = within(screen.getByRole('list', { name: 'Change history' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('#2 Undo: Rename to Mine'),
      expect.stringContaining('#1 Rename to Mine · suggested'),
    ]);
  });

  it('Ctrl+Z undoes and Ctrl+Shift+Z redoes, but not while typing', async () => {
    // Two renames, the second undone: both undo and redo are available.
    const twice = commitRevision(renamed, [{ op: 'replace', path: '/name', value: 'Ours' }], { baseRevision: 1, source: 'user', summary: 'Rename to Ours', at });
    const both = undoRedo(twice, 'undo', 2, at);
    fetchMock.mockResolvedValue(json({ project: renamed }));
    render(
      <>
        <HistoryControls project={both} onSaved={vi.fn()} />
        <textarea aria-label="chat" />
      </>
    );
    fireEvent.keyDown(screen.getByLabelText('chat'), { key: 'z', ctrlKey: true });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ action: 'redo' });
    // Busy until the save returns; the next shortcut waits for it.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({ action: 'undo' });
  });

  it('sends one request when Ctrl+Z repeats before the save returns', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render(<HistoryControls project={renamed} onSaved={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, repeat: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(json({ project: undoRedo(renamed, 'undo', 1, at) }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows why an undo failed', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'stale', currentRevision: 5 }, 409));
    render(<HistoryControls project={renamed} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect((await screen.findByRole('alert')).textContent).toMatch('the plan changed in another tab — reload the page');
  });
});
