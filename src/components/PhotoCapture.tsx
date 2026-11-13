'use client';

import React, { useEffect, useRef, useState } from 'react';
import { reportPickerLost, reportUploadFailure, uploadStep } from '@/lib/client/monitoring';
import { useOnline } from '@/lib/client/online';
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
type PickerSource = 'camera' | 'library';

/** An upload that hasn't answered after this long is given up on (and reported). */
export const UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;
/** Set while the camera or picker is open; still there after a reload means its result was lost. */
export const PICKER_PENDING_KEY = 'photo-picker-pending';
const PICKER_LOST_WINDOW_MS = 10 * 60 * 1000;

// localStorage, not sessionStorage: Android may hand a killed app back in a new WebView, which
// starts a new session. It can throw (private mode, blocked storage): the marker is best-effort.
function readPending(): { source: string; at: number } | null {
  try {
    const raw = localStorage.getItem(PICKER_PENDING_KEY);
    return raw ? (JSON.parse(raw) as { source: string; at: number }) : null;
  } catch {
    return null;
  }
}
function writePending(source: PickerSource) {
  try {
    localStorage.setItem(PICKER_PENDING_KEY, JSON.stringify({ source, at: Date.now() }));
  } catch {}
}
function clearPending() {
  try {
    localStorage.removeItem(PICKER_PENDING_KEY);
  } catch {}
}

/**
 * Capture or pick room photos, upload them, and mark a reference object on
 * each. Two inputs because mobile browsers ignore `multiple` when `capture`
 * is set: "Take photo" opens the camera, "Choose photos" opens the library.
 */
export default function PhotoCapture({ projectId, initialPhotos = [], onPhotosChange }: PhotoCaptureProps) {
  const online = useOnline();
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  // Photos whose reference marker is open. Marking is optional, so it starts closed: an open
  // marker fills the screen and its drawing surface can't be swiped to scroll the page.
  const [marking, setMarking] = useState<Set<string>>(new Set());
  const [lostPhoto, setLostPhoto] = useState(false);
  const nextKey = useRef(0);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  // Reference saves are chained per photo so a fast second edit can't land
  // before the first and be overwritten by it.
  const saveChains = useRef(new Map<string, Promise<void>>());

  // Report changes, but not the initial list the parent passed in.
  const initialRef = useRef(photos);
  useEffect(() => {
    if (photos !== initialRef.current) onPhotosChange?.(photos);
  }, [photos, onPhotosChange]);

  // The camera or picker was opened and the page has been reloaded since, without its result
  // arriving: Android closed the app while the camera was in front. Report it and tell the user.
  useEffect(() => {
    const pending = readPending();
    if (pending) {
      clearPending();
      const ageMs = Date.now() - pending.at;
      if (ageMs >= 0 && ageMs < PICKER_LOST_WINDOW_MS) {
        reportPickerLost({ source: pending.source, ageMs });
        setLostPhoto(true);
      }
    }
    // Leaving the page normally (unmount) means nothing was lost.
    return clearPending;
  }, []);

  // Closing the picker without choosing fires `cancel` (no React prop for it on inputs).
  useEffect(() => {
    const inputs = [cameraRef.current, libraryRef.current].filter((i): i is HTMLInputElement => !!i);
    const onCancel = () => {
      clearPending();
      uploadStep('picker-cancelled');
    };
    inputs.forEach((i) => i.addEventListener('cancel', onCancel));
    return () => inputs.forEach((i) => i.removeEventListener('cancel', onCancel));
  }, []);

  async function uploadOne(file: File, key: number) {
    const started = performance.now();
    const sizeKB = Math.round(file.size / 1024);
    const fail = (status: number, error: string, timedOut = false) => {
      const durationMs = performance.now() - started;
      uploadStep('upload-failed', { status, sizeKB, ms: Math.round(durationMs), ...(timedOut ? { timedOut } : {}) });
      reportUploadFailure({ status, error, sizeBytes: file.size, mimeType: file.type, durationMs, ...(timedOut ? { timedOut } : {}) });
      setUploads((u) => u.map((x) => (x.key === key ? { key, name: file.name, state: 'error', error } : x)));
    };
    if (file.size === 0) {
      fail(-1, 'the photo came through empty, please try again');
      return;
    }
    uploadStep('upload-start', { sizeKB, type: file.type || 'unknown' });
    const abort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, UPLOAD_TIMEOUT_MS);
    let status = 0; // stays 0 when no response arrives
    try {
      const form = new FormData();
      form.append('projectId', projectId);
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form, signal: abort.signal });
      status = res.status;
      const body = (await res.json().catch(() => ({}))) as { photo?: Photo; error?: string };
      if (!res.ok || !body.photo) throw new Error(body.error ?? `upload failed (${res.status})`);
      const uploaded = body.photo;
      uploadStep('upload-done', { status, sizeKB, ms: Math.round(performance.now() - started) });
      setPhotos((prev) => [...prev, uploaded]);
      setUploads((u) => u.filter((x) => x.key !== key));
    } catch (err) {
      if (timedOut) fail(0, 'upload timed out, check your connection and try again', true);
      else fail(status, (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  async function uploadFiles(files: File[]) {
    // Sequential: keeps order stable and memory low on phones.
    for (const file of files) {
      const key = nextKey.current++;
      setUploads((u) => [...u, { key, name: file.name, state: 'uploading' }]);
      await uploadOne(file, key);
    }
  }

  function openPicker(source: PickerSource) {
    writePending(source);
    uploadStep('picker-open', { source });
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    clearPending();
    setLostPhoto(false);
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-selecting the same file
    if (files.length === 0) {
      uploadStep('picker-cancelled');
      return;
    }
    uploadStep('files-picked', {
      count: files.length,
      sizeKB: Math.round(files.reduce((n, f) => n + f.size, 0) / 1024),
      types: [...new Set(files.map((f) => f.type || 'unknown'))].join(','),
    });
    void uploadFiles(files);
  }

  function toggleMarking(photoId: string) {
    setMarking((s) => {
      const next = new Set(s);
      if (!next.delete(photoId)) next.add(photoId);
      return next;
    });
  }

  function saveReference(photoId: string, value: ReferenceInput | null) {
    if (!online) return;
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
        <label className={`rounded bg-black px-4 py-2 text-white ${online ? 'cursor-pointer' : 'opacity-40'}`} title={online ? undefined : 'Offline'}>
          Take photo
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={!online}
            onClick={() => openPicker('camera')}
            onChange={handleFiles}
          />
        </label>
        <label className={`rounded border px-4 py-2 ${online ? 'cursor-pointer' : 'opacity-40'}`} title={online ? undefined : 'Offline'}>
          Choose photos
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={!online}
            onClick={() => openPicker('library')}
            onChange={handleFiles}
          />
        </label>
      </div>

      {lostPhoto && (
        <p role="alert" className="text-sm text-red-600">
          Your last photo didn&apos;t come through. Please take it again.
        </p>
      )}

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
        const imageUrl = `/api/projects/${projectId}/photos/${p.id}`;
        const open = marking.has(p.id);
        return (
          <div key={p.id} className="flex flex-col gap-1">
            {open ? (
              <ReferenceMarker
                imageUrl={imageUrl}
                value={toInput(p.referenceObject)}
                onChange={(v) => saveReference(p.id, v)}
                disabled={!online}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- served by our API route, not a static asset
              <img src={imageUrl} alt="Room photo" className="block max-h-64 max-w-full self-start rounded" />
            )}
            <button
              type="button"
              className="self-start text-sm text-blue-700 underline"
              aria-expanded={open}
              onClick={() => toggleMarking(p.id)}
            >
              {open ? 'Done marking' : p.referenceObject ? 'Edit the marked object' : 'Mark a known-size object (optional)'}
            </button>
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
