import React from 'react';
import { layoutDetail, layoutSummary, type LayoutRule } from '@/lib/plan/layout-check';

const MARK: Record<LayoutRule['status'], string> = { pass: '✓', fail: '✗', 'n/a': '–' };

/** The kitchen against the NKBA planning guidelines: what passes, what fails, what doesn't apply yet. */
export default function LayoutCheckPanel({ rules, units }: { rules: LayoutRule[]; units: 'mm' | 'in' }) {
  const { passed, counted, ordered } = layoutSummary(rules);

  return (
    <div className="rounded border border-gray-200 p-2 text-sm">
      <h3 className="font-medium">
        {counted > 0 ? `Layout check — ${passed} of ${counted} passed` : 'Layout check — place a fridge, sink and range to start'}
      </h3>
      <ul aria-label="Layout check" className="mt-1 flex flex-col gap-0.5">
        {ordered.map((r) => (
          <li
            key={r.id}
            className={r.status === 'n/a' || r.info ? 'text-gray-500' : r.status === 'fail' ? 'text-red-800' : 'text-green-800'}
          >
            <span aria-hidden="true" className="inline-block w-4">
              {r.info && r.status !== 'n/a' ? 'i' : MARK[r.status]}
            </span>
            <span className="font-medium">{r.title}</span>: {layoutDetail(r.detail, units)}
          </li>
        ))}
      </ul>
    </div>
  );
}
