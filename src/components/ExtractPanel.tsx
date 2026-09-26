'use client';

import React, { useRef, useState } from 'react';
import { proposalFromExtraction, type ExtractionResponse, type Proposal } from '@/lib/plan/proposal';

interface ExtractPanelProps {
  projectId: string;
  hasPhotos: boolean;
  onProposal: (proposal: Proposal) => void;
}

const MAX_MEASUREMENTS = 4;

type Row = { key: number; description: string; length: string };

/**
 * Ask the vision model for a room outline. The user describes each measured
 * wall in their own words ("sink wall") because the model's walls don't
 * exist yet; the server matches them up and rescales to fit.
 */
export default function ExtractPanel({ projectId, hasPhotos, onProposal }: ExtractPanelProps) {
  const nextKey = useRef(1);
  const [rows, setRows] = useState<Row[]>([{ key: 0, description: '', length: '' }]);
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const filled = rows.filter((r) => r.description.trim() !== '' || r.length.trim() !== '');
  const incomplete = filled.some((r) => r.description.trim() === '' || !(Number(r.length) > 0));
  const canRun = hasPhotos && !incomplete && !busy;

  function update(key: number, change: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const body: { measurements: { description: string; lengthMm: number }[]; hint?: string } = {
        measurements: filled.map((r) => ({ description: r.description.trim(), lengthMm: Number(r.length) })),
      };
      if (hint.trim()) body.hint = hint.trim();
      const res = await fetch(`/api/projects/${projectId}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ExtractionResponse> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `extraction failed (${res.status})`);
      onProposal(proposalFromExtraction(data as ExtractionResponse));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600">
        Measure one or two walls with a tape measure: they set the scale. Describe each so the model can find it.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={r.key} className="flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span>Which wall{i === 0 ? ' (e.g. “sink wall”)' : ''}</span>
              <input
                className="w-48 rounded border px-2 py-1"
                value={r.description}
                maxLength={200}
                onChange={(e) => update(r.key, { description: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>Length (mm)</span>
              <input
                className="w-28 rounded border px-2 py-1"
                type="number"
                inputMode="decimal"
                min={1}
                value={r.length}
                onChange={(e) => update(r.key, { length: e.target.value })}
              />
            </label>
            {rows.length > 1 && (
              <button
                type="button"
                className="rounded border px-2 py-1"
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="self-start text-sm underline disabled:opacity-40"
        disabled={rows.length >= MAX_MEASUREMENTS}
        onClick={() => setRows((rs) => [...rs, { key: nextKey.current++, description: '', length: '' }])}
      >
        Add another wall
      </button>
      {incomplete && <p className="text-sm text-amber-700">Each measurement needs a wall and a length.</p>}

      <label className="flex flex-col gap-1 text-sm">
        <span>Anything else the model should know? (optional)</span>
        <input
          className="rounded border px-2 py-1"
          value={hint}
          maxLength={500}
          placeholder="e.g. galley kitchen, the door is opposite the window"
          onChange={(e) => setHint(e.target.value)}
        />
      </label>

      {!hasPhotos && <p className="text-sm text-gray-600">Upload at least one photo first.</p>}
      <button
        type="button"
        className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-40"
        disabled={!canRun}
        onClick={run}
      >
        Get room from photos
      </button>
      {busy && <p className="text-sm text-gray-600">Asking the model… this can take up to a minute.</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
