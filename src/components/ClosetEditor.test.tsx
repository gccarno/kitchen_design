import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import ClosetEditor from './ClosetEditor';
import { closetFootprint, newCloset, newComponent } from '@/lib/closet/catalog';
import { commitRevision } from '@/lib/plan/diff';
import { ProjectSchema, type Closet, type ClosetComponent, type JsonPatchOp, type Project } from '@/lib/plan/schemas';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

function closetProject(components: ClosetComponent[] = [], over: Partial<Closet> = {}) {
  const closet = { ...newCloset(), ...over, components };
  return ProjectSchema.parse({
    id: ID,
    name: 'Hall closet',
    kind: 'closet',
    units: 'mm',
    createdAt: 'x',
    updatedAt: 'x',
    revision: 0,
    photos: [],
    room: { polygon: closetFootprint(closet), walls: [0, 1, 2, 3].map((i) => ({ id: `w${i}`, thicknessMm: 100 })), openings: [] },
    items: [],
    closet,
    history: [],
  }) as Project & { closet: Closet };
}

/** The default closet's viewBox (−60, −60, 1950, 2560) drawn 1:1 at the page origin: client = elevation + 60. */
function sizeSvg() {
  const svg = screen.getByRole('img', { name: 'Closet elevation' });
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1950, height: 2560, right: 1950, bottom: 2560, x: 0, y: 0, toJSON: () => ({}) });
  return svg;
}
/** Closet mm (x from left, y up from the floor) → client point. */
const at = (x: number, y: number) => ({ clientX: x + 60, clientY: 2440 - y + 60 });

describe('ClosetEditor', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let server: Project;
  let patches: JsonPatchOp[][];
  let onSaved: ReturnType<typeof vi.fn>;

  function setup(project = closetProject()) {
    server = project;
    render(<ClosetEditor project={project} onSaved={onSaved} onProposal={vi.fn()} />);
    return sizeSvg();
  }

  beforeEach(() => {
    patches = [];
    onSaved = vi.fn();
    // A stand-in for the revisions endpoint: commits for real, so bad patches fail like they would.
    fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { patch: JsonPatchOp[]; summary: string; baseRevision: number };
      patches.push(body.patch);
      server = commitRevision(server, body.patch, { baseRevision: body.baseRevision, source: 'user', summary: body.summary });
      return new Response(JSON.stringify({ project: server }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('places the picked component where the closet is tapped', async () => {
    const svg = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Hanging rod' }));
    fireEvent.pointerDown(svg, { pointerId: 1, ...at(450, 1727) });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(server.closet!.components).toEqual([expect.objectContaining({ kind: 'rod', xMm: 0, widthMm: 900, yMm: 1727 })]);
    expect(server.history.at(-1)?.summary).toBe('Add hanging rod');
  });

  it('drags a component, snapping it to the grid', async () => {
    const svg = setup(closetProject([newComponent('drawers', 'd', 0)]));
    const body = svg.querySelector('[data-component="d"]')!;
    fireEvent.pointerDown(body, { pointerId: 1, ...at(300, 400) });
    fireEvent.pointerMove(svg, { pointerId: 1, ...at(905, 400) });
    fireEvent.pointerUp(svg, { pointerId: 1, ...at(905, 400) });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(server.closet!.components[0]).toMatchObject({ xMm: 600, yMm: 0 });
    expect(server.history.at(-1)?.summary).toBe('Move drawer unit');
  });

  it('a tap selects without saving; the details panel edits exact sizes', async () => {
    const svg = setup(closetProject([newComponent('drawers', 'd', 0)]));
    const body = svg.querySelector('[data-component="d"]')!;
    fireEvent.pointerDown(body, { pointerId: 1, ...at(300, 400) });
    fireEvent.pointerUp(svg, { pointerId: 1, ...at(300, 400) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('component-info').textContent).toContain('Drawer unit c1');

    const width = screen.getByLabelText('Width (mm)');
    fireEvent.change(width, { target: { value: '457' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(server.closet!.components[0].widthMm).toBe(457);
  });

  it('removes the selected component', async () => {
    const svg = setup(closetProject([newComponent('shelf', 's', 0)]));
    fireEvent.pointerDown(svg.querySelector('[data-component="s"]')!, { pointerId: 1, ...at(100, 2134) });
    fireEvent.pointerUp(svg, { pointerId: 1, ...at(100, 2134) });
    fireEvent.click(screen.getByRole('button', { name: 'Remove shelf' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(server.closet!.components).toEqual([]);
  });

  it('refuses a size the components don’t fit in, and saves one they do', async () => {
    setup(closetProject([newComponent('shelf', 's', 0, { widthMm: 1830 })]));
    const width = screen.getByLabelText('Inside width (mm)');
    fireEvent.change(width, { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save size and doors' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Can’t do that: Shelf c1 is outside the closet');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(width, { target: { value: '2400' } });
    fireEvent.change(screen.getByLabelText('Doors'), { target: { value: 'sliding' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save size and doors' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // The full-width opening follows the new width.
    expect(server.closet).toMatchObject({ widthMm: 2400, opening: { style: 'sliding', leftMm: 0, widthMm: 2400 } });
    expect(server.room.polygon[1]).toEqual([2400, 0]);
  });

  it('shows closet warnings', () => {
    setup(closetProject([newComponent('rod', 'r', 0, { yMm: 800 })]));
    expect(screen.getByRole('list', { name: 'Closet warnings' }).textContent).toContain('would touch the floor');
  });
});
