'use client';

import React, { useState } from 'react';
import { clearOfflineCaches } from '@/lib/client/offline-cache';

/** Signed-in email plus a Sign out button; POSTs the logout route, then goes to /login. */
export default function SignOutButton({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch {
      // Navigate regardless; /login sends a still-valid session back to /.
    }
    await clearOfflineCaches();
    // A full load on purpose: nothing from the signed-in session may survive in the router's cache.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/login');
  }
  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <span>{email}</span>
      <button type="button" onClick={signOut} disabled={busy} className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-100 disabled:opacity-50">
        Sign out
      </button>
    </div>
  );
}
