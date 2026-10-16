'use client';

import { useEffect } from 'react';

/** Registers the offline service worker in production builds only (dev and Playwright stay unaffected). */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    try {
      navigator.serviceWorker?.register('/sw.js')?.catch(() => {});
    } catch {
      /* unsupported or blocked */
    }
  }, []);
  return null;
}
