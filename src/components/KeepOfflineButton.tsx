'use client';

import React, { useState } from 'react';
import { useOnline } from '@/lib/client/online';
import { cacheUrls } from '@/lib/client/offline-cache';

/**
 * "Keep offline": downloads a project's page, document and photos into the
 * offline caches so it can be opened (read-only) without a connection.
 */
export default function KeepOfflineButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const online = useOnline();
  const [state, setState] = useState<'idle' | 'busy' | { ok: boolean; photos: number }>('idle');

  async function keep() {
    if (state === 'busy' || !online) return;
    setState('busy');
    let photoIds: string[] = [];
    let docFailed = false;
    try {
      const res = await fetch(`/api/projects/${projectId}`, { credentials: 'same-origin' });
      if (res.ok) {
        const doc = (await res.json()) as { photos?: { id: string }[] };
        photoIds = (doc.photos ?? []).map((p) => p.id);
      } else docFailed = true;
    } catch {
      docFailed = true;
    }
    const photoUrls = photoIds.map((id) => `/api/projects/${projectId}/photos/${id}`);
    const { failed } = await cacheUrls([`/project/${projectId}`, `/api/projects/${projectId}`, ...photoUrls]);
    setState({ ok: failed === 0 && !docFailed, photos: photoIds.length });
  }

  const label =
    state === 'busy'
      ? 'Saving…'
      : state === 'idle'
        ? 'Keep offline'
        : state.ok
          ? `Saved offline (${state.photos} photo${state.photos === 1 ? '' : 's'})`
          : 'Some items failed';

  return (
    <button
      type="button"
      className="rounded border px-3 py-1 disabled:opacity-40"
      disabled={!online || state === 'busy'}
      title={online ? undefined : 'Offline'}
      aria-label={state === 'idle' ? `Keep ${projectName} offline` : undefined}
      onClick={() => void keep()}
    >
      {label}
    </button>
  );
}
