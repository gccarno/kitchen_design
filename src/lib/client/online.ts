'use client';

import { useSyncExternalStore } from 'react';

/** Set by a failed fetch on a connection that still reports onLine; cleared by the next online event or markOnline(). */
let forcedOffline = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onOnline = () => {
    forcedOffline = false;
    emit();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', listener);
  };
}

const getSnapshot = () => !forcedOffline && navigator.onLine;
const getServerSnapshot = () => true;

/** Whether the browser can reach the network (window events plus navigator.onLine). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Call when a fetch fails with a network error (TypeError). */
export function markOffline(): void {
  if (forcedOffline) return;
  forcedOffline = true;
  emit();
}

/** Call when a fetch succeeded. */
export function markOnline(): void {
  if (!forcedOffline) return;
  forcedOffline = false;
  emit();
}
