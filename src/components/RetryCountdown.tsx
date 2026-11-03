'use client';

import React, { useEffect, useState } from 'react';

/** Longer than this, show the time to come back rather than a ticking countdown. */
const COUNTDOWN_MAX_MS = 10 * 60 * 1000;

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * After a rate-limited request: a "Try again" button that unlocks once the
 * wait is over. It never retries by itself, so it can't burn the free quota.
 */
export default function RetryCountdown({
  retryAfterMs,
  onRetry,
  disabled = false,
}: {
  retryAfterMs: number;
  onRetry: () => void;
  disabled?: boolean;
}) {
  const [until] = useState(() => Date.now() + retryAfterMs);
  const [left, setLeft] = useState(retryAfterMs);

  const waiting = left > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setLeft(Math.max(0, until - Date.now())), 1000);
    return () => clearInterval(timer);
  }, [waiting, until]);

  const label = !waiting
    ? 'Try again'
    : left > COUNTDOWN_MAX_MS
      ? `Try again after ${new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : `Try again in ${clock(left)}`;
  return (
    <button
      type="button"
      className="self-start rounded border px-3 py-1 text-sm disabled:opacity-50"
      disabled={waiting || disabled}
      onClick={onRetry}
    >
      {label}
    </button>
  );
}
