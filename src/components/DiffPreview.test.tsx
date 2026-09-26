import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import DiffPreview, { type Proposal } from './DiffPreview';
import { planToJsonPatch } from '@/lib/plan/diff';
import { ProjectSchema, type Project, type Room } from '@/lib/plan/schemas';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

const current: Project = ProjectSchema.parse({
  id: ID,
  name: 'Kitchen',
  units: 'mm',
  createdAt: 'x',
  updatedAt: 'x',
  revision: 2,
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

const newRoom: Room = {
  polygon: [
    [0, 0],
    [3600, 0],
    [3600, 2700],
    [0, 2700],
  ],
  walls: ['n1', 'n2', 'n3', 'n4'].map((id) => ({ id, thicknessMm: 120 })),
  openings: [{ id: 'o', wallId: 'n1', kind: 'door', positionMm: 100, widthMm: 900, heightMm: 2100 }],
};

function llmProposal(extra: Partial<Proposal> = {}): Proposal {
  return {
    patch: planToJsonPatch(current, { ...current, room: newRoom }),
    baseRevision: 2,
    summary: 'Room from photos',
    source: 'llm',
    confidence: 0.72,
    notes: 'Left corner hidden by the fridge.',
    warnings: ['Your measurements disagree by 8%.'],
    ...extra,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(proposal: Proposal = llmProposal()) {
  const onApplied = vi.fn();
  const onDiscard = vi.fn();
  render(<DiffPreview projectId={ID} current={current} proposal={proposal} onApplied={onApplied} onDiscard={onDiscard} />);
  return { onApplied, onDiscard };
}

describe('DiffPreview', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws the current and proposed plans side by side', () => {
    setup();
    expect(screen.getByRole('img', { name: /current plan/i })).not.toBeNull();
    expect(screen.getByRole('img', { name: /proposed plan/i })).not.toBeNull();
  });

  it('draws both plans at the same scale (shared viewBox)', () => {
    setup();
    const a = screen.getByRole('img', { name: /current plan/i }).getAttribute('viewBox');
    const b = screen.getByRole('img', { name: /proposed plan/i }).getAttribute('viewBox');
    expect(a).toBe(b);
  });

  it('lists the changes in words', () => {
    setup();
    expect(screen.getByText(/Room outline: 3000 × 4000 mm.*→ 3600 × 2700 mm/)).not.toBeNull();
    expect(screen.getByText(/All walls replaced: 4 walls/)).not.toBeNull();
    expect(screen.getByText(/Door on wall 1 \(900 mm wide\)/)).not.toBeNull();
  });

  it('shows the model confidence, notes, and warnings for LLM proposals', () => {
    setup();
    expect(screen.getByText(/72%/)).not.toBeNull();
    expect(screen.getByText('Left corner hidden by the fridge.')).not.toBeNull();
    expect(screen.getByText('Your measurements disagree by 8%.')).not.toBeNull();
  });

  it('flags low confidence', () => {
    setup(llmProposal({ confidence: 0.35 }));
    expect(screen.getByText(/low confidence/i)).not.toBeNull();
  });

  it('does not show a confidence for the user’s own edits', () => {
    setup(llmProposal({ source: 'user', confidence: undefined, notes: undefined, warnings: [] }));
    expect(screen.queryByText(/confidence/i)).toBeNull();
  });

  it('applies by posting the patch to the revisions endpoint', async () => {
    const saved = { ...current, room: newRoom, revision: 3 };
    fetchMock.mockResolvedValueOnce(json({ project: saved }));
    const { onApplied } = setup();
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(saved));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${ID}/revisions`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      baseRevision: 2,
      patch: llmProposal().patch,
      summary: 'Room from photos',
      source: 'llm',
    });
  });

  it('sends only one request when Apply is double-clicked', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    setup();
    const apply = screen.getByRole('button', { name: /apply/i });
    fireEvent.click(apply);
    fireEvent.click(apply);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(json({ project: current }));
    await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false));
  });

  it('explains a stale proposal (409) and blocks re-applying it', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'plan changed', currentRevision: 3 }, 409));
    const { onApplied } = setup();
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(await screen.findByText(/plan changed since this was proposed/i)).not.toBeNull();
    expect((screen.getByRole('button', { name: /apply/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when an edit is rejected', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'edit would leave the plan invalid: item outside' }, 400));
    setup();
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(await screen.findByText(/item outside/)).not.toBeNull();
  });

  it('refuses a patch that does not apply to the current plan', () => {
    setup(llmProposal({ patch: [{ op: 'remove', path: '/items/5' }] }));
    expect(screen.getByText(/can’t be applied/i)).not.toBeNull();
    expect((screen.getByRole('button', { name: /apply/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when a proposal changes nothing', () => {
    setup(llmProposal({ patch: [] }));
    expect(screen.getByText(/no changes/i)).not.toBeNull();
  });

  it('discards without calling the server', () => {
    const { onDiscard } = setup();
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
