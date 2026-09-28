import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import ProjectEditor from './ProjectEditor';

// The Konva canvas needs a real browser; it's covered by the Playwright specs.
// The stub exposes its onEditRoom so tests can drive a direct edit.
let editRoom: ((room: Room, summary: string) => Promise<string | null>) | undefined;
vi.mock('./FloorPlanCanvas', () => ({
  default: (props: { label: string; onEditRoom?: typeof editRoom }) => {
    editRoom = props.onEditRoom;
    return <div role="img" aria-label={props.label} />;
  },
}));
import { useEditorStore } from '@/store/editor';
import { ProjectSchema, type Project, type Room } from '@/lib/plan/schemas';
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
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the project, its current room, and every way to get a room', () => {
    render(<ProjectEditor initialProject={project} />);
    expect(screen.getByRole('heading', { name: 'Our kitchen' })).not.toBeNull();
    expect(screen.getByRole('img', { name: /current room/i })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Photos' })).not.toBeNull();
    expect(screen.getByRole('button', { name: /get room from photos/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /use rectangle/i })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Catalog' })).not.toBeNull();
    expect(screen.getByLabelText(/search catalog/i)).not.toBeNull();
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
    fetchMock.mockResolvedValueOnce(
      json({
        patch: [{ op: 'replace', path: '/room/walls/0/thicknessMm', value: 150 }],
        baseRevision: 0,
        confidence: 0.64,
        notes: 'Guessed the hidden corner.',
        warnings: [],
      })
    );
    render(<ProjectEditor initialProject={withPhoto} />);
    fireEvent.click(screen.getByRole('button', { name: /get room from photos/i }));

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
      result = await editRoom!(edited, 'Move corner 2');
    });
    expect(result).toBeNull();
    expect(screen.getByText(/revision 1/i)).not.toBeNull();
    expect(screen.queryByRole('region', { name: /review proposed change/i })).toBeNull();
  });

  it('reports a rejected canvas edit back to the canvas', async () => {
    render(<ProjectEditor initialProject={project} />);
    fetchMock.mockResolvedValueOnce(json({ error: 'edit would leave the plan invalid' }, 400));
    let result: string | null = null;
    await act(async () => {
      result = await editRoom!(project.room, 'Move corner 1');
    });
    expect(result).toMatch(/invalid/);
    expect(screen.getByText(/revision 0/i)).not.toBeNull();
  });
});
