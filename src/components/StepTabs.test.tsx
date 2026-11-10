import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import StepTabs from './StepTabs';

const steps = [
  { id: 'a', label: 'Room' },
  { id: 'b', label: 'Layout' },
  { id: 'c', label: 'Share' },
] as const;

describe('StepTabs', () => {
  it('shows each step as a tab and marks the active one', () => {
    render(<StepTabs steps={steps} active="b" onChange={() => {}} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['1Room', '2Layout', '3Share']);
    expect(screen.getByRole('tab', { name: /Layout/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Room/ }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: /Room/ }).getAttribute('tabindex')).toBe('-1');
  });

  it('reports a clicked step', () => {
    const onChange = vi.fn();
    render(<StepTabs steps={steps} active="a" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: /Share/ }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('moves with the arrow keys, wrapping at the ends, and with Home and End', () => {
    const onChange = vi.fn();
    render(<StepTabs steps={steps} active="a" onChange={onChange} />);
    const room = screen.getByRole('tab', { name: /Room/ });
    fireEvent.keyDown(room, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(room, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(room, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Share/ }), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(room, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});
