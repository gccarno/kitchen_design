import { providerFromEnv, type LLMProvider } from '../llm';
import { getStorageFor } from '../storage';
import { toJobError } from './errors';
import { runExtract, runRefine } from './handlers';
import { getJobStore, jobOwner } from './index';

export type RunDeps = { provider?: LLMProvider };

/**
 * Execute job `jobId` to completion: claim it (a no-op if another runner
 * already did, so a job runs at most once per queueing), load its project,
 * run the handler, then store the result or the mapped error. Never throws;
 * once claimed, every failure ends the job `failed`, never stuck `running`.
 */
export async function runJob(jobId: string, deps: RunDeps = {}): Promise<void> {
  try {
    const owner = await jobOwner(jobId);
    if (!owner) return;
    const store = await getJobStore(owner.userId);
    const job = await store.claim(jobId);
    if (!job) return;
    try {
      const storage = await getStorageFor(owner.userId);
      const project = await storage.projects.load(job.projectId);
      if (!project) {
        await store.fail(jobId, { status: 404, error: 'project not found' });
        return;
      }
      const provider = deps.provider ?? providerFromEnv();
      const args = { storage, project, input: job.input, provider };
      const result = job.kind === 'extract' ? await runExtract(args) : await runRefine(args);
      await store.complete(jobId, result);
    } catch (err) {
      await store.fail(jobId, toJobError(err, job.kind));
    }
  } catch (err) {
    console.error(`runJob failed: ${err instanceof Error ? err.name : typeof err}`);
  }
}
