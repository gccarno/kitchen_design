'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { loadCatalog } from '@/lib/catalog/loader';
import { buildEstimate, type EstimateLine } from '@/lib/estimate/estimate';
import { moneyFormat } from '@/lib/estimate/money';
import { useOnline } from '@/lib/client/online';
import { COUNTERTOP_RATES, DEFAULT_CURRENCY, DEFAULT_RATES } from '@/lib/estimate/prices';
import { finishesOf } from '@/lib/plan/finishes';
import { projectKind, type Pricing, type Project } from '@/lib/plan/schemas';

export { moneyFormat };

interface EstimatePanelProps {
  project: Project;
  /** Save new prices (`undefined`: back to the defaults); resolves to an error message, or null. */
  onSave: (pricing: Pricing | undefined, summary: string) => Promise<string | null>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function quantityText(l: EstimateLine): string {
  if (l.unit === 'each') return String(l.quantity);
  if (l.unit === 'drawer') return `${l.quantity} drawer${l.quantity === 1 ? '' : 's'}`;
  return `${l.quantity.toFixed(2)} ${l.unit}`;
}

/** No overrides left: store nothing, so the project goes back to the defaults. */
function tidy(p: Pricing): Pricing | undefined {
  const { currency, unitPrices, ...rates } = p;
  const empty = currency === DEFAULT_CURRENCY && Object.keys(unitPrices).length === 0 && Object.keys(rates).length === 0;
  return empty ? undefined : p;
}

/**
 * The parts list with prices: change any unit price or rate and it is saved
 * straight away as a revision (undoable), like an edit on the plan.
 */
export default function EstimatePanel({ project, onSave }: EstimatePanelProps) {
  const estimate = useMemo(() => buildEstimate(project, loadCatalog()), [project]);
  const money = moneyFormat(estimate.currency);
  const online = useOnline();
  const [error, setError] = useState<string | null>(null);
  const closet = projectKind(project) === 'closet';
  const base: Pricing = project.pricing ?? { currency: DEFAULT_CURRENCY, unitPrices: {} };
  /** The countertop rate for the chosen material, until the user sets their own. */
  const countertopRate = project.pricing?.countertopPerM2 ?? COUNTERTOP_RATES[finishesOf(project).countertop];

  async function save(next: Pricing, summary: string) {
    if (!online) return setError('Not saved: offline — editing is disabled');
    setError(null);
    const err = await onSave(tidy(next), summary);
    if (err) setError(`Not saved: ${err}`);
  }

  const setPrice = (l: EstimateLine, v: number) =>
    save({ ...base, unitPrices: { ...base.unitPrices, [l.key]: v } }, `Set the price of ${l.label} to ${money.format(v)}`);
  const resetPrice = (l: EstimateLine) => {
    const { [l.key]: _gone, ...unitPrices } = base.unitPrices;
    return save({ ...base, unitPrices }, `Reset the price of ${l.label}`);
  };
  const setRate = (key: 'countertopPerM2' | 'installPct' | 'taxPct' | 'hardwareEach', v: number, summary: string) =>
    save({ ...base, [key]: v }, summary);

  return (
    <div className="flex flex-col gap-2 text-sm">
      {estimate.lines.length === 0 ? (
        <p className="text-gray-600">Nothing to price yet — add {closet ? 'components to the closet' : 'items to the plan'}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Estimate" className="w-full border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-600">
                <th className="py-1 pr-2 font-medium">Item</th>
                <th className="py-1 pr-2 font-medium">Quantity</th>
                <th className="py-1 pr-2 font-medium">Unit price</th>
                <th className="py-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {estimate.lines.map((l) => (
                <tr key={l.key} className="border-b border-gray-100">
                  <td className="py-1 pr-2">{l.label}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{quantityText(l)}</td>
                  <td className="py-1 pr-2">
                    {l.key === 'countertop' || l.key === 'hardware' ? (
                      // Edited as a rate below.
                      <span className="whitespace-nowrap">
                        {money.format(l.unitPrice)}
                        {l.unit === 'each' ? '' : `/${l.unit}`}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <NumberField
                          label={`Unit price: ${l.label}`}
                          value={l.unitPrice}
                          onCommit={(v) => setPrice(l, v)}
                          onInvalid={setError}
                          disabled={!online}
                        />
                        {l.overridden && (
                          <button
                            type="button"
                            className="rounded border px-1 text-xs text-gray-700"
                            aria-label={`Reset the price of ${l.label}`}
                            title="Back to the default price"
                            disabled={!online}
                            onClick={() => resetPrice(l)}
                          >
                            reset
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">{money.format(l.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {(
                [
                  ['Subtotal', estimate.subtotal],
                  [`Installation (${round2(estimate.installPct)}%)`, estimate.install],
                  [`Tax (${round2(estimate.taxPct)}%)`, estimate.tax],
                  ['Total', estimate.total],
                ] as const
              ).map(([label, amount]) => (
                <tr key={label} className={label === 'Total' ? 'font-semibold' : ''}>
                  <th scope="row" colSpan={3} className="py-1 pr-2 text-left font-[inherit]">
                    {label}
                  </th>
                  <td className="py-1 text-right whitespace-nowrap">{money.format(amount)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Rates">
        {closet ? (
          <NumberField
            label="Hardware each"
            visibleLabel
            value={project.pricing?.hardwareEach ?? DEFAULT_RATES.hardwareEach}
            onCommit={(v) => setRate('hardwareEach', v, `Set hardware to ${money.format(v)} each`)}
            onInvalid={setError}
            disabled={!online}
          />
        ) : (
          <NumberField
            label="Countertop per m²"
            visibleLabel
            hint={
              project.units === 'in'
                ? `${money.format(countertopRate / 10.7639)}/ft²`
                : undefined
            }
            value={countertopRate}
            onCommit={(v) => setRate('countertopPerM2', v, `Set the countertop price to ${money.format(v)} per m²`)}
            onInvalid={setError}
            disabled={!online}
          />
        )}
        <NumberField
          label="Installation %"
          visibleLabel
          max={100}
          value={estimate.installPct}
          onCommit={(v) => setRate('installPct', v, `Set installation to ${v}%`)}
          onInvalid={setError}
          disabled={!online}
        />
        <NumberField
          label="Tax %"
          visibleLabel
          max={100}
          value={estimate.taxPct}
          onCommit={(v) => setRate('taxPct', v, `Set tax to ${v}%`)}
          onInvalid={setError}
          disabled={!online}
        />
        <CurrencyField
          value={estimate.currency}
          onCommit={(c) => save({ ...base, currency: c }, `Set the currency to ${c}`)}
          onInvalid={setError}
          disabled={!online}
        />
      </div>

      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <p className="text-gray-600">Prices are rough estimates; change any of them to match your quotes.</p>
    </div>
  );
}

/** A non-negative number input (at most `max`) that commits on Enter or blur, and only when it changed. */
function NumberField({
  label,
  value,
  onCommit,
  onInvalid,
  max,
  visibleLabel = false,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  onInvalid: (message: string) => void;
  max?: number;
  visibleLabel?: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  const shown = String(round2(value));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const v = Number(text);
    const revert = (message?: string) => {
      setText(shown);
      if (message) onInvalid(message);
    };
    if (text.trim() === '' || !Number.isFinite(v)) return revert();
    if (v < 0) return revert(`${label.replace(/^Unit price: /, '')}: prices can’t be negative.`);
    if (max !== undefined && v > max) return revert(`${label}: use a number from 0 to ${max}.`);
    if (round2(v) !== round2(value)) onCommit(round2(v));
  };
  const input = (
    <input
      className="w-24 rounded border px-2 py-1 disabled:opacity-40"
      disabled={disabled}
      title={disabled ? 'Offline' : undefined}
      inputMode="decimal"
      aria-label={visibleLabel ? undefined : label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
  if (!visibleLabel) return input;
  return (
    <label className="flex flex-col gap-1">
      <span>
        {label}
        {hint && <span className="text-gray-500"> ({hint})</span>}
      </span>
      {input}
    </label>
  );
}

function CurrencyField({ value, onCommit, onInvalid, disabled }: { value: string; onCommit: (c: string) => void; onInvalid: (m: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const code = text.trim().toUpperCase();
    if (code === value) return setText(value);
    if (!/^[A-Z]{3}$/.test(code)) {
      setText(value);
      return onInvalid('Currency: use a 3-letter code, like USD, EUR or GBP.');
    }
    onCommit(code);
  };
  return (
    <label className="flex flex-col gap-1">
      <span>Currency</span>
      <input
        className="w-20 rounded border px-2 py-1 uppercase disabled:opacity-40"
        disabled={disabled}
        title={disabled ? 'Offline' : undefined}
        maxLength={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  );
}
