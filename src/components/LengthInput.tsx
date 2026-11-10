'use client';

import React from 'react';
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
 */
export default function LengthInput({ value, onChange, units = 'mm', className, placeholder }: LengthInputProps) {
  const mm = parseLength(value, units);
  const bareMetric = units === 'mm' && /^\s*[\d.]+\s*$/.test(value);
  const invalid = value.trim() !== '' && mm === null;
  return (
    <>
      <input
        className={className}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder ?? (units === 'in' ? `e.g. 12' 6"` : 'e.g. 3600 or 3.6 m')}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {mm !== null && !bareMetric && <span className="text-xs text-gray-500">= {formatLength(mm, units)}</span>}
      {invalid && <span className="text-xs text-amber-700">Can’t read that length</span>}
    </>
  );
}
