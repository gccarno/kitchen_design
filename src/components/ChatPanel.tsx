'use client';

import React, { useRef, useState } from 'react';
import { proposalFromRefinement, type Proposal, type RefinementResponse } from '@/lib/plan/proposal';

interface ChatPanelProps {
  projectId: string;
  /** Called when the model proposes a change; it goes to the review step. */
  onProposal: (proposal: Proposal) => void;
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
export default function ChatPanel({ projectId, onProposal }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function send() {
    const message = draft.trim();
    if (!message || inFlight.current) return;
    inFlight.current = true;
    const history = messages
      .filter((m) => !m.error)
      .slice(-HISTORY_TURNS)
      .map(({ role, content }) => ({ role, content }));
    setMessages((ms) => [...ms, { role: 'user', content: message }]);
    setDraft('');
    setBusy(true);

    let reply: Message;
    try {
      const res = await fetch(`/api/projects/${projectId}/refine`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, history }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<RefinementResponse> & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
      const result = body as RefinementResponse;
      const text = result.reply || result.summary || (result.patch.length ? '' : 'No changes.');
      if (result.patch.length > 0) {
        onProposal(proposalFromRefinement(result));
        reply = { role: 'assistant', content: text, note: 'Review the change above before it’s applied.' };
      } else {
        reply = { role: 'assistant', content: text };
      }
    } catch (err) {
      reply = { role: 'assistant', content: `Sorry — ${(err as Error).message}`, error: true };
    }
    setMessages((ms) => [...ms, reply]);
    setBusy(false);
    inFlight.current = false;
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
          placeholder="e.g. move the fridge to the north wall, add a dishwasher next to the sink"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
          disabled={busy || draft.trim() === ''}
          onClick={() => void send()}
        >
          Send
        </button>
        {busy && <span className="text-sm text-gray-600">Thinking… free models can take a minute.</span>}
      </div>
    </div>
  );
}
