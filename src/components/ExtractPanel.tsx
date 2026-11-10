'use client';

import React, { useEffect, useRef, useState } from 'react';
import { proposalFromExtraction, type ExtractionResponse, type Proposal } from '@/lib/plan/proposal';
import { useOnline } from '@/lib/client/online';
import {
  forgetJob,
  isAbortError,
  JobFailedError,
  keepsJob,
  recallJob,
  rememberJob,
  SLOW_HINT_MS,
  startAndWait,
  waitForJob,
} from '@/lib/client/jobs';
import { parseLength } from '@/lib/plan/length';
import LengthInput from './LengthInput';
import RetryCountdown from './RetryCountdown';

interface ExtractPanelProps {
  projectId: string;
  hasPhotos: boolean;
  /** The project's units: what a bare length means, and how lengths are echoed. */
  units?: 'mm' | 'in';
  onProposal: (proposal: Proposal) => void;
}

const MAX_MEASUREMENTS = 4;
const fallbackError = (status: number) => `extraction failed (${status})`;

type Row = { key: number; description: string; length: string };

/**
 * Ask the vision model for a room outline. The user describes each measured
 * wall in their own words ("sink wall") because the model's walls don't
 * exist yet; the server matches them up and rescales to fit.
 */
export default function ExtractPanel({ projectId, hasPhotos, units = 'mm', onProposal }: ExtractPanelProps) {
  const online = useOnline();
  const nextKey = useRef(1);
  const [rows, setRows] = useState<Row[]>([{ key: 0, description: '', length: '' }]);
  const [hint, setHint] = useState('');
  const [showMeasured, setShowMeasured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retryAfterMs?: number } | null>(null);
  const [slow, setSlow] = useState(false);
  const inFlight = useRef(false);
  const current = useRef<AbortController | null>(null);
  const jobKey = `kd-job:extract:${projectId}`;

  const filled = rows.filter((r) => r.description.trim() !== '' || r.length.trim() !== '');
  const incomplete = filled.some((r) => r.description.trim() === '' || parseLength(r.length, units) === null);
  const canRun = online && hasPhotos && !incomplete && !busy;

  function update(key: number, change: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }

  /** Run one extraction (a new job, or a resumed one) and hand its result on as a proposal. */
  async function execute(work: (signal: AbortSignal) => Promise<ExtractionResponse>) {
    if (inFlight.current) return;
    inFlight.current = true;
    const ctrl = new AbortController();
    current.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      const data = await work(ctrl.signal);
      forgetJob(jobKey);
      onProposal(proposalFromExtraction(data));
    } catch (err) {
      // Unmounted mid-poll: keep the remembered job so the next mount resumes it.
      if (isAbortError(err)) return;
      // Connection lost (or gave up waiting): the job may still finish, so the next mount resumes it.
      if (!keepsJob(err)) forgetJob(jobKey);
      setError({ message: (err as Error).message, retryAfterMs: err instanceof JobFailedError ? err.retryAfterMs : undefined });
    } finally {
      if (current.current === ctrl) {
        current.current = null;
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  // Resume a job started before this component last unmounted (navigated away and back).
  useEffect(() => {
    const saved = recallJob(jobKey);
    if (saved) void execute((signal) => waitForJob<ExtractionResponse>(saved.jobId, { signal, fallbackError }));
    return () => {
      current.current?.abort();
      current.current = null;
      inFlight.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per project; execute reads refs only
  }, [jobKey]);

  useEffect(() => {
    if (!busy) return setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_HINT_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  function run() {
    const body: { measurements: { description: string; lengthMm: number }[]; hint?: string } = {
      measurements: filled.map((r) => ({ description: r.description.trim(), lengthMm: parseLength(r.length, units) as number })),
    };
    if (hint.trim()) body.hint = hint.trim();
    void execute((signal) =>
      startAndWait<ExtractionResponse>(
        () =>
          fetch(`/api/projects/${projectId}/extract`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        { signal, fallbackError, onJobId: (jobId) => rememberJob(jobKey, { jobId }) }
      )
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600">
        Add photos of the room and the model sketches an outline from them. Without a measurement the sizes are a guess, so the room is marked as estimated until you confirm one real size.
      </p>
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

      <details open={showMeasured} onToggle={(e) => setShowMeasured(e.currentTarget.open)} className="rounded border p-3 text-sm">
        <summary className="cursor-pointer font-medium">I measured a wall (more accurate)</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-gray-600">
            Measure one or two walls with a tape measure: they set the scale. Describe each so the model can find it.
          </p>
          <ul className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={r.key} className="flex flex-wrap items-end gap-2">
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
                  <span>{units === 'in' ? 'Length (ft/in)' : 'Length (mm)'}</span>
                  <LengthInput
                    className="w-28 rounded border px-2 py-1"
                    units={units}
                    value={r.length}
                    onChange={(length) => update(r.key, { length })}
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
            className="self-start underline disabled:opacity-40"
            disabled={rows.length >= MAX_MEASUREMENTS}
            onClick={() => setRows((rs) => [...rs, { key: nextKey.current++, description: '', length: '' }])}
          >
            Add another wall
          </button>
          {incomplete && <p className="text-amber-700">Each measurement needs a wall and a length.</p>}
        </div>
      </details>

      {!hasPhotos && <p className="text-sm text-gray-600">Upload at least one photo first.</p>}
      <button
        type="button"
        className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-40"
        disabled={!canRun}
        title={online ? undefined : 'Offline'}
        onClick={run}
      >
        Get room from photos
      </button>
      {busy && <p className="text-sm text-gray-600">Asking the model… this can take up to a minute.</p>}
      {busy && slow && (
        <p className="text-sm text-gray-600">Still working — the model is slow right now. You can leave this page and come back.</p>
      )}
      {error && (
        <p role="alert" className="text-sm break-words text-red-700">
          {error.message}
        </p>
      )}
      {error?.retryAfterMs !== undefined && (
        <RetryCountdown retryAfterMs={error.retryAfterMs} onRetry={run} disabled={!canRun} />
      )}
    </div>
  );
}
