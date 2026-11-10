import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import ConfirmScale from './ConfirmScale';
import { commitRevision } from '@/lib/plan/diff';
import { ProjectSchema, type Project } from '@/lib/plan/schemas';
import { wallLengthMm } from '@/lib/plan/validate';

const project = (over: Partial<Project> = {}): Project =>
  ProjectSchema.parse({
    id: 'p',
    name: 'K',
    units: 'mm',
    createdAt: 'x',
    updatedAt: 'x',
    revision: 3,
    photos: [],
    room: {
      polygon: [[0, 0], [3000, 0], [3000, 4000], [0, 4000]],
      walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
      openings: [{ id: 'door', wallId: 'c', kind: 'door', positionMm: 500, widthMm: 900, heightMm: 2100 }],
      sizeEstimated: true,
    },
    items: [],
    history: [],
    ...over,
  });

const pick = (label: RegExp) => fireEvent.change(screen.getByLabelText(/what did you measure/i), { target: { value: screen.getByRole('option', { name: label }).getAttribute('value') } });
const type = (text: string) => fireEvent.change(screen.getByLabelText(/real size/i), { target: { value: text } });
const button = () => screen.getByRole('button', { name: /rescale the room/i }) as HTMLButtonElement;

describe('ConfirmScale', () => {
  it('offers every wall and opening, with the size it has now', () => {
    render(<ConfirmScale project={project()} onProposal={() => {}} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([
      'Wall 1 — north, 3000 mm',
      'Wall 2 — east, 4000 mm',
      'Wall 3 — south, 3000 mm',
      'Wall 4 — west, 4000 mm',
      'Door on wall 3, 900 mm wide',
    ]);
  });

  it('shows how much the room changes, and proposes a rescale that commits to the right size', () => {
    const onProposal = vi.fn();
    const p = project();
    render(<ConfirmScale project={p} onProposal={onProposal} />);
    expect(button().disabled).toBe(true);
    type('3600');
    expect(screen.getByText(/\+20%/)).not.toBeNull();
    fireEvent.click(button());
    const proposal = onProposal.mock.calls[0][0];
    expect(proposal).toMatchObject({ source: 'user', baseRevision: 3, summary: 'Confirm the room size: Wall 1 is 3600 mm' });
    const next = commitRevision(p, proposal.patch, { baseRevision: 3, source: 'user', summary: proposal.summary });
    expect(wallLengthMm(next.room, 0)).toBeCloseTo(3600);
    expect(wallLengthMm(next.room, 1)).toBeCloseTo(4800);
    expect(next.room.sizeEstimated).toBeUndefined();
  });

  it('can scale from a door width', () => {
    const onProposal = vi.fn();
    const p = project();
    render(<ConfirmScale project={p} onProposal={onProposal} />);
    pick(/Door on wall 3/);
    type('810');
    expect(screen.getByText(/−10%/)).not.toBeNull();
    fireEvent.click(button());
    const next = commitRevision(p, onProposal.mock.calls[0][0].patch, { baseRevision: 3, source: 'user', summary: 's' });
    expect(next.room.openings[0].widthMm).toBeCloseTo(810);
    expect(wallLengthMm(next.room, 0)).toBeCloseTo(2700);
  });

  it(`reads feet and inches in an inch project: 12' is 3657.6 mm`, () => {
    const onProposal = vi.fn();
    const p = project({ units: 'in' });
    render(<ConfirmScale project={p} onProposal={onProposal} />);
    expect(screen.getAllByRole('option')[0].textContent).toBe(`Wall 1 — north, 9' 10"`);
    type(`12'`);
    fireEvent.click(button());
    const next = commitRevision(p, onProposal.mock.calls[0][0].patch, { baseRevision: 3, source: 'user', summary: 's' });
    expect(wallLengthMm(next.room, 0)).toBeCloseTo(3657.6);
  });

  it('will not propose anything for a length it cannot read, or one wildly off the current size', () => {
    const onProposal = vi.fn();
    render(<ConfirmScale project={project()} onProposal={onProposal} />);
    type('abc');
    expect(button().disabled).toBe(true);
    expect(screen.getByText(/can’t read that length/i)).not.toBeNull();
    type('30000');
    expect(button().disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/very different/i);
    fireEvent.click(button());
    expect(onProposal).not.toHaveBeenCalled();
  });

  it('moves placed items with the room', () => {
    const onProposal = vi.fn();
    const item = { id: 'i', catalogId: 'fridge-600', sizeMm: { w: 600, d: 650, h: 1850 }, position: { x: 300, y: 400 }, rotationDeg: 0 };
    const p = project({ items: [item] });
    render(<ConfirmScale project={p} onProposal={onProposal} />);
    type('3600');
    fireEvent.click(button());
    const next = commitRevision(p, onProposal.mock.calls[0][0].patch, { baseRevision: 3, source: 'user', summary: 's' });
    expect(next.items[0].position.x).toBeCloseTo(360);
    expect(next.items[0].sizeMm).toEqual(item.sizeMm);
  });
});
