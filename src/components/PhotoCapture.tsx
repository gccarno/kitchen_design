'use client';

import React, { useEffect, useRef, useState } from 'react';
import ReferenceMarker from './ReferenceMarker';
import type { ReferenceInput } from '@/lib/plan/reference-objects';
import type { Photo, ReferenceObject } from '@/lib/plan/schemas';

interface PhotoCaptureProps {
  projectId: string;
  initialPhotos?: Photo[];
  /** Called with the full photo list after each upload or reference save. */
  onPhotosChange?: (photos: Photo[]) => void;
}

type UploadStatus = { key: number; name: string; state: 'uploading' } | { key: number; name: string; state: 'error'; error: string };
type SaveState = 'saving' | 'saved' | { error: string };

/**
 * Capture or pick room photos, upload them, and mark a reference object on
 * each. Two inputs because mobile browsers ignore `multiple` when `capture`
 * is set: "Take photo" opens the camera, "Choose photos" opens the library.
 */
export default function PhotoCapture({ projectId, initialPhotos = [], onPhotosChange }: PhotoCaptureProps) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const nextKey = useRef(0);
  // Reference saves are chained per photo so a fast second edit can't land
  // before the first and be overwritten by it.
  const saveChains = useRef(new Map<string, Promise<void>>());

  // Report changes, but not the initial list the parent passed in.
  const initialRef = useRef(photos);
  useEffect(() => {
    if (photos !== initialRef.current) onPhotosChange?.(photos);
  }, [photos, onPhotosChange]);

  async function uploadFiles(files: File[]) {
    // Sequential: keeps order stable and memory low on phones.
    for (const file of files) {
      const key = nextKey.current++;
      setUploads((u) => [...u, { key, name: file.name, state: 'uploading' }]);
      try {
        const form = new FormData();
        form.append('projectId', projectId);
        form.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: form });
        const body = (await res.json().catch(() => ({}))) as { photo?: Photo; error?: string };
        if (!res.ok || !body.photo) throw new Error(body.error ?? `upload failed (${res.status})`);
        const uploaded = body.photo;
        setPhotos((prev) => [...prev, uploaded]);
        setUploads((u) => u.filter((x) => x.key !== key));
      } catch (err) {
        const error = (err as Error).message;
        setUploads((u) => u.map((x) => (x.key === key ? { key, name: file.name, state: 'error', error } : x)));
      }
    }
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-selecting the same file
    if (files.length > 0) void uploadFiles(files);
  }

  function saveReference(photoId: string, value: ReferenceInput | null) {
    const url = `/api/projects/${projectId}/photos/${photoId}/reference`;
    const prev = saveChains.current.get(photoId) ?? Promise.resolve();
    const run = prev.then(async () => {
      setSaveState((s) => ({ ...s, [photoId]: 'saving' }));
      try {
        const res = value
          ? await fetch(url, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(value),
            })
          : await fetch(url, { method: 'DELETE' });
        const body = (await res.json().catch(() => ({}))) as { photo?: Photo; error?: string };
        if (!res.ok || !body.photo) throw new Error(body.error ?? `save failed (${res.status})`);
        const saved = body.photo;
        setPhotos((list) => list.map((p) => (p.id === photoId ? saved : p)));
        setSaveState((s) => ({ ...s, [photoId]: 'saved' }));
      } catch (err) {
        setSaveState((s) => ({ ...s, [photoId]: { error: (err as Error).message } }));
      }
    });
    saveChains.current.set(photoId, run);
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <label className="cursor-pointer rounded bg-black px-4 py-2 text-white">
          Take photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleFiles} />
        </label>
        <label className="cursor-pointer rounded border px-4 py-2">
          Choose photos
          <input type="file" accept="image/*" multiple className="sr-only" onChange={handleFiles} />
        </label>
      </div>

      {uploads.length > 0 && (
        <ul className="text-sm">
          {uploads.map((u) => (
            <li key={u.key} className={u.state === 'error' ? 'text-red-600' : 'text-gray-600'}>
              {u.state === 'uploading' ? `Uploading ${u.name}…` : `${u.name}: ${u.error}`}
            </li>
          ))}
        </ul>
      )}

      {photos.map((p) => {
        const state = saveState[p.id];
        return (
          <div key={p.id} className="flex flex-col gap-1">
            <ReferenceMarker
              imageUrl={`/api/projects/${projectId}/photos/${p.id}`}
              value={toInput(p.referenceObject)}
              onChange={(v) => saveReference(p.id, v)}
            />
            {state && (
              <p className={`text-xs ${typeof state === 'object' ? 'text-red-600' : 'text-gray-500'}`}>
                {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : `Could not save: ${state.error}`}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

function toInput(ref: ReferenceObject | undefined): ReferenceInput | null {
  if (!ref) return null;
  return {
    kind: ref.kind,
    side: ref.side,
    pixelBox: ref.pixelBox,
    ...(ref.kind === 'custom' ? { customSizeMm: ref.knownSizeMm } : {}),
  };
}
