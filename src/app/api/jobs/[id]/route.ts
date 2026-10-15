import { NextResponse } from 'next/server';
import { getJobStore, type Job } from '@/lib/jobs';
import { ensureProgress } from '@/lib/jobs/dispatch';
import { getRequestStorage } from '@/lib/storage';
import { withUnauthorized } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const noStore = { 'Cache-Control': 'no-store' };

/** What a poll sees: no input, owner or timestamps. */
function view(job: Job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    ...(job.status === 'done' ? { result: job.result } : {}),
    ...(job.status === 'failed' && job.error ? { error: job.error } : {}),
  };
}

/**
 * GET /api/jobs/[id] — poll an extract/refine job started with a 202 { jobId }.
 *   200 { id, kind, status: queued|running|done|failed, result? (done), error? (failed: { status, error, issues? }) }
 *   404 unknown, another user's, or non-UUID id (in disk mode, also a job lost to a restart)
 * Polling also recovers a stuck job (re-queues and re-dispatches it; see ensureProgress).
 */
async function handleGet(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const { userId } = await getRequestStorage();
  const store = await getJobStore(userId);
  let job = await store.get(id);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404, headers: noStore });
  if (job.status === 'queued' || job.status === 'running') {
    try {
      if ((await ensureProgress(job)) !== 'noop') job = (await store.get(id)) ?? job;
    } catch (err) {
      // Recovery is best effort; the next poll tries again.
      console.error(`job recovery failed: ${err instanceof Error ? err.name : typeof err}`);
    }
  }
  return NextResponse.json(view(job), { headers: noStore });
}

export const GET = withUnauthorized(handleGet);
