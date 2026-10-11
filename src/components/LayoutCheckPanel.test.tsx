import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import LayoutCheckPanel from './LayoutCheckPanel';
import type { LayoutRule } from '@/lib/plan/layout-check';

const rules: LayoutRule[] = [
  { id: 'a', title: 'Passing rule', status: 'pass', detail: '1200 mm' },
  { id: 'b', title: 'Not applicable', status: 'n/a', detail: 'no sink' },
  { id: 'c', title: 'Info rule', status: 'fail', detail: '2700 mm of counter', info: true },
  { id: 'd', title: 'Failing rule', status: 'fail', detail: '1000 mm from "base-600" to "base-1500"' },
];

describe('LayoutCheckPanel', () => {
  it('counts passes among pass/fail rules that are not info', () => {
    render(<LayoutCheckPanel rules={rules} units="mm" />);
    expect(screen.getByRole('heading', { name: 'Layout check — 1 of 2 passed' })).toBeTruthy();
  });

  it('lists fails first, then passes, then info and n/a', () => {
    render(<LayoutCheckPanel rules={rules} units="mm" />);
    const items = within(screen.getByRole('list', { name: 'Layout check' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Failing rule'),
      expect.stringContaining('Passing rule'),
      expect.stringContaining('Info rule'),
      expect.stringContaining('Not applicable'),
    ]);
  });

  it('shows lengths in inches for an inch project', () => {
    render(<LayoutCheckPanel rules={rules} units="in" />);
    expect(screen.getByText(/3' 11 1\/4"/)).toBeTruthy();
    expect(screen.queryByText(/\d mm/)).toBeNull();
  });

  it('asks for the main appliances when nothing can be checked yet', () => {
    render(<LayoutCheckPanel rules={[rules[1]]} units="mm" />);
    expect(screen.getByRole('heading', { name: 'Layout check — place a fridge, sink and range to start' })).toBeTruthy();
  });
});
