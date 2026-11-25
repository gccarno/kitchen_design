import { providerFromEnv, type LLMProvider } from '../llm';
import type { ProviderConfig } from '../llm/provider';
import type { LLMCallEvent } from '../llm/log';
import type { ReasoningTrace } from '../llm/reasoning';
import { reportJobFailure } from '../monitoring';
import { getStorageFor } from '../storage';
import { providerDetail, toJobError } from './errors';
import { runExtract, runRefine, type HandlerArgs } from './handlers';
import { getJobStore, jobOwner, type JobKind } from './index';

export type RunDeps = {
  provider?: LLMProvider;
  /** Builds the provider with the job's recorders (default: providerFromEnv). */
  makeProvider?: (extra: Pick<ProviderConfig, 'onCall' | 'onReasoning'>) => LLMProvider;
};

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
    /** This job's LLM attempts, for the failure report. */
    const calls: LLMCallEvent[] = [];
    /** The models' reasoning behind each answer, kept with the result (never logged). */
    const reasoning: ReasoningTrace[] = [];
    try {
      const storage = await getStorageFor(owner.userId);
      const project = await storage.projects.load(job.projectId);
      if (!project) {
        await store.fail(jobId, { status: 404, error: 'project not found' });
        return;
      }
      const provider =
        deps.provider ??
        (deps.makeProvider ?? providerFromEnv)({ onCall: (e) => calls.push(e), onReasoning: (t) => reasoning.push(t) });
      const args = { storage, project, input: job.input, provider };
      const result = await runHandler(job.kind, args);
      await store.complete(jobId, withReasoning(result, reasoning));
    } catch (err) {
      const detail = providerDetail(calls);
      const jobError = { ...toJobError(err, job.kind), ...(detail ? { detail } : {}), ...(reasoning.length ? { reasoning } : {}) };
      reportJobFailure(err, { jobId, kind: job.kind, projectId: job.projectId, status: jobError.status, error: jobError.error, calls });
      try {
        await store.fail(jobId, jobError);
      } catch (failErr) {
        // The store itself is failing; the stale-job rule recovers the job on a later poll.
        console.error(`runJob could not record failure: ${errorName(failErr)}`);
      }
    }
  } catch (err) {
    console.error(`runJob failed: ${errorName(err)}`);
  }
}

/** The handler's result with the models' reasoning added as `reasoning`, when there is any. */
function withReasoning(result: unknown, reasoning: ReasoningTrace[]): unknown {
  if (reasoning.length === 0 || typeof result !== 'object' || result === null || Array.isArray(result)) return result;
  return { ...result, reasoning };
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
