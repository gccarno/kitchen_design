import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import CatalogSidebar from './CatalogSidebar';
import { loadCatalog } from '@/lib/catalog/loader';

const { items } = loadCatalog();
const list = () => screen.getByRole('list', { name: /catalog items/i });
const names = () => within(list()).queryAllByRole('listitem').map((li) => li.querySelector('[data-name]')?.textContent);

describe('CatalogSidebar', () => {
  it('lists every item with its size in the project units', () => {
    render(<CatalogSidebar items={items} units="mm" />);
    expect(within(list()).getAllByRole('listitem')).toHaveLength(items.length);
    expect(screen.getByText('Dishwasher (600 mm)').closest('li')!.textContent).toMatch(/600 × 580 × 850 mm/);
  });

  it('shows imperial sizes for imperial projects', () => {
    render(<CatalogSidebar items={items} units="in" />);
    expect(screen.getByText('Dishwasher (600 mm)').closest('li')!.textContent).toContain(`1' 11 1/2" × 1' 10 3/4" × 2' 9 1/2"`);
  });

  it('searches as you type', () => {
    render(<CatalogSidebar items={items} units="mm" />);
    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: 'counter-depth' } });
    expect(names()).toEqual(['Refrigerator, counter-depth (910 mm)']);
  });

  it('filters by category, combined with search', () => {
    render(<CatalogSidebar items={items} units="mm" />);
    fireEvent.click(screen.getByRole('button', { name: 'Furniture' }));
    expect(screen.getByRole('button', { name: 'Furniture' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: 'stool' } });
    expect(names()).toEqual(['Stool, counter height (650 mm seat)', 'Stool, bar height (750 mm seat)']);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(names()).toHaveLength(2);
  });

  it('says when nothing matches', () => {
    render(<CatalogSidebar items={items} units="mm" />);
    fireEvent.change(screen.getByLabelText(/search catalog/i), { target: { value: 'hot tub' } });
    expect(screen.getByText(/no items match/i)).not.toBeNull();
  });

  it('is browse-only without onPick', () => {
    render(<CatalogSidebar items={items} units="mm" />);
    expect(within(list()).queryAllByRole('button')).toHaveLength(0);
  });

  it('lets you pick an item and marks the selected one', () => {
    const onPick = vi.fn();
    const { rerender } = render(<CatalogSidebar items={items} units="mm" onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /Dishwasher \(600 mm\)/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'dishwasher-600' }));
    rerender(<CatalogSidebar items={items} units="mm" onPick={onPick} selectedId="dishwasher-600" />);
    expect(screen.getByRole('button', { name: /Dishwasher \(600 mm\)/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
