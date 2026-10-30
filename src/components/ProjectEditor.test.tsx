import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { markOffline, markOnline } from '@/lib/client/online';
import ProjectEditor from './ProjectEditor';

// The Konva canvas needs a real browser; it's covered by the Playwright specs.
// The stub exposes its onEditRoom so tests can drive a direct edit.
type Edit = (change: { room?: Room; items?: PlacedItem[] }, summary: string) => Promise<string | null>;
let onEdit: Edit | undefined;
let canvasProps: { placingItem?: { id: string } | null; onPlacingDone?: () => void; itemLabels?: Record<string, string> } = {};
const editRoom = (room: Room, summary: string) => onEdit!({ room }, summary);
vi.mock('./FloorPlanCanvas', () => ({
  default: (props: { label: string; onEdit?: Edit } & typeof canvasProps) => {
    onEdit = props.onEdit;
    canvasProps = props;
    return <div role="img" aria-label={props.label} />;
  },
}));
const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
import { useEditorStore } from '@/store/editor';
import { ProjectSchema, type PlacedItem, type Project, type Room } from '@/lib/plan/schemas';
import { act } from '@testing-library/react';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const project: Project = ProjectSchema.parse({
  id: ID,
  name: 'Our kitchen',
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
  items: [],
  history: [],
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('ProjectEditor', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    useEditorStore.setState({ project: null, proposal: null });
    push.mockClear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.clear(); // no remembered job from an earlier test
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('duplicates the project as an option and opens the copy', async () => {
    fetchMock.mockResolvedValueOnce(json({ project: { ...project, id: 'copy-id', name: `${project.name} — Option B` } }, 201));
    render(<ProjectEditor initialProject={project} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate as option' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/project/copy-id'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${project.id}/duplicate`);
    expect(init.method).toBe('POST');
  });

  it('disables Duplicate as option while the copy is being made, so a double click makes one copy', () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    render(<ProjectEditor initialProject={project} />);
    const button = screen.getByRole('button', { name: 'Duplicate as option' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says why a duplicate failed and lets you try again', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'project not found' }, 404));
    render(<ProjectEditor initialProject={project} />);
    const button = screen.getByRole('button', { name: 'Duplicate as option' });
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toContain('project not found');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('suggests layouts and opens the comparison of the new options', async () => {
    fetchMock.mockResolvedValueOnce(json({ groupId: project.id, options: [{ id: 'o1', name: 'Our kitchen — Option B', label: 'L-shape', passed: 8, counted: 8 }] }, 201));
    render(<ProjectEditor initialProject={project} />);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest layouts' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/compare/${project.id}`));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${project.id}/propose-layouts`);
    expect(init.method).toBe('POST');
  });

  it('disables Suggest layouts while it works, so a double click makes one set', () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    render(<ProjectEditor initialProject={project} />);
    const button = screen.getByRole('button', { name: 'Suggest layouts' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says why there are no suggestions, and stays on the page', async () => {
    fetchMock.mockResolvedValueOnce(json({ options: [], reason: 'No standard layout fits this room well.' }));
    render(<ProjectEditor initialProject={project} />);
    const button = screen.getByRole('button', { name: 'Suggest layouts' });
    fireEvent.click(button);
    expect(await screen.findByText('No standard layout fits this room well.')).not.toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('says why suggesting failed and lets you try again', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'project not found' }, 404));
    render(<ProjectEditor initialProject={project} />);
    const button = screen.getByRole('button', { name: 'Suggest layouts' });
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toContain('project not found');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('does not offer Suggest layouts offline', () => {
    render(<ProjectEditor initialProject={project} />);
    act(() => markOffline());
    expect((screen.getByRole('button', { name: 'Suggest layouts' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => markOnline());
  });

  it('links to the comparison only when the project has options', () => {
    const { unmount } = render(<ProjectEditor initialProject={project} />);
    expect(screen.queryByRole('link', { name: 'Compare options' })).toBeNull();
    unmount();
    const one = render(<ProjectEditor initialProject={project} groupId="g-1" optionCount={1} />);
    expect(screen.queryByRole('link', { name: 'Compare options' })).toBeNull();
    one.unmount();
    render(<ProjectEditor initialProject={project} groupId="g-1" optionCount={2} />);
    expect(screen.getByRole('link', { name: 'Compare options' }).getAttribute('href')).toBe('/compare/g-1');
  });

  it('shows the project, its current room, and every way to get a room', () => {
    render(<ProjectEditor initialProject={project} />);
    expect(screen.getByRole('heading', { name: 'Our kitchen' })).not.toBeNull();
    expect(screen.getByRole('img', { name: /current room/i })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Photos' })).not.toBeNull();
    expect(screen.getByRole('button', { name: /get room from photos/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /use rectangle/i })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Catalog' })).not.toBeNull();
    expect(screen.getByLabelText(/ask for a change/i)).not.toBeNull();
    expect(screen.getByLabelText(/search catalog/i)).not.toBeNull();
  });

  it('shows a closet project as its elevation, palette and chat — none of the room tools', () => {
    const closet = {
      widthMm: 1830,
      heightMm: 2440,
      depthMm: 610,
      opening: { style: 'bifold' as const, leftMm: 0, widthMm: 1830 },
      components: [],
    };
    render(<ProjectEditor initialProject={{ ...project, name: 'Hall closet', kind: 'closet', closet }} />);
    expect(screen.getByRole('heading', { name: 'Hall closet' })).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Closet elevation' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Closet components' })).not.toBeNull();
    expect(screen.getByLabelText(/ask for a change/i).getAttribute('placeholder')).toMatch(/double hang/);
    expect(screen.queryByRole('heading', { name: 'Photos' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Catalog' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Suggest layouts' })).toBeNull();
    expect(screen.getByRole('link', { name: 'SVG' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Estimate' })).not.toBeNull();
    expect(screen.getByLabelText('Hardware each')).not.toBeNull();
  });

  it('offers the plan as a drawing to download', () => {
    render(<ProjectEditor initialProject={project} />);
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('SVG')).toBe(`/api/export/${ID}/svg?rev=0`);
    expect(href('PNG')).toBe(`/api/export/${ID}/png?scale=1&rev=0`);
    expect(href('PNG (2×)')).toBe(`/api/export/${ID}/png?scale=2&rev=0`);
    expect(href('CSV')).toBe(`/api/export/${ID}/csv?rev=0`);
    expect(screen.getByRole('link', { name: 'SVG' }).hasAttribute('download')).toBe(true);
  });

  it('links to the spec sheet PDF for the current revision', () => {
    render(<ProjectEditor initialProject={project} />);
    expect(screen.getByRole('link', { name: 'Spec sheet (PDF)' }).getAttribute('href')).toBe(`/api/export/${project.id}/pdf?rev=${project.revision}`);
  });

  it('sketch → review → apply updates the page from the saved project', async () => {
    render(<ProjectEditor initialProject={project} />);
    fireEvent.change(screen.getByLabelText(/width/i), { target: { value: '3600' } });
    fireEvent.change(screen.getByLabelText(/depth/i), { target: { value: '2700' } });
    fireEvent.click(screen.getByRole('button', { name: /use rectangle/i }));
    fireEvent.click(screen.getByRole('button', { name: /save room/i }));

    // Nothing is saved yet: the change is up for review.
    expect(fetchMock).not.toHaveBeenCalled();
    const review = screen.getByRole('region', { name: /review proposed change/i });
    expect(within(review).getByText(/3000 × 4000 mm.*→ 3600 × 2700 mm/)).not.toBeNull();

    // The server echoes the saved project.
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({ baseRevision: 0, source: 'user', summary: 'Sketched room' });
      return json({
        project: {
          ...project,
          revision: 1,
          room: {
            ...project.room,
            polygon: [
              [0, 0],
              [3600, 0],
              [3600, 2700],
              [0, 2700],
            ],
          },
        },
      });
    });
    fireEvent.click(within(review).getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(screen.queryByRole('region', { name: /review proposed change/i })).toBeNull());
    expect(screen.getByText(/revision 1/i)).not.toBeNull();
    expect(screen.getByText(/3600 × 2700 mm/)).not.toBeNull();
  });

  it('discarding a proposal leaves the plan unchanged', () => {
    render(<ProjectEditor initialProject={project} />);
    fireEvent.click(screen.getByRole('button', { name: /use rectangle/i }));
    fireEvent.click(screen.getByRole('button', { name: /save room/i }));
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(screen.queryByRole('region', { name: /review proposed change/i })).toBeNull();
    expect(screen.getByText(/revision 0/i)).not.toBeNull();
  });

  it('turns an extraction result into an LLM proposal for review', async () => {
    const withPhoto = { ...project, photos: [{ id: 'ph', path: 'photos/ph.jpg', width: 40, height: 30 }] };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const jobId = '9d0c8b7a-1234-4abc-8def-0123456789ab';
    fetchMock.mockResolvedValueOnce(json({ jobId }, 202)).mockResolvedValueOnce(
      json({
        id: jobId,
        kind: 'extract',
        status: 'done',
        result: {
          patch: [{ op: 'replace', path: '/room/walls/0/thicknessMm', value: 150 }],
          baseRevision: 0,
          confidence: 0.64,
          notes: 'Guessed the hidden corner.',
          warnings: [],
        },
      })
    );
    render(<ProjectEditor initialProject={withPhoto} />);
    fireEvent.click(screen.getByRole('button', { name: /get room from photos/i }));
    await act(() => vi.advanceTimersByTimeAsync(1500));

    const review = await screen.findByRole('region', { name: /review proposed change/i });
    expect(within(review).getByText(/64%/)).not.toBeNull();
    expect(within(review).getByText('Guessed the hidden corner.')).not.toBeNull();
    expect(within(review).getByText(/Wall 1 thickness: 100 → 150 mm/)).not.toBeNull();
  });

  it('saves a canvas edit straight away as a user revision, without a review step', async () => {
    render(<ProjectEditor initialProject={project} />);
    const edited: Room = {
      ...project.room,
      polygon: [
        [0, 0],
        [3500, 0],
        [3000, 4000],
        [0, 4000],
      ],
    };
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toMatchObject({ baseRevision: 0, source: 'user', summary: 'Move corner 2' });
      return json({ project: { ...project, room: edited, revision: 1 } });
    });
    let result: string | null = 'unset';
    await act(async () => {
      result = await editRoom(edited, 'Move corner 2');
    });
    expect(result).toBeNull();
    expect(screen.getByText(/revision 1/i)).not.toBeNull();
    expect(screen.queryByRole('region', { name: /review proposed change/i })).toBeNull();
  });

  it('saves a price change in the estimate straight away as a user revision', async () => {
    const range: PlacedItem = { id: 'r', catalogId: 'range-760', sizeMm: { w: 760, d: 650, h: 900 }, position: { x: 380, y: 325 }, rotationDeg: 0 };
    render(<ProjectEditor initialProject={{ ...project, items: [range] }} />);
    const pricing = { currency: 'USD', unitPrices: { 'range-760': 1200 } };
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toMatchObject({
        baseRevision: 0,
        source: 'user',
        summary: 'Set the price of Range (760 mm / 30") to $1,200.00',
        patch: [{ op: 'add', path: '/pricing', value: pricing }],
      });
      return json({ project: { ...project, items: [range], pricing, revision: 1 } });
    });
    const input = screen.getByLabelText('Unit price: Range (760 mm / 30")');
    fireEvent.change(input, { target: { value: '1200' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/revision 1/i)).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Reset the price of Range (760 mm / 30")' })).not.toBeNull();
  });

  it('reports a rejected canvas edit back to the canvas', async () => {
    render(<ProjectEditor initialProject={project} />);
    fetchMock.mockResolvedValueOnce(json({ error: 'edit would leave the plan invalid' }, 400));
    const moved: Room = { ...project.room, polygon: [[50, 0], ...project.room.polygon.slice(1)] };
    let result: string | null = null;
    await act(async () => {
      result = await editRoom(moved, 'Move corner 1');
    });
    expect(result).toMatch(/invalid/);
    expect(screen.getByText(/revision 0/i)).not.toBeNull();
  });

  it('does not save a canvas edit that changes nothing', async () => {
    render(<ProjectEditor initialProject={project} />);
    let result: string | null = 'unset';
    await act(async () => {
      result = await editRoom(project.room, 'Move corner 1');
    });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('picking a catalog item arms placement on the canvas; picking it again cancels', () => {
    render(<ProjectEditor initialProject={project} />);
    fireEvent.click(screen.getByRole('button', { name: /Dishwasher \(600 mm\)/ }));
    expect(canvasProps.placingItem?.id).toBe('dishwasher-600');
    fireEvent.click(screen.getByRole('button', { name: /Dishwasher \(600 mm\)/ }));
    expect(canvasProps.placingItem).toBeNull();
  });

  it('saves placed items and labels them with catalog names', async () => {
    render(<ProjectEditor initialProject={project} />);
    const placed: PlacedItem = {
      id: 'i1',
      catalogId: 'dishwasher-600',
      sizeMm: { w: 600, d: 580, h: 850 },
      position: { x: 1500, y: 290 },
      rotationDeg: 0,
    };
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.patch.every((op: { path: string }) => op.path.startsWith('/items'))).toBe(true);
      return json({ project: { ...project, items: [placed], revision: 1 } });
    });
    await act(async () => {
      await onEdit!({ items: [placed] }, 'Add Dishwasher (600 mm)');
    });
    expect(canvasProps.itemLabels).toEqual({ i1: 'Dishwasher (600 mm)' });
  });

  it('lists plan warnings under the canvas', () => {
    const blocked: Project = {
      ...project,
      items: [
        {
          id: 'f',
          catalogId: 'fridge-standard-910',
          sizeMm: { w: 910, d: 890, h: 1780 },
          clearanceMm: { front: 1000, sides: 50 },
          position: { x: 1500, y: 445 },
          rotationDeg: 0,
        },
        { id: 'i', catalogId: 'island-1200x900', sizeMm: { w: 1200, d: 900, h: 900 }, position: { x: 1500, y: 1400 }, rotationDeg: 0 },
      ],
    };
    render(<ProjectEditor initialProject={blocked} />);
    expect(within(screen.getByRole('list', { name: /plan warnings/i })).getByText(/"island-1200x900" is in the way/)).not.toBeNull();
  });

  it('turns a chat edit into a proposal for review', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const jobId = '9d0c8b7a-1234-4abc-8def-0123456789ab';
    fetchMock.mockResolvedValueOnce(json({ jobId }, 202)).mockResolvedValueOnce(
      json({
        id: jobId,
        kind: 'refine',
        status: 'done',
        result: {
          commands: [{ type: 'renameProject', name: 'Galley' }],
          patch: [{ op: 'replace', path: '/name', value: 'Galley' }],
          summary: 'Rename the project to Galley',
          reply: 'Renamed.',
          warnings: [],
          baseRevision: 0,
        },
      })
    );
    render(<ProjectEditor initialProject={project} />);
    fireEvent.change(screen.getByLabelText(/ask for a change/i), { target: { value: 'call it Galley' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await act(() => vi.advanceTimersByTimeAsync(1500));

    const review = await screen.findByRole('region', { name: /review proposed change/i });
    expect(within(review).getByText('Rename the project to Galley')).not.toBeNull();
    expect(within(review).getByText(/Rename "Our kitchen" → "Galley"/)).not.toBeNull();
  });

  it('shows wall elevations and their downloads once something is against a wall', () => {
    const { unmount } = render(<ProjectEditor initialProject={project} />);
    expect(screen.getByRole('heading', { name: 'Wall elevations' })).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Elevations as SVG' })).toBeNull();
    unmount();
    useEditorStore.setState({ project: null, proposal: null });
    const dw: PlacedItem = { id: 'dw', catalogId: 'dishwasher-600', tag: 'dishwasher', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 1250, y: 290 }, rotationDeg: 0 };
    render(<ProjectEditor initialProject={{ ...project, items: [dw] }} />);
    expect(screen.getByRole('img', { name: 'Elevation of Wall 1 — north, 3000 mm' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Elevations as SVG' }).getAttribute('href')).toBe(`/api/export/${ID}/elevations/svg?rev=0`);
    expect(screen.getByRole('link', { name: 'Elevations as PNG' }).getAttribute('href')).toBe(`/api/export/${ID}/elevations/png?scale=1&rev=0`);
  });
});

describe('ProjectEditor stale save', () => {
  it('reloads the latest project and shows the message when a save is rejected with 409', async () => {
    useEditorStore.setState({ project: null, proposal: null });
    refresh.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'plan changed' }, 409)));
    render(<ProjectEditor initialProject={project} />);
    let msg: string | null = null;
    await act(async () => {
      msg = await editRoom({ ...project.room, polygon: [[0, 0], [3500, 0], [3500, 4000], [0, 4000]] }, 'Resize');
    });
    expect(msg).toBe('This project changed elsewhere — reloading the latest version; re-apply your change once it loads');
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('ProjectEditor offline', () => {
  afterEach(() => act(() => markOnline()));
  it('disables Duplicate, turns server exports into disabled labels and makes the canvas read-only', () => {
    useEditorStore.setState({ project: null, proposal: null });
    render(<ProjectEditor initialProject={project} />);
    expect(screen.getByRole('link', { name: 'SVG' })).not.toBeNull();
    act(() => markOffline());
    const dup = screen.getByRole('button', { name: 'Duplicate as option' }) as HTMLButtonElement;
    expect(dup.disabled).toBe(true);
    expect(dup.title).toBe('Offline');
    expect(screen.queryByRole('link', { name: 'SVG' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'CSV' })).toBeNull();
    expect(onEdit).toBeUndefined();
  });
});
