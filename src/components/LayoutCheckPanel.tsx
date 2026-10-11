import React from 'react';
import type { LayoutRule } from '@/lib/plan/layout-check';
import { formatLength } from '@/lib/plan/viewport';

/** Fails first, then passes, then information, then what doesn't apply yet. */
const order = (r: LayoutRule) => (r.status === 'n/a' ? 3 : r.info ? 2 : r.status === 'fail' ? 0 : 1);
const MARK: Record<LayoutRule['status'], string> = { pass: '✓', fail: '✗', 'n/a': '–' };

/** The kitchen against the NKBA planning guidelines: what passes, what fails, what doesn't apply yet. */
export default function LayoutCheckPanel({ rules, units }: { rules: LayoutRule[]; units: 'mm' | 'in' }) {
  const counted = rules.filter((r) => !r.info && r.status !== 'n/a');
  const passed = counted.filter((r) => r.status === 'pass').length;
  const sorted = [...rules].sort((a, b) => order(a) - order(b));
  const detail = (text: string) => text.replace(/(\d+) mm/g, (_, n: string) => formatLength(Number(n), units));

  return (
    <div className="rounded border border-gray-200 p-2 text-sm">
      <h3 className="font-medium">
        {counted.length > 0
          ? `Layout check — ${passed} of ${counted.length} passed`
          : 'Layout check — place a fridge, sink and range to start'}
      </h3>
      <ul aria-label="Layout check" className="mt-1 flex flex-col gap-0.5">
        {sorted.map((r) => (
          <li
            key={r.id}
            className={r.status === 'n/a' || r.info ? 'text-gray-500' : r.status === 'fail' ? 'text-red-800' : 'text-green-800'}
          >
            <span aria-hidden="true" className="inline-block w-4">
              {r.info && r.status !== 'n/a' ? 'i' : MARK[r.status]}
            </span>
            <span className="font-medium">{r.title}</span>: {detail(r.detail)}
          </li>
        ))}
      </ul>
    </div>
  );
}
