import React from 'react';
import { layoutDetail, layoutSummary, type LayoutRule } from '@/lib/plan/layout-check';

const MARK: Record<LayoutRule['status'], string> = { pass: '✓', fail: '✗', 'n/a': '–' };

/**
 * A set of planning guidelines (by default the kitchen against the NKBA ones): what passes, what
 * fails, what doesn't apply yet. `title` and `empty` let it show another set, such as accessibility.
 */
export default function LayoutCheckPanel({
  rules,
  units,
  title = 'Layout check',
  empty = 'place a fridge, sink and range to start',
}: {
  rules: LayoutRule[];
  units: 'mm' | 'in';
  title?: string;
  empty?: string;
}) {
  const { passed, counted, ordered } = layoutSummary(rules);

  return (
    <div className="rounded border border-gray-200 p-2 text-sm">
      <h3 className="font-medium">
        {counted > 0 ? `${title} — ${passed} of ${counted} passed` : `${title} — ${empty}`}
      </h3>
      <ul aria-label={title} className="mt-1 flex flex-col gap-0.5">
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
