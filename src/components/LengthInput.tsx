'use client';

import React, { useRef, useState } from 'react';
import { parseLength } from '@/lib/plan/length';
import { formatLength } from '@/lib/plan/viewport';

interface LengthInputProps {
  /** What the user has typed (the parent owns it, and reads it with `parseLength`). */
  value: string;
  onChange: (text: string) => void;
  /** The project's units: what a bare number means. */
  units?: 'mm' | 'in';
  className?: string;
  placeholder?: string;
}

/**
 * A text box for a length that takes `3600`, `3.6 m`, `12' 6"` and the like,
 * and says how it read them. A bare number in mm needs no echo.
 *
 * Phones open the number keypad, since a bare number in the project's units is
 * the usual answer; the small "abc" button switches to the full keyboard for
 * `12' 6"` or `3.6 m`. Text that already has letters or symbols keeps it.
 */
export default function LengthInput({ value, onChange, units = 'mm', className, placeholder }: LengthInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [letters, setLetters] = useState(() => /[^\d.\s]/.test(value));
  const mm = parseLength(value, units);
  const bareMetric = units === 'mm' && /^\s*[\d.]+\s*$/.test(value);
  const invalid = value.trim() !== '' && mm === null;
  function toggleKeyboard() {
    setLetters((on) => !on);
    // A phone only picks up the new keyboard on focus, so blur and focus again.
    inputRef.current?.blur();
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  const bareHint =units === 'in' ? 'inches, e.g. 150' : 'mm, e.g. 3600';
  const unitsHint = units === 'in' ? `e.g. 12' 6"` : 'e.g. 3600 or 3.6 m';
  return (
    <>
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          className={className}
          type="text"
          inputMode={letters ? 'text' : 'decimal'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder ?? (letters ? unitsHint : bareHint)}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {/* Not a <button>: callers wrap this in a <label>, which must keep the input as its only control. */}
        <span
          role="button"
          tabIndex={0}
          className="cursor-pointer rounded border px-1.5 py-0.5 text-xs text-gray-600"
          aria-label={letters ? 'Use the number keypad' : units === 'in' ? 'Type feet and inches' : 'Type units such as m or cm'}
          title={letters ? 'Number keypad' : 'Full keyboard, for units'}
          onClick={(e) => {
            e.preventDefault(); // not a click on the label
            toggleKeyboard();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            toggleKeyboard();
          }}
        >
          {letters ? '123' : 'abc'}
        </span>
      </span>
      {mm !== null && !bareMetric && <span className="text-xs text-gray-500">= {formatLength(mm, units)}</span>}
      {invalid && <span className="text-xs text-amber-700">Can’t read that length</span>}
    </>
  );
}
