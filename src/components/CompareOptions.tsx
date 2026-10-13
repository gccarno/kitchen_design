import React from 'react';
import Link from 'next/link';
import ClosetElevation from './ClosetElevation';
import PlanThumbnail from './PlanThumbnail';
import type { Catalog } from '@/lib/catalog/loader';
import { partDifferences } from '@/lib/estimate/compare';
import { buildEstimate } from '@/lib/estimate/estimate';
import { moneyFormat } from '@/lib/estimate/money';
import { checkLayout, layoutSummary } from '@/lib/plan/layout-check';
import { groupName } from '@/lib/plan/options';
import type { Project } from '@/lib/plan/schemas';

const quantity = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const count = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

/** Design options side by side — thumbnail, estimate, layout check, item count — then the parts that differ. Read-only. */
export default function CompareOptions({ projects, catalog }: { projects: Project[]; catalog: Catalog }) {
  const estimates = projects.map((p) => buildEstimate(p, catalog));
  const differences = partDifferences(estimates);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Compare options — {groupName(projects)}</h1>

      <ul aria-label="Options" className="flex gap-4 overflow-x-auto pb-2">
        {projects.map((p, i) => {
          const money = moneyFormat(estimates[i].currency);
          const layout = p.closet ? null : layoutSummary(checkLayout(p));
          const failed = layout?.ordered.filter((r) => r.status === 'fail' && !r.info) ?? [];
          return (
            <li key={p.id} className="flex min-w-[220px] flex-1 flex-col gap-2 rounded border p-3 text-sm">
              <Link href={`/project/${p.id}`} className="font-medium text-blue-700 underline">
                {p.name}
              </Link>
              {p.closet ? (
                <ClosetElevation closet={p.closet} label={`Elevation of ${p.name}`} className="h-40 w-full rounded border bg-white" />
              ) : (
                <PlanThumbnail room={p.room} items={p.items} label={`Plan of ${p.name}`} className="h-40 w-full rounded border bg-white" />
              )}
              <span className="font-medium">Total {money.format(estimates[i].total)}</span>
              <span className="text-gray-600">Subtotal {money.format(estimates[i].subtotal)}</span>
              {layout && (
                <div className="flex flex-col">
                  <span>
                    {layout.counted > 0 ? `Layout check: ${layout.passed} of ${layout.counted} passed` : 'Layout check: nothing to check yet'}
                  </span>
                  {failed.length > 0 && (
                    <ul aria-label={`Failed checks for ${p.name}`} className="list-disc pl-5 text-red-800">
                      {failed.map((r) => (
                        <li key={r.id}>{r.title}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <span>{count(p.closet ? p.closet.components.length : p.items.length)}</span>
            </li>
          );
        })}
      </ul>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">What differs</h2>
        {differences.length === 0 ? (
          <p className="text-sm text-gray-600">These options use the same parts.</p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="What differs" className="text-sm">
              <thead>
                <tr>
                  <th scope="col" className="pr-4 text-left">Part</th>
                  {projects.map((p) => (
                    <th key={p.id} scope="col" className="pr-4 text-right">{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {differences.map((d) => (
                  <tr key={d.key}>
                    <th scope="row" className="pr-4 text-left font-normal">
                      {d.label}
                      {d.unit === 'each' ? '' : ` (${d.unit})`}
                    </th>
                    {d.quantities.map((q, i) => (
                      <td key={projects[i].id} className="pr-4 text-right">{quantity(q)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
