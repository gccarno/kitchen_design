// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeProjectStore } from './contract';
import { FsProjectStore } from './fs-projects';

describeProjectStore('disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kd-fs-projects-'));
  return { store: new FsProjectStore(dir), teardown: async () => rmSync(dir, { recursive: true, force: true }) };
});
