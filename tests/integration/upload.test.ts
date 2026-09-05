// @vitest-environment node
/**
 * Integration check: drive the live Next.js dev server end-to-end
 * with a real multipart upload. Verifies the bytes hit disk and
 * the response is well-formed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createProject, projectDir } from '@/lib/storage/projects';

let server: ChildProcess | null = null;
let dataDir: string;
// Use a different port for the integration suite to avoid colliding with
// any leftover dev server. Picked randomly; the suite reaps it on exit.
const PORT = 3100 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'kd-e2e-'));
  server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['next', 'dev', '-p', String(PORT)],
    {
      env: { ...process.env, DATA_DIR: dataDir, NEXT_TELEMETRY_DISABLED: '1' },
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    }
  );

  // Wait for "Ready in" or up to 60s. If the process dies before
  // "Ready", surface that to the caller so the suite fails fast and
  // we don't leak an orphan.
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server?.stdout?.off('data', onData);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error('next dev did not start in 60s')));
    }, 60_000);
    const onData = (chunk: Buffer) => {
      const s = chunk.toString();
      if (s.includes('Ready in') || s.includes('✓ Ready')) {
        finish(resolve);
      }
    };
    server?.stdout?.on('data', onData);
    server?.on('exit', (code) => {
      finish(() => reject(new Error(`next dev exited early with code ${code}`)));
    });
    server?.on('error', (err) => {
      finish(() => reject(err));
    });
  });
}, 90_000);

afterAll(async () => {
  // Always reap the server + data dir, even if a test threw.
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        server?.kill('SIGKILL');
        resolve();
      }, 3000);
      server?.on('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

async function pollHome(): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(BASE + '/');
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

describe('dev server end-to-end', () => {
  it('serves the home page', async () => {
    expect(await pollHome()).toBe(true);
  });

  it('accepts a real photo upload and saves bytes to disk', async () => {
    const p = createProject(dataDir, { name: 'Integration' });

    const jpeg = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    const form = new FormData();
    form.append('projectId', p.id);
    form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'room.jpg');
    form.append('referenceKind', 'credit_card');

    const res = await fetch(BASE + '/api/upload', { method: 'POST', body: form });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      photo: { id: string; path: string; width: number; height: number };
    };
    expect(body.photo.width).toBe(640);
    expect(body.photo.height).toBe(480);
    expect(body.photo.path).toMatch(/^photos\/.+\.jpg$/);

    const filePath = join(projectDir(dataDir, p.id), body.photo.path);
    expect(existsSync(filePath)).toBe(true);
    const saved = readFileSync(filePath);
    const dims = await sharp(saved).metadata();
    expect(dims.width).toBe(640);
    expect(dims.height).toBe(480);

    // Sidecar reference metadata.
    const sidecar = join(projectDir(dataDir, p.id), 'photos', `${body.photo.id}.ref.json`);
    expect(existsSync(sidecar)).toBe(true);
    const meta = JSON.parse(readFileSync(sidecar, 'utf-8'));
    expect(meta).toEqual({ kind: 'credit_card', knownSizeMm: 85.6 });
  });
});
