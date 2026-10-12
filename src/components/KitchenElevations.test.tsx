import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import KitchenElevations from './KitchenElevations';
import type { ElevationPiece, WallElevation } from '@/lib/plan/elevation';

const piece: ElevationPiece = { itemId: 'b', name: 'Base cabinet 600 mm', tag: 'base', kind: 'base', x: 0, w: 600, y: 0, h: 860, plinthMm: 100 };
const e = (wallIndex: number, label: string): WallElevation => ({ wallIndex, label, lengthMm: 3000, ceilingMm: 2400, pieces: [piece], counters: [], openings: [] });
const north = e(0, 'Wall 1 — north, 3000 mm');
const east = e(1, 'Wall 2 — east, 4000 mm');

describe('KitchenElevations', () => {
  it('shows the first wall, and another when picked', () => {
    render(<KitchenElevations elevations={[north, east]} units="mm" />);
    expect(screen.getByRole('img', { name: 'Elevation of Wall 1 — north, 3000 mm' })).toBeTruthy();
    const pick = screen.getByRole('button', { name: 'Wall 2 — east, 4000 mm' });
    expect(pick.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pick);
    expect(pick.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('img', { name: 'Elevation of Wall 2 — east, 4000 mm' })).toBeTruthy();
  });

  it('falls back to the first wall when the picked one is gone', () => {
    const { rerender } = render(<KitchenElevations elevations={[north, east]} units="mm" />);
    fireEvent.click(screen.getByRole('button', { name: /^Wall 2/ }));
    rerender(<KitchenElevations elevations={[north]} units="mm" />);
    expect(screen.getByRole('img', { name: 'Elevation of Wall 1 — north, 3000 mm' })).toBeTruthy();
  });

  it('draws lengths in inches for an inch project', () => {
    render(<KitchenElevations elevations={[north]} units="in" />);
    expect(screen.getAllByText('1\' 11 1/2"').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^\d+ mm$/)).toBeNull();
  });

  it('says what to do when nothing is against a wall', () => {
    render(<KitchenElevations elevations={[]} units="mm" />);
    expect(screen.getByText('Place cabinets or appliances against a wall to see its elevation.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
