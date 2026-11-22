'use client';

import React, { useEffect, useRef, useState } from 'react';
import { reportPickerLost, reportUploadFailure, uploadStep } from '@/lib/client/monitoring';
import { useOnline } from '@/lib/client/online';
import { shrinkPhoto } from '@/lib/client/shrink-photo';
import { photoUrl } from '@/lib/plan/photo-url';
import ReferenceMarker from './ReferenceMarker';
import type { ReferenceInput } from '@/lib/plan/reference-objects';
import type { Photo, ReferenceObject } from '@/lib/plan/schemas';
import { MAX_PHOTO_BYTES } from '@/app/api/upload/limits';
import { MAX_PHOTO_LABEL, MAX_PHOTOS } from '@/lib/storage/limits';

export { MAX_PHOTOS };

interface PhotoCaptureProps {
  projectId: string;
  initialPhotos?: Photo[];
  /** Called with the full photo list after each upload or reference save. */
  onPhotosChange?: (photos: Photo[]) => void;
}

// A failed upload keeps its file, so it can be tried again without picking the photo a second time.
type UploadStatus =
  | { key: number; name: string; state: 'uploading' }
  /** `retry`: whether sending it again could work (not for a photo that is simply too big). */
  | { key: number; name: string; state: 'error'; error: string; file: File; retry: boolean };

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
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
 * Capture or pick room photos and upload them (shrunk in the browser first). They show as a
 * grid; tapping one opens it below, to say what it shows, mark a reference object, or remove it.
 * Two inputs because mobile browsers ignore `multiple` when `capture` is set: "Take photo"
 * opens the camera, "Choose photos" opens the library.
 */
export default function PhotoCapture({ projectId, initialPhotos = [], onPhotosChange }: PhotoCaptureProps) {
  const online = useOnline();
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  // Photos whose reference marker is open. Marking is optional, so it starts closed: an open
  // marker fills the screen and its drawing surface can't be swiped to scroll the page.
  const [marking, setMarking] = useState<Set<string>>(new Set());
  // The photo opened from the grid (one at a time).
  const [openId, setOpenId] = useState<string | null>(null);
  const [lostPhoto, setLostPhoto] = useState(false);
  // The photo whose "remove?" question is showing, the one being removed, and a failed removal.
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ id: string; message: string } | null>(null);
  const full = photos.length >= MAX_PHOTOS;
  const canAdd = online && !full;
  const nextKey = useRef(0);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  // Saves (label, reference) are chained per photo so a fast second edit can't land
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
    const fail = (status: number, error: string, timedOut = false, retry = true) => {
      const durationMs = performance.now() - started;
      uploadStep('upload-failed', { status, sizeKB, ms: Math.round(durationMs), ...(timedOut ? { timedOut } : {}) });
      reportUploadFailure({ status, error, sizeBytes: file.size, mimeType: file.type, durationMs, ...(timedOut ? { timedOut } : {}) });
      setUploads((u) => u.map((x) => (x.key === key ? { key, name: file.name, state: 'error', error, file, retry } : x)));
    };
    if (file.size === 0) {
      fail(-1, 'the photo came through empty, please try again');
      return;
    }
    // The server only keeps a reduced copy, so reduce it here and save the user the upload.
    const shrunk = await shrinkPhoto(file);
    const toSend = shrunk === file ? file : new File([shrunk], file.name, { type: shrunk.type });
    if (toSend.size > MAX_PHOTO_BYTES) {
      // The server would refuse it after the whole upload (a 26 MB photo took 15 s on a phone to
      // come back 413). Happens when the browser can't decode the photo to shrink it.
      fail(413, `too big to upload (${mb(toSend.size)} MB, the most is ${mb(MAX_PHOTO_BYTES)} MB). Try a smaller copy, or a screenshot of it`, false, false);
      return;
    }
    uploadStep('upload-start', { sizeKB, sentKB: Math.round(toSend.size / 1024), type: file.type || 'unknown' });
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
      form.append('file', toSend);
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

  function retryUpload(key: number, file: File) {
    setUploads((u) => u.map((x) => (x.key === key ? { key, name: file.name, state: 'uploading' } : x)));
    void uploadOne(file, key);
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
    // Send only what fits: the server would refuse the rest (409) after each one's upload.
    // The rest stay listed with their file, so they can go once a photo is removed.
    const inFlight = uploads.filter((u) => u.state === 'uploading').length;
    const room = Math.max(0, MAX_PHOTOS - photos.length - inFlight);
    const extra = files.slice(room).map((file): UploadStatus => ({
      key: nextKey.current++,
      name: file.name,
      state: 'error',
      error: `didn't fit, a room can have at most ${MAX_PHOTOS} photos`,
      file,
      retry: true,
    }));
    if (extra.length > 0) {
      uploadStep('files-over-limit', { count: extra.length });
      setUploads((u) => [...u, ...extra]);
    }
    void uploadFiles(files.slice(0, room));
  }

  async function removePhoto(photoId: string) {
    if (!online || removing) return;
    setRemoving(photoId);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/photos/${photoId}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { photos?: Photo[]; error?: string };
      if (!res.ok || !body.photos) throw new Error(body.error ?? `could not remove (${res.status})`);
      // Filter locally rather than take the server's list, so an upload finishing meanwhile isn't dropped.
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      setConfirmingRemove(null);
    } catch (err) {
      setRemoveError({ id: photoId, message: (err as Error).message });
    } finally {
      setRemoving(null);
    }
  }

  function toggleMarking(photoId: string) {
    setMarking((s) => {
      const next = new Set(s);
      if (!next.delete(photoId)) next.add(photoId);
      return next;
    });
  }

  function saveReference(photoId: string, value: ReferenceInput | null) {
    const url = `${photoUrl(projectId, photoId)}/reference`;
    savePhoto(photoId, () => (value ? fetch(url, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(value) }) : fetch(url, { method: 'DELETE' })));
  }

  function saveLabel(photoId: string, label: string) {
    savePhoto(photoId, () => fetch(photoUrl(projectId, photoId), { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ label }) }));
  }

  /** Send one change to a photo's record; the answer is the photo as saved. */
  function savePhoto(photoId: string, send: () => Promise<Response>) {
    if (!online) return;
    const prev = saveChains.current.get(photoId) ?? Promise.resolve();
    const run = prev.then(async () => {
      setSaveState((s) => ({ ...s, [photoId]: 'saving' }));
      try {
        const res = await send();
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

  const opened = photos.find((p) => p.id === openId);
  const openedIndex = opened ? photos.indexOf(opened) : -1;
  const openedState = opened && saveState[opened.id];

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        Take 3–6 photos. Stand in each corner and shoot the walls opposite; keep the floor line and whole doors and windows in the frame.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`rounded bg-black px-4 py-2 text-white ${canAdd ? 'cursor-pointer' : 'opacity-40'}`} title={online ? undefined : 'Offline'}>
          Take photo
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={!canAdd}
            onClick={() => openPicker('camera')}
            onChange={handleFiles}
          />
        </label>
        <label className={`rounded border px-4 py-2 ${canAdd ? 'cursor-pointer' : 'opacity-40'}`} title={online ? undefined : 'Offline'}>
          Choose photos
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={!canAdd}
            onClick={() => openPicker('library')}
            onChange={handleFiles}
          />
        </label>
        {photos.length > 0 && <span className="text-sm text-gray-600">{`${photos.length} of ${MAX_PHOTOS} photos`}</span>}
      </div>

      {full && (
        <p className="text-sm text-gray-600">
          {MAX_PHOTOS} photos is the most a room can have. Remove one to add another.
        </p>
      )}

      {lostPhoto && (
        <p role="alert" className="text-sm text-red-600">
          Your last photo didn&apos;t come through. Please take it again.
        </p>
      )}

      {uploads.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {uploads.map((u) =>
            u.state === 'uploading' ? (
              <li key={u.key} className="text-gray-600">{`Uploading ${u.name}…`}</li>
            ) : (
              <li key={u.key} className="flex flex-wrap items-center gap-2 text-red-600">
                <span>{`${u.name}: ${u.error}`}</span>
                {u.retry && (
                  <button type="button" className="rounded border border-red-600 px-2 py-0.5 disabled:opacity-40" disabled={!canAdd} onClick={() => retryUpload(u.key, u.file)}>
                    Try again
                  </button>
                )}
                {u.retry && full && <span className="text-gray-600">Remove a photo to try again.</span>}
                <button type="button" className="underline" onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}>
                  Dismiss
                </button>
              </li>
            )
          )}
        </ul>
      )}

      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                aria-label={`Photo ${i + 1}${p.label ? `: ${p.label}` : ''}`}
                aria-expanded={p.id === openId}
                className={`relative block aspect-square w-full overflow-hidden rounded border-2 ${p.id === openId ? 'border-black' : 'border-transparent'}`}
                onClick={() => setOpenId((id) => (id === p.id ? null : p.id))}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- served by our API route, not a static asset */}
                <img src={photoUrl(projectId, p.id, 'thumb')} alt="Room photo" loading="lazy" className="h-full w-full object-cover" />
                {p.label && <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-left text-xs text-white">{p.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {opened && (
        <div className="flex flex-col gap-2 rounded border p-2">
          {marking.has(opened.id) ? (
            <ReferenceMarker
              key={`marker-${opened.id}`}
              imageUrl={photoUrl(projectId, opened.id)}
              value={toInput(opened.referenceObject)}
              onChange={(v) => saveReference(opened.id, v)}
              disabled={!online}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- served by our API route, not a static asset
            <img src={photoUrl(projectId, opened.id)} alt={`Photo ${openedIndex + 1}, full size`} className="block max-h-80 max-w-full self-start rounded" />
          )}
          <LabelField key={`label-${opened.id}`} saved={opened.label ?? ''} disabled={!online} onSave={(label) => saveLabel(opened.id, label)} />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button type="button" className="text-blue-700 underline" aria-expanded={marking.has(opened.id)} onClick={() => toggleMarking(opened.id)}>
              {marking.has(opened.id) ? 'Done marking' : opened.referenceObject ? 'Edit the marked object' : 'Mark a known-size object (optional)'}
            </button>
            {confirmingRemove === opened.id ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>Remove this photo for good?</span>
                <button
                  type="button"
                  className="rounded bg-red-700 px-3 py-1 text-white disabled:opacity-40"
                  disabled={!online || removing !== null}
                  onClick={() => void removePhoto(opened.id)}
                >
                  {removing === opened.id ? 'Removing…' : 'Yes, remove'}
                </button>
                <button type="button" className="rounded border px-3 py-1" onClick={() => setConfirmingRemove(null)}>
                  Keep it
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="text-red-700 underline disabled:opacity-40"
                disabled={!online}
                title={online ? undefined : 'Offline'}
                aria-label="Remove photo"
                onClick={() => {
                  setConfirmingRemove(opened.id);
                  setRemoveError(null);
                }}
              >
                Remove
              </button>
            )}
          </div>
          {removeError?.id === opened.id && (
            <p role="alert" className="text-xs text-red-600">
              Couldn’t remove: {removeError.message}
            </p>
          )}
          {openedState && (
            <p className={`text-xs ${typeof openedState === 'object' ? 'text-red-600' : 'text-gray-500'}`}>
              {openedState === 'saving' ? 'Saving…' : openedState === 'saved' ? 'Saved' : `Could not save: ${openedState.error}`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** The user's words for what a photo shows. Saved when the field is left (or on Enter), if it changed. */
function LabelField({ saved, disabled, onSave }: { saved: string; disabled: boolean; onSave: (label: string) => void }) {
  const [draft, setDraft] = useState(saved);
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>What does this photo show? (optional)</span>
      <input
        className="max-w-xs rounded border px-2 py-1"
        value={draft}
        maxLength={MAX_PHOTO_LABEL}
        disabled={disabled}
        placeholder="e.g. sink wall"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() !== saved) onSave(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
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
