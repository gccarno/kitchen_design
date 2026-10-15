'use client';

import React, { useEffect, useRef, useState } from 'react';
import { proposalFromRefinement, type Proposal, type RefinementResponse } from '@/lib/plan/proposal';
import { forgetJob, isAbortError, keepsJob, recallJob, rememberJob, SLOW_HINT_MS, startAndWait, waitForJob } from '@/lib/client/jobs';

interface ChatPanelProps {
  projectId: string;
  /** Called when the model proposes a change; it goes to the review step. */
  onProposal: (proposal: Proposal) => void;
  placeholder?: string;
}

/** `content` is what was said (and goes back as history); `note` is UI-only guidance. */
type Message = { role: 'user' | 'assistant'; content: string; note?: string; error?: boolean };

/** Turns of context sent with each request (errors excluded). */
const HISTORY_TURNS = 6;

/**
 * Ask for changes in plain words ("move the fridge to the north wall").
 * The model's edit is never applied directly: it becomes a proposal the
 * user reviews and applies. The conversation lives only in this page.
 */
export default function ChatPanel({
  projectId,
  onProposal,
  placeholder = 'e.g. move the fridge to the north wall, add a dishwasher next to the sink',
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const inFlight = useRef(false);
  const current = useRef<AbortController | null>(null);
  const jobKey = `kd-job:refine:${projectId}`;

  /** Wait for one reply (a new job, or a resumed one) and add it to the conversation. */
  async function execute(work: (signal: AbortSignal) => Promise<RefinementResponse>) {
    inFlight.current = true;
    const ctrl = new AbortController();
    current.current = ctrl;
    setBusy(true);

    let reply: Message;
    try {
      const result = await work(ctrl.signal);
      forgetJob(jobKey);
      const text = result.reply || result.summary || (result.patch.length ? '' : 'No changes.');
      if (result.patch.length > 0) {
        onProposal(proposalFromRefinement(result));
        reply = { role: 'assistant', content: text, note: 'Review the change above before it’s applied.' };
      } else {
        reply = { role: 'assistant', content: text };
      }
    } catch (err) {
      // Unmounted mid-poll: keep the remembered job so the next mount resumes it.
      if (isAbortError(err)) return;
      // Connection lost (or gave up waiting): the job may still finish, so the next mount resumes it.
      if (!keepsJob(err)) forgetJob(jobKey);
      reply = { role: 'assistant', content: `Sorry — ${(err as Error).message}`, error: true };
    }
    if (current.current !== ctrl) return;
    current.current = null;
    setMessages((ms) => [...ms, reply]);
    setBusy(false);
    inFlight.current = false;
  }

  // Resume a request started before this component last unmounted (navigated away and back).
  useEffect(() => {
    const saved = recallJob<{ jobId: string; message?: unknown }>(jobKey);
    if (saved && !inFlight.current) {
      if (typeof saved.message === 'string') setMessages([{ role: 'user', content: saved.message }]);
      void execute((signal) => waitForJob<RefinementResponse>(saved.jobId, { signal }));
    }
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

  function send() {
    const message = draft.trim();
    if (!message || inFlight.current) return;
    const history = messages
      .filter((m) => !m.error)
      .slice(-HISTORY_TURNS)
      .map(({ role, content }) => ({ role, content }));
    setMessages((ms) => [...ms, { role: 'user', content: message }]);
    setDraft('');
    void execute((signal) =>
      startAndWait<RefinementResponse>(
        () =>
          fetch(`/api/projects/${projectId}/refine`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message, history }),
          }),
        { signal, onJobId: (jobId) => rememberJob(jobKey, { jobId, message }) }
      )
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {messages.length > 0 && (
        <ol aria-label="Conversation" className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded border p-2 text-sm">
          {messages.map((m, i) => (
            <li
              key={i}
              className={`max-w-[85%] rounded px-3 py-2 ${
                m.role === 'user' ? 'self-end bg-blue-600 text-white' : m.error ? 'bg-red-50 text-red-800' : 'bg-gray-100'
              }`}
            >
              {m.content}
              {m.note && <span className="block text-xs text-gray-600">{m.note}</span>}
            </li>
          ))}
        </ol>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span>Ask for a change</span>
        <textarea
          className="min-h-16 rounded border px-2 py-1"
          value={draft}
          maxLength={1000}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
          disabled={busy || draft.trim() === ''}
          onClick={() => send()}
        >
          Send
        </button>
        {busy && <span className="text-sm text-gray-600">Thinking… free models can take a minute, or a few for a whole layout.</span>}
        {busy && slow && <span className="text-sm text-gray-600">Still working — you can leave this page and come back.</span>}
      </div>
    </div>
  );
}
