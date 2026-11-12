import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React, { useState } from 'react';
import LengthInput from './LengthInput';

function Harness({ units, initial = '' }: { units: 'mm' | 'in'; initial?: string }) {
  const [text, setText] = useState(initial);
  return (
    <label>
      <span>Length</span>
      <LengthInput units={units} value={text} onChange={setText} />
    </label>
  );
}

describe('LengthInput', () => {
  it('opens the number keypad by default, and the label still names only the input', () => {
    render(<Harness units="mm" />);
    const input = screen.getByLabelText(/^Length/) as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.inputMode).toBe('decimal');
    expect(input.placeholder).toMatch(/mm/);
  });

  it('switches to the full keyboard for units, and back', () => {
    render(<Harness units="in" />);
    const input = screen.getByLabelText(/^Length/) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: /type feet and inches/i }));
    expect(input.inputMode).toBe('text');
    expect(input.placeholder).toBe(`e.g. 12' 6"`);
    fireEvent.click(screen.getByRole('button', { name: /number keypad/i }));
    expect(input.inputMode).toBe('decimal');
  });

  it('starts on the full keyboard when the text already has units in it', () => {
    render(<Harness units="in" initial={`12' 6"`} />);
    expect((screen.getByLabelText(/^Length/) as HTMLInputElement).inputMode).toBe('text');
  });

  it('still echoes how it read a length', () => {
    render(<Harness units="in" />);
    fireEvent.change(screen.getByLabelText(/^Length/), { target: { value: '150' } });
    expect(screen.getByText(/^= /)).not.toBeNull();
  });
});
