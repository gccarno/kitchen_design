'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Create a project and go straight to its page. */
export default function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { project?: { id: string }; error?: string };
      if (!res.ok || !body.project) throw new Error(body.error ?? `could not create project (${res.status})`);
      router.push(`/project/${body.project.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span>New project name</span>
        <input
          className="w-64 rounded border px-2 py-1"
          value={name}
          maxLength={200}
          placeholder="e.g. Home kitchen"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button type="submit" className="rounded bg-black px-4 py-2 text-white disabled:opacity-40" disabled={busy || !name.trim()}>
        {busy ? 'Creating…' : 'Create project'}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
