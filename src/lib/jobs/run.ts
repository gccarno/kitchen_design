import { providerFromEnv, type LLMProvider } from '../llm';
import { getStorageFor } from '../storage';
import { toJobError } from './errors';
import { runExtract, runRefine, type HandlerArgs } from './handlers';
import { getJobStore, jobOwner, type JobKind } from './index';

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
      await store.complete(jobId, await runHandler(job.kind, args));
    } catch (err) {
      try {
        await store.fail(jobId, toJobError(err, job.kind));
      } catch (failErr) {
        // The store itself is failing; the stale-job rule recovers the job on a later poll.
        console.error(`runJob could not record failure: ${errorName(failErr)}`);
      }
    }
  } catch (err) {
    console.error(`runJob failed: ${errorName(err)}`);
  }
}

function runHandler(kind: JobKind, args: HandlerArgs): Promise<unknown> {
  switch (kind) {
    case 'extract':
      return runExtract(args);
    case 'refine':
      return runRefine(args);
    default: {
      const unknownKind: never = kind;
      throw new Error(`unknown job kind: ${String(unknownKind)}`);
    }
  }
}

const errorName = (err: unknown) => (err instanceof Error ? err.name : typeof err);
