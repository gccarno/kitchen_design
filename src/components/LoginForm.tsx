'use client';

import React, { useState } from 'react';
import { safeNextPath } from '@/lib/auth/next-path';

/** Sign-in / create-account form. "Create account" shows only when the server says registration is open. */
export default function LoginForm({ next, canRegister }: { next?: string; canRegister: boolean }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        // Full navigation, so the new cookie reaches the middleware and server components.
        window.location.assign(safeNextPath(next));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Something went wrong (${res.status})`);
    } catch {
      setError('Could not reach the server');
    }
    setBusy(false);
  }

  const registering = mode === 'register';
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h1 className="text-3xl font-semibold">{registering ? 'Create account' : 'Sign in'}</h1>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          required
          minLength={registering ? 10 : undefined}
          autoComplete={registering ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>
      {registering && <p className="text-xs text-gray-600">At least 10 characters.</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50">
        {registering ? 'Create account' : 'Sign in'}
      </button>
      {canRegister && (
        <button
          type="button"
          onClick={() => {
            setMode(registering ? 'login' : 'register');
            setError(null);
          }}
          className="text-sm text-gray-600 underline"
        >
          {registering ? 'I already have an account' : 'Create account'}
        </button>
      )}
    </form>
  );
}
