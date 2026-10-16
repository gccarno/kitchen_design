// @vitest-environment node
/**
 * The runner has no request: it must act as the job's OWNER. User A's job
 * runs against A's projects only; naming user B's project fails it as
 * not found and leaves B's project untouched.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { z } from 'zod';
import { resetTestDb, sharedTestDb } from '../db/test-db';
import type { Db } from '../db/types';
import { createUser } from '../auth/users';
import type { LLMProvider } from '../llm';
import { getStorageFor, newProject } from '../storage';
import { getJobStore } from './index';
import { runJob } from './run';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../db/client', () => ({ getDb: () => state.db }));

/** Answers every text call with a reply naming the project it was asked about. */
function replyingProvider(): LLMProvider & { prompts: string[] } {
  return {
    prompts: [],
    async completeText() {
      throw new Error('unused');
    },
    async chatWithVision() {
      throw new Error('unused');
    },
    async completeJSON<T>(req: { user: string; schema: z.ZodType<T, z.ZodTypeDef, unknown> }) {
      this.prompts.push(req.user);
      return req.schema.parse({ commands: [], summary: '', reply: 'ok' });
    },
  };
}

let db: Db;
let dir: string;
beforeAll(async () => {
  db = await sharedTestDb();
  state.db = db;
});
beforeEach(async () => {
  await resetTestDb(db);
  dir = mkdtempSync(join(tmpdir(), 'kd-run-owner-'));
  vi.stubEnv('DATABASE_URL', 'postgres://test');
  vi.stubEnv('DATA_DIR', dir);
  vi.stubEnv('GCS_BUCKET', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('runJob storage ownership', () => {
  it("runs against the job owner's storage and never touches another user's project", async () => {
    const a = await createUser(db, 'a@example.com', 'a-good-password');
    const b = await createUser(db, 'b@example.com', 'b-good-password');
    const aStorage = await getStorageFor(a.id);
    const bStorage = await getStorageFor(b.id);
    const aProject = newProject({ name: 'A kitchen' });
    const bProject = newProject({ name: 'B kitchen' });
    await aStorage.projects.insert(aProject);
    await bStorage.projects.insert(bProject);
    const bBefore = await bStorage.projects.load(bProject.id);

    const aJobs = await getJobStore(a.id);
    const own = await aJobs.create(aProject.id, 'refine', { message: 'hi' });
    const foreign = await aJobs.create(bProject.id, 'refine', { message: 'hi' });
    const provider = replyingProvider();

    await runJob(own.id, { provider });
    await runJob(foreign.id, { provider });

    expect((await aJobs.get(own.id))!.status).toBe('done');
    expect(provider.prompts).toHaveLength(1);
    expect(provider.prompts[0]).toContain('A kitchen');
    expect((await aJobs.get(foreign.id))!.error).toEqual({ status: 404, error: 'project not found' });
    expect(await bStorage.projects.load(bProject.id)).toEqual(bBefore);
    // B cannot see A's jobs either.
    expect(await (await getJobStore(b.id)).get(own.id)).toBeNull();
  });
});
