import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { markOffline, markOnline } from '@/lib/client/online';
import React from 'react';
import EstimatePanel from './EstimatePanel';
import { ProjectSchema, type Pricing, type Project } from '@/lib/plan/schemas';

const RANGE = 'Range (760 mm / 30")';

function kitchen(over: Partial<Project> = {}): Project {
  return ProjectSchema.parse({
    id: 'p',
    name: 'k',
    units: 'mm',
    createdAt: 'x',
    updatedAt: 'x',
    revision: 3,
    photos: [],
    room: {
      polygon: [
        [0, 0],
        [4000, 0],
        [4000, 3000],
        [0, 3000],
      ],
      walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
      openings: [],
    },
    items: [
      { id: 'r', catalogId: 'range-760', tag: 'range', sizeMm: { w: 760, d: 650, h: 900 }, position: { x: 380, y: 325 }, rotationDeg: 0 },
      { id: 'b', catalogId: 'base-600x560x720', tag: 'base', sizeMm: { w: 600, d: 560, h: 720 }, position: { x: 1060, y: 280 }, rotationDeg: 0 },
    ],
    history: [],
    ...over,
  });
}

function setup(project: Project, result: string | null = null) {
  const onSave = vi.fn<(pricing: Pricing | undefined, summary: string) => Promise<string | null>>().mockResolvedValue(result);
  render(<EstimatePanel project={project} onSave={onSave} />);
  return onSave;
}

function commit(label: string | RegExp, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('EstimatePanel', () => {
  it('lists the parts, the countertop and the totals', () => {
    setup(kitchen());
    const table = screen.getByRole('table', { name: 'Estimate' });
    expect(within(table).getByText(RANGE)).toBeTruthy();
    // 600 × 585 mm of counter on the base.
    expect(within(table).getByText('0.35 m²')).toBeTruthy();
    // 1000 + 270 + 0.35 × 350 = 1392.50; installation 30% = 417.75.
    expect(within(table).getByRole('row', { name: /^Subtotal/ }).textContent).toContain('$1,392.50');
    expect(within(table).getByRole('row', { name: /^Installation \(30%\)/ }).textContent).toContain('$417.75');
    expect(within(table).getByRole('row', { name: /^Total/ }).textContent).toContain('$1,810.25');
    expect(screen.getByText(/Prices are rough estimates/)).toBeTruthy();
  });

  it('saves a changed unit price as an override', async () => {
    const onSave = setup(kitchen());
    commit(`Unit price: ${RANGE}`, '1200');
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ currency: 'USD', unitPrices: { 'range-760': 1200 } }, `Set the price of ${RANGE} to $1,200.00`)
    );
  });

  it('resets an override, going back to no pricing when nothing else is set', async () => {
    const onSave = setup(kitchen({ pricing: { currency: 'USD', unitPrices: { 'range-760': 1200 } } }));
    fireEvent.click(screen.getByRole('button', { name: `Reset the price of ${RANGE}` }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(undefined, `Reset the price of ${RANGE}`));
  });

  it('saves the rates and the currency', async () => {
    const onSave = setup(kitchen({ pricing: { currency: 'USD', unitPrices: { 'range-760': 900 } } }));
    commit('Installation %', '25');
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ currency: 'USD', unitPrices: { 'range-760': 900 }, installPct: 25 }, 'Set installation to 25%'));
    commit('Countertop per m²', '400');
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ countertopPerM2: 400 }), 'Set the countertop price to $400.00 per m²'));
    commit('Currency', 'eur');
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ currency: 'EUR' }), 'Set the currency to EUR'));
  });

  it('does not save a negative price, a percentage over 100, a bad currency, an empty field or the same value', async () => {
    const onSave = setup(kitchen());
    commit(`Unit price: ${RANGE}`, '-5');
    expect(screen.getByRole('alert').textContent).toMatch(/can’t be negative/);
    commit('Tax %', '150');
    expect(screen.getByRole('alert').textContent).toMatch(/0 to 100/);
    commit('Currency', 'EU');
    expect(screen.getByRole('alert').textContent).toMatch(/3-letter/);
    commit(`Unit price: ${RANGE}`, '');
    commit(`Unit price: ${RANGE}`, '1000');
    await new Promise((r) => setTimeout(r, 0));
    expect(onSave).not.toHaveBeenCalled();
    expect((screen.getByLabelText(`Unit price: ${RANGE}`) as HTMLInputElement).value).toBe('1000');
  });

  it('shows the save error', async () => {
    setup(kitchen(), 'could not save (500)');
    commit(`Unit price: ${RANGE}`, '1');
    expect((await screen.findByRole('alert')).textContent).toContain('could not save (500)');
  });

  it('formats in the project currency, and shows ft² in an inch project', () => {
    setup(kitchen({ units: 'in', pricing: { currency: 'EUR', unitPrices: {} } }));
    const table = screen.getByRole('table', { name: 'Estimate' });
    expect(within(table).getByText('3.78 ft²')).toBeTruthy();
    expect(within(table).getByText(/\/ft²/)).toBeTruthy();
    expect(within(table).getByRole('row', { name: /^Total/ }).textContent).toContain('€');
  });

  it('prices a closet with a hardware rate instead of a countertop', () => {
    setup(
      kitchen({
        kind: 'closet',
        items: [],
        closet: {
          widthMm: 1830,
          heightMm: 2440,
          depthMm: 610,
          opening: { style: 'bifold', leftMm: 0, widthMm: 1830 },
          components: [{ id: 'c', kind: 'rod', xMm: 0, widthMm: 1000, yMm: 1700 }],
        },
      })
    );
    expect(screen.getByText('Hanging rod')).toBeTruthy();
    expect(screen.getByLabelText('Hardware each')).toBeTruthy();
    expect(screen.queryByLabelText('Countertop per m²')).toBeNull();
  });

  it('says so when there is nothing to price', () => {
    setup(kitchen({ items: [] }));
    expect(screen.getByText(/Nothing to price yet/)).toBeTruthy();
  });
});

describe('EstimatePanel offline', () => {
  afterEach(() => act(() => markOnline()));
  it('makes price and rate inputs read-only while offline', () => {
    const onSave = setup(kitchen());
    act(() => markOffline());
    const price = screen.getByLabelText(`Unit price: ${RANGE}`) as HTMLInputElement;
    expect(price.disabled).toBe(true);
    expect(price.title).toBe('Offline');
    for (const l of ['Installation %', 'Tax %', 'Currency']) expect((screen.getByLabelText(l) as HTMLInputElement).disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});
