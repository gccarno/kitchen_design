'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { proposalFromExtraction, type ExtractionResponse, type Proposal } from '@/lib/plan/proposal';
import { useBrowserValue } from '@/lib/client/browser-value';
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
import ErrorDetail from './ErrorDetail';
import RetryCountdown from './RetryCountdown';

interface ExtractPanelProps {
  projectId: string;
  hasPhotos: boolean;
  /** The project's units: what a bare length means, and how lengths are echoed. */
  units?: 'mm' | 'in';
  /** The photos' labels ("sink wall"): offered as names for a measured wall. */
  photoLabels?: string[];
  onProposal: (proposal: Proposal) => void;
}

const MAX_MEASUREMENTS = 4;
const fallbackError = (status: number) => `extraction failed (${status})`;

type Row = { key: number; description: string; length: string };
type Draft = { rows: Row[]; hint: string };
const BLANK_ROWS: Row[] = [{ key: 0, description: '', length: '' }];

/** A saved draft, or null when there is none or it isn't one (storage is only a convenience). */
function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Draft;
    const rowsOk = Array.isArray(d.rows) && d.rows.length > 0 && d.rows.every((r) => typeof r.key === 'number' && typeof r.description === 'string' && typeof r.length === 'string');
    return rowsOk && typeof d.hint === 'string' ? d : null;
  } catch {
    return null;
  }
}

/**
 * Ask the vision model for a room outline. The user describes each measured
 * wall in their own words ("sink wall") because the model's walls don't
 * exist yet; the server matches them up and rescales to fit.
 */
export default function ExtractPanel({ projectId, hasPhotos, units = 'mm', photoLabels = [], onProposal }: ExtractPanelProps) {
  const online = useOnline();
  const draftKey = `kd-extract-draft:${projectId}`;
  // What was typed before a reload (this tab), read once the page is in the browser.
  const savedRaw = useBrowserValue(() => {
    try {
      return sessionStorage.getItem(draftKey);
    } catch {
      return null;
    }
  }, null);
  const saved = useMemo(() => parseDraft(savedRaw), [savedRaw]);
  // Once anything is typed here the form is this page's own; until then, the saved draft or empty.
  const [edited, setEdited] = useState<Draft | null>(null);
  const rows = edited?.rows ?? saved?.rows ?? BLANK_ROWS;
  const hint = edited?.hint ?? saved?.hint ?? '';

  /** Change the form, and keep it for a reload. */
  function change(next: Partial<Draft>) {
    const draft = { rows, hint, ...next };
    setEdited(draft);
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      /* storage blocked: the form just isn't kept */
    }
  }
  const setRows = (next: Row[]) => change({ rows: next });
  const setHint = (next: string) => change({ hint: next });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retryAfterMs?: number; detail?: string } | null>(null);
  const [slow, setSlow] = useState(false);
  const inFlight = useRef(false);
  const current = useRef<AbortController | null>(null);
  const jobKey = `kd-job:extract:${projectId}`;
  const labelListId = `photo-labels-${projectId}`;

  const filled = rows.filter((r) => r.description.trim() !== '' || r.length.trim() !== '');
  const incomplete = filled.some((r) => r.description.trim() === '' || parseLength(r.length, units) === null);
  const canRun = online && hasPhotos && !incomplete && !busy;

  function update(key: number, change: Partial<Row>) {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
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
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* nothing kept */
      }
      onProposal(proposalFromExtraction(data));
    } catch (err) {
      // Unmounted mid-poll: keep the remembered job so the next mount resumes it.
      if (isAbortError(err)) return;
      // Connection lost (or gave up waiting): the job may still finish, so the next mount resumes it.
      if (!keepsJob(err)) forgetJob(jobKey);
      const failed = err instanceof JobFailedError ? err : undefined;
      setError({ message: (err as Error).message, retryAfterMs: failed?.retryAfterMs, detail: failed?.detail });
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
    // Reconnecting to a job that is still running elsewhere (saved in sessionStorage, which the
    // server render can't read): an effect syncing with an external system, as intended.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) void execute((signal) => waitForJob<ExtractionResponse>(saved.jobId, { signal, fallbackError }));
    return () => {
      current.current?.abort();
      current.current = null;
      inFlight.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per project; execute reads refs only
  }, [jobKey]);

  // The hint shows only while busy; the cleanup resets it for the next request.
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setSlow(true), SLOW_HINT_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
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

      <fieldset className="rounded border p-3 text-sm">
        <legend className="px-1 font-medium">Measured a wall? Sizes will be exact (optional)</legend>
        <div className="flex flex-col gap-3">
          <p className="text-gray-600">
            Measure two walls that meet at a corner if you can: one fixes the room’s width, the other its depth. Describe each so the model can find it.
          </p>
          <datalist id={labelListId}>
            {[...new Set(photoLabels)].map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <ul className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={r.key} className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span>Which wall{i === 0 ? ' (e.g. “sink wall”)' : ''}</span>
                  <input
                    className="w-48 rounded border px-2 py-1"
                    list={labelListId}
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
                    onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
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
            onClick={() => setRows([...rows, { key: Math.max(...rows.map((r) => r.key)) + 1, description: '', length: '' }])}
          >
            Add another wall
          </button>
          {incomplete && <p className="text-amber-700">Each measurement needs a wall and a length.</p>}
        </div>
      </fieldset>

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
      {busy && <ExtractProgress slow={slow} />}
      {error && (
        <p role="alert" className="text-sm break-words text-red-700">
          {error.message}
        </p>
      )}
      <ErrorDetail detail={error?.detail} />
      {error?.retryAfterMs !== undefined && (
        <RetryCountdown retryAfterMs={error.retryAfterMs} onRetry={run} disabled={!canRun} />
      )}
    </div>
  );
}

/** What the free vision models usually take: the bar fills over this and then waits near the end. */
const TYPICAL_MS = 3 * 60_000;

/**
 * The wait is minutes, not seconds, so show that time is passing: a clock and
 * a bar that eases towards the usual time (it never claims to be done).
 */
function ExtractProgress({ slow }: { slow: boolean }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, []);
  const secs = Math.floor(elapsedMs / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  // 1 − e^(−t/τ): about 63% at the usual time, 95% at three times it.
  const fraction = 1 - Math.exp(-elapsedMs / TYPICAL_MS);
  return (
    <div className="flex flex-col gap-1 text-sm text-gray-600" role="status">
      <p>
        Reading your photos… <span className="tabular-nums">{clock}</span>. This usually takes 1–4 minutes.
      </p>
      <div className="h-1.5 w-full max-w-xs overflow-hidden rounded bg-gray-200" aria-hidden>
        <div className="h-full bg-black transition-[width] duration-1000 ease-linear" style={{ width: `${Math.max(fraction, 0.03) * 100}%` }} />
      </div>
      {slow && <p>Still working — you can leave this page and come back; it keeps going.</p>}
    </div>
  );
}
