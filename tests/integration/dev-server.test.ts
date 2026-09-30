// @vitest-environment node
/**
 * Integration check: drive the live Next.js dev server end-to-end
 * with a real multipart upload. Verifies the bytes hit disk and
 * the response is well-formed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createProject, loadProject, projectDir } from '@/lib/storage/projects';
import { planToJsonPatch } from '@/lib/plan/diff';
import { validatePlan, wallLengthMm } from '@/lib/plan/validate';
import type { Project, Room } from '@/lib/plan/schemas';

let server: ChildProcess | null = null;
let dataDir: string;

/**
 * A fake OpenAI-compatible LLM. The dev server's LLM_BASE_URL points here,
 * so the real provider code runs over real HTTP. Records every request.
 */
let fakeLlm: Server;
const llmRequests: Array<{ auth?: string; body: { model: string; messages: Array<{ content: unknown }> } }> = [];
const FAKE_ROOM = {
  confidence: 0.75,
  polygonMm: [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ],
  walls: [{ thicknessMm: 120 }, { thicknessMm: 120 }, { thicknessMm: 120 }, { thicknessMm: 120 }],
  openings: [{ wallIdx: 1, kind: 'window', positionMm: 500, widthMm: 1200, heightMm: 1000 }],
  measuredWalls: [0],
  notes: 'from the fake LLM',
};

const FAKE_REFINE = {
  commands: [{ type: 'addItem', catalogId: 'dishwasher-600', wall: 'w1', alongMm: 1500 }],
  summary: 'Add a dishwasher on the north wall',
  reply: 'Added a 600 mm dishwasher, centred on the north wall.',
};

async function startFakeLlm(): Promise<string> {
  fakeLlm = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      llmRequests.push({ auth: req.headers.authorization, body });
      // Answer refine prompts with commands, everything else with a room outline.
      const isRefine = String(body.messages[0]?.content ?? '').includes('You edit kitchen floor plans');
      const answer = isRefine ? FAKE_REFINE : FAKE_ROOM;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
    });
  });
  await new Promise<void>((r) => fakeLlm.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(fakeLlm.address() as AddressInfo).port}/v1`;
}
// Use a different port for the integration suite to avoid colliding with
// any leftover dev server. Picked randomly; the suite reaps it on exit.
const PORT = 3100 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'kd-e2e-'));
  const llmBaseUrl = await startFakeLlm();
  // Run Next's CLI with node directly: no npx/shell wrapper whose death
  // would orphan the real server. `detached` gives it its own process group
  // on POSIX so teardown can kill the whole tree.
  const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
  server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      NEXT_TELEMETRY_DISABLED: '1',
      LLM_BASE_URL: llmBaseUrl,
      LLM_API_KEY: 'fake-key',
      LLM_VISION_MODEL: 'fake-vision',
    },
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

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

/**
 * Kill the dev server and every child it started. `next dev` forks a
 * separate start-server process, so killing only the top pid leaks it.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Group already gone.
    }
  }
}

afterAll(async () => {
  await new Promise((r) => fakeLlm?.close(r));
  // Always reap the server + data dir, even if a test threw.
  if (server) {
    const exited = new Promise<void>((resolve) => {
      if (server?.exitCode !== null) resolve();
      server?.on('exit', () => resolve());
    });
    killTree(server);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
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

  it('uploads a photo, registers it, serves it back, and stores a reference', async () => {
    const p = createProject(dataDir, { name: 'Integration' });

    const jpeg = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    const form = new FormData();
    form.append('projectId', p.id);
    form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'room.jpg');

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

    // Registered on the project document.
    expect(loadProject(dataDir, p.id).photos.map((ph) => ph.id)).toEqual([body.photo.id]);

    // Served back through the photo route.
    const photoUrl = `${BASE}/api/projects/${p.id}/photos/${body.photo.id}`;
    const img = await fetch(photoUrl);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect((await sharp(Buffer.from(await img.arrayBuffer())).metadata()).width).toBe(640);

    // Reference stored with the server-resolved size.
    const put = await fetch(`${photoUrl}/reference`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'credit_card', side: 'long', pixelBox: [100, 100, 271, 208] }),
    });
    expect(put.status).toBe(200);
    expect(loadProject(dataDir, p.id).photos[0].referenceObject).toEqual({
      kind: 'credit_card',
      side: 'long',
      knownSizeMm: 85.6,
      pixelBox: [100, 100, 271, 208],
    });
  });

  it('rejects a path-traversal project id', async () => {
    const form = new FormData();
    form.append('projectId', '../../outside');
    form.append('file', new Blob([new Uint8Array(4)], { type: 'image/jpeg' }), 'x.jpg');
    const res = await fetch(BASE + '/api/upload', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('creates a project and saves a sketched 3000 × 4000 room without calling the LLM', async () => {
    const llmCallsBefore = llmRequests.length;
    const created = await fetch(BASE + '/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Sketched' }),
    });
    expect(created.status).toBe(201);
    const { project } = (await created.json()) as { project: Project };

    // What RoomSketch's rectangle quick start produces.
    const room: Room = {
      polygon: [
        [0, 0],
        [3000, 0],
        [3000, 4000],
        [0, 4000],
      ],
      walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
      openings: [],
      measurements: [
        { wallId: 'a', lengthMm: 3000, source: 'user' },
        { wallId: 'b', lengthMm: 4000, source: 'user' },
      ],
    };
    const res = await fetch(`${BASE}/api/projects/${project.id}/revisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseRevision: project.revision,
        patch: planToJsonPatch(project, { ...project, room }),
        summary: 'sketch room',
      }),
    });
    expect(res.status).toBe(200);

    const saved = loadProject(dataDir, project.id);
    expect(saved.revision).toBe(1);
    expect(saved.room).toEqual(room);
    expect(wallLengthMm(saved.room, 0)).toBe(3000);
    expect(saved.history[0]).toMatchObject({ source: 'user', summary: 'sketch room' });
    expect(validatePlan(saved).valid).toBe(true);
    expect(llmRequests.length).toBe(llmCallsBefore);
  });

  it('extracts a room through the real provider over HTTP, then commits it', async () => {
    const p = createProject(dataDir, { name: 'Extract' });
    const jpeg = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 90, g: 90, b: 90 } },
    })
      .jpeg()
      .toBuffer();
    const form = new FormData();
    form.append('projectId', p.id);
    form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'room.jpg');
    expect((await fetch(BASE + '/api/upload', { method: 'POST', body: form })).status).toBe(201);

    const before = llmRequests.length;
    const res = await fetch(`${BASE}/api/projects/${p.id}/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ measurements: [{ description: 'sink wall', lengthMm: 3600 }] }),
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as { room: Room; patch: unknown[]; baseRevision: number; notes: string };
    expect(result.notes).toBe('from the fake LLM');
    expect(wallLengthMm(result.room, 0)).toBeCloseTo(3600);

    // What actually went over the wire to the LLM.
    expect(llmRequests.length).toBe(before + 1);
    const sent = llmRequests[before];
    expect(sent.auth).toBe('Bearer fake-key');
    expect(sent.body.model).toBe('fake-vision');
    const parts = sent.body.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    const images = parts.filter((c) => c.type === 'image_url');
    expect(images).toHaveLength(1);
    const sentJpeg = Buffer.from(images[0].image_url!.url.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
    expect((await sharp(sentJpeg).metadata()).width).toBe(1568);

    // Nothing changed until the user confirms.
    expect(loadProject(dataDir, p.id).revision).toBe(0);
    const committed = await fetch(`${BASE}/api/projects/${p.id}/revisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: result.baseRevision, patch: result.patch, summary: 'extract', source: 'llm' }),
    });
    expect(committed.status).toBe(200);
    expect(loadProject(dataDir, p.id).room).toEqual(result.room);
  });

  it('turns a chat request into commands via the real provider, then commits them', async () => {
    const p = createProject(dataDir, { name: 'Refine' });
    const before = llmRequests.length;
    const res = await fetch(`${BASE}/api/projects/${p.id}/refine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'add a dishwasher on the north wall' }),
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as { patch: unknown[]; baseRevision: number; summary: string; reply: string };
    expect(result.reply).toMatch(/dishwasher/);

    // The prompt the model saw: plan refs, catalog, and the request; text model, JSON mode.
    const sent = llmRequests[before];
    expect(sent.body.model).not.toBe('fake-vision');
    const user = String(sent.body.messages[1].content);
    expect(user).toContain('- w1: north wall');
    expect(user).toContain('- dishwasher-600: Dishwasher (600 mm)');
    expect(user).toMatch(/Request: add a dishwasher on the north wall$/);

    expect(loadProject(dataDir, p.id).items).toEqual([]); // nothing until the user applies
    const committed = await fetch(`${BASE}/api/projects/${p.id}/revisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: result.baseRevision, patch: result.patch, summary: result.summary, source: 'llm' }),
    });
    expect(committed.status).toBe(200);
    expect(loadProject(dataDir, p.id).items[0]).toMatchObject({
      catalogId: 'dishwasher-600',
      position: { x: 1500, y: 290 },
      rotationDeg: 0,
    });
  });
});
