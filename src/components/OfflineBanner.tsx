'use client';

import React from 'react';
import { useOnline } from '@/lib/client/online';

/** Shown on every page while offline; editing controls disable themselves. */
export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      You&apos;re offline — viewing saved data. Editing is disabled.
    </div>
  );
}
