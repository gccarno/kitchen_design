'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOnline } from '@/lib/client/online';
import type { ProjectKind } from '@/lib/plan/schemas';
import { templatesForKind } from '@/lib/templates/info';

/** Create a project and go straight to its page. */
export default function NewProjectForm() {
  const router = useRouter();
  const online = useOnline();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProjectKind>('kitchen');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templates = templatesForKind(kind);
  const template = templates.find((t) => t.id === templateId);
  // A template names the project when the user hasn't.
  const projectName = name.trim() || template?.defaultProjectName || '';

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!projectName) return;
    await submit({ name: projectName, kind, ...(template ? { templateId: template.id } : {}) });
  }

  async function submit(request: { name: string; kind: ProjectKind; sample?: boolean; templateId?: string }) {
    if (busy || !online) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
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
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1">Design a</legend>
        <div className="flex rounded border">
          {(
            [
              ['kitchen', 'Kitchen'],
              ['closet', 'Closet'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={`cursor-pointer px-3 py-1 ${kind === value ? 'bg-black text-white' : ''}`}>
              <input
                type="radio"
                name="kind"
                value={value}
                className="sr-only"
                checked={kind === value}
                onChange={() => {
                  setKind(value);
                  setTemplateId('');
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        <span>New project name</span>
        <input
          className="w-64 rounded border px-2 py-1"
          value={name}
          maxLength={200}
          placeholder={kind === 'closet' ? 'e.g. Bedroom closet' : 'e.g. Home kitchen'}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Start from</span>
        <select className="w-64 rounded border px-2 py-1" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">{kind === 'closet' ? 'An empty closet' : 'An empty room'}</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="rounded bg-black px-4 py-2 text-white disabled:opacity-40" disabled={!online || busy || !projectName} title={online ? undefined : 'Offline'}>
        {busy ? 'Creating…' : 'Create project'}
      </button>
      <button
        type="button"
        className="rounded border px-4 py-2 disabled:opacity-40"
        disabled={!online || busy}
        title={online ? undefined : 'Offline'}
        onClick={() => submit({ name: kind === 'closet' ? 'Sample cleaning closet' : 'Sample kitchen', kind, sample: true })}
      >
        {kind === 'closet' ? 'Try a sample cleaning closet' : 'Try a sample kitchen'}
      </button>
      {template && <p className="w-full text-sm text-gray-600">{template.description}</p>}
      {error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
