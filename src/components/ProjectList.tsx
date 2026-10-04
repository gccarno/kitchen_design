'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ClosetElevation from './ClosetElevation';
import PlanThumbnail from './PlanThumbnail';
import { submitRevision } from '@/lib/client/revisions';
import type { ProjectSummary } from '@/lib/storage/projects';

/**
 * The home page's project cards: a thumbnail of the current plan, the name,
 * and Rename / Delete. A rename is saved as a revision (so it can be undone
 * on the project page); a delete is permanent and asks first, in place.
 */
export default function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function rename(p: ProjectSummary) {
    const name = draft.trim();
    if (busy || !name) return;
    if (name === p.name) return setRenaming(null);
    setBusy(true);
    setError(null);
    const result = await submitRevision(p.id, {
      patch: [{ op: 'replace', path: '/name', value: name }],
      baseRevision: p.revision,
      summary: `Rename to ${name}`,
      source: 'user',
    });
    setBusy(false);
    if (result.ok) {
      setRenaming(null);
      router.refresh();
    } else {
      setError({ id: p.id, message: result.stale ? 'this project changed in another tab — reload the page' : result.error });
    }
  }

  async function remove(p: ProjectSummary) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
      // 404: already gone, which is what was asked for.
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `could not delete (${res.status})`);
      }
      setConfirming(null);
      router.refresh();
    } catch (err) {
      setError({ id: p.id, message: (err as Error).message });
    }
    setBusy(false);
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {projects.map((p) => (
        <li key={p.id} className="flex flex-col gap-2 rounded border p-3">
          <Link href={`/project/${p.id}`} className="flex flex-col gap-2 hover:opacity-80">
            {p.closet ? (
              <ClosetElevation closet={p.closet} label={`Elevation of ${p.name}`} className="h-40 w-full rounded border bg-white" />
            ) : (
              <PlanThumbnail
                room={p.room}
                items={p.items}
                label={`Plan of ${p.name}`}
                className="h-40 w-full rounded border bg-white"
              />
            )}
            <span className="flex flex-col">
              <span className="flex items-center gap-2 font-medium">
                {p.name}
                {p.kind === 'closet' && <span className="rounded bg-violet-100 px-1.5 text-xs font-normal text-violet-800">Closet</span>}
              </span>
              <span className="text-sm text-gray-500">
                revision {p.revision} · {p.updatedAt.slice(0, 10)}
              </span>
            </span>
          </Link>

          {renaming === p.id ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void rename(p);
              }}
            >
              <input
                aria-label={`New name for ${p.name}`}
                className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
                value={draft}
                maxLength={200}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
              />
              <button type="submit" className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-40" disabled={busy || !draft.trim()}>
                Save
              </button>
              <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => setRenaming(null)}>
                Cancel
              </button>
            </form>
          ) : confirming === p.id ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Delete “{p.name}” and its photos for good?</span>
              <button type="button" className="rounded bg-red-700 px-3 py-1 text-white disabled:opacity-40" disabled={busy} onClick={() => remove(p)}>
                Yes, delete
              </button>
              <button type="button" className="rounded border px-3 py-1" onClick={() => setConfirming(null)}>
                Keep it
              </button>
            </div>
          ) : (
            <div className="flex gap-2 text-sm">
              <button
                type="button"
                className="rounded border px-3 py-1"
                aria-label={`Rename ${p.name}`}
                onClick={() => {
                  setRenaming(p.id);
                  setConfirming(null);
                  setError(null);
                  setDraft(p.name);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="rounded border px-3 py-1 text-red-700"
                aria-label={`Delete ${p.name}`}
                onClick={() => {
                  setConfirming(p.id);
                  setRenaming(null);
                  setError(null);
                }}
              >
                Delete
              </button>
            </div>
          )}

          {error?.id === p.id && (
            <p role="alert" className="text-sm text-red-700">
              Couldn’t do that: {error.message}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
