import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import CompareOptions from './CompareOptions';
import { loadCatalog } from '@/lib/catalog/loader';
import { newCloset } from '@/lib/closet/catalog';
import { ProjectSchema, type PlacedItem, type Project } from '@/lib/plan/schemas';

const catalog = loadCatalog();
const project = (id: string, name: string, items: PlacedItem[], over: Partial<Project> = {}): Project =>
  ProjectSchema.parse({
    id, name, kind: 'kitchen', units: 'mm', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0, photos: [],
    room: { polygon: [[0, 0], [3000, 0], [3000, 4000], [0, 4000]], walls: ['a', 'b', 'c', 'd'].map((w) => ({ id: w, thicknessMm: 100 })), openings: [] },
    items, history: [], ...over,
  });
const base = (id: string, x: number): PlacedItem => ({ id, catalogId: 'base-600x560x720', tag: 'base', sizeMm: { w: 600, d: 560, h: 720 }, position: { x, y: 330 }, rotationDeg: 0 });
const dishwasher: PlacedItem = { id: 'dw', catalogId: 'dishwasher-600', tag: 'dishwasher', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 2100, y: 340 }, rotationDeg: 0 };

describe('CompareOptions', () => {
  it('shows a column per option in order, linked to its editor, with totals and the layout check', () => {
    const a = project('a', 'Kitchen', [base('b1', 400)]);
    const b = project('b', 'Kitchen — Option B', [base('b1', 400), base('b2', 1000), dishwasher], { optionOf: 'a' });
    render(<CompareOptions projects={[a, b]} catalog={catalog} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Compare options — Kitchen' })).toBeTruthy();
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/project/a', '/project/b']);
    expect(screen.getAllByText(/^Total /)).toHaveLength(2);
    expect(screen.getAllByText(/^Subtotal /)).toHaveLength(2);
    expect(screen.getAllByText(/^Layout check: /)).toHaveLength(2);
    expect(screen.getByText('1 item')).toBeTruthy();
    expect(screen.getByText('3 items')).toBeTruthy();
  });

  it('tabulates the parts that differ, a part missing from one option showing 0', () => {
    const a = project('a', 'Kitchen', [base('b1', 400)]);
    const b = project('b', 'Kitchen — Option B', [base('b1', 400), dishwasher], { optionOf: 'a' });
    render(<CompareOptions projects={[a, b]} catalog={catalog} />);
    const table = screen.getByRole('table', { name: 'What differs' });
    const name = catalog.byId.get('dishwasher-600')!.name;
    const row = within(table).getAllByRole('row').find((r) => r.textContent?.startsWith(name))!;
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['0', '1']);
  });

  it('says so when the options use the same parts', () => {
    const a = project('a', 'Kitchen', [base('b1', 400)]);
    const b = project('b', 'Kitchen — Option B', [base('b1', 1200)], { optionOf: 'a' });
    render(<CompareOptions projects={[a, b]} catalog={catalog} />);
    expect(screen.getByText('These options use the same parts.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows closets by their front, without a layout check', () => {
    const closet = newCloset();
    const a = project('a', 'Hall closet', [], { kind: 'closet', closet });
    const b = project('b', 'Hall closet — Option B', [], { kind: 'closet', closet, optionOf: 'a' });
    render(<CompareOptions projects={[a, b]} catalog={catalog} />);
    expect(screen.getByRole('img', { name: 'Elevation of Hall closet' })).toBeTruthy();
    expect(screen.queryByText(/^Layout check: /)).toBeNull();
  });
});
