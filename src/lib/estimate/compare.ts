import type { Estimate } from './estimate';

export interface PartDifference {
  key: string;
  label: string;
  unit: string;
  /** One per estimate, in order; 0 where the estimate has no such line. */
  quantities: number[];
}

/** The estimate lines whose quantity isn't the same in every estimate (a missing line counts as 0), sorted by label. */
export function partDifferences(estimates: Estimate[]): PartDifference[] {
  const meta = new Map<string, { label: string; unit: string }>();
  for (const e of estimates) for (const l of e.lines) if (!meta.has(l.key)) meta.set(l.key, { label: l.label, unit: l.unit });
  const rows: PartDifference[] = [];
  for (const [key, { label, unit }] of meta) {
    const quantities = estimates.map((e) => e.lines.find((l) => l.key === key)?.quantity ?? 0);
    if (quantities.some((q) => q !== quantities[0])) rows.push({ key, label, unit, quantities });
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}
