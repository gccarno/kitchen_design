// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '../llm';
import { getStorageFor, newProject } from '../storage';
import { runExtract, runRefine } from './handlers';

const unused = async (): Promise<never> => {
  throw new Error('unused');
};
const provider: LLMProvider = { completeText: unused, completeJSON: unused, chatWithVision: unused };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kd-handlers-'));
  vi.stubEnv('DATA_DIR', dir);
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('GCS_BUCKET', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('handlers', () => {
  it('reject malformed input before calling the model', async () => {
    const storage = await getStorageFor(null);
    const project = newProject({ name: 'P' });
    await expect(runRefine({ storage, project, input: { message: '' }, provider })).rejects.toThrow();
    await expect(runExtract({ storage, project, input: { measurements: 'x' }, provider })).rejects.toThrow();
  });
});
