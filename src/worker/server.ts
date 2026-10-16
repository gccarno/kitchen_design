import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { jobOwner } from '../lib/jobs';
import { runJob } from '../lib/jobs/run';

export const MAX_CONCURRENT_JOBS = 2;

export type WorkerDeps = {
  token: string;
  /** Looks up a job's owner; null when the job does not exist. */
  owner?: (jobId: string) => Promise<unknown | null>;
  run?: (jobId: string) => Promise<void>;
  maxConcurrent?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

/**
 * `POST /run/:jobId` (bearer WORKER_TOKEN) acknowledges within the dispatcher's 2 s window and
 * runs the job in the background; `GET /health` reports liveness. The shared atomic claim makes a
 * repeated POST for the same job harmless.
 */
export function createWorkerServer(deps: WorkerDeps): Server {
  const owner = deps.owner ?? jobOwner;
  const run = deps.run ?? ((id: string) => runJob(id));
  const max = deps.maxConcurrent ?? MAX_CONCURRENT_JOBS;
  let active = 0;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === '/health') return reply(res, 200, { ok: true, active });
    const match = /^\/run\/([^/]+)$/.exec(path);
    if (req.method !== 'POST' || !match) return reply(res, 404, { error: 'not found' });
    if (!tokenMatches(req.headers.authorization, deps.token)) return reply(res, 401, { error: 'unauthorized' });
    const jobId = match[1];
    if (!UUID.test(jobId)) return reply(res, 404, { error: 'unknown job' });
    if (active >= max) return reply(res, 503, { error: 'busy' });
    if (!(await owner(jobId))) return reply(res, 404, { error: 'unknown job' });
    active++;
    void run(jobId)
      .catch((err: unknown) => console.error(`worker job failed: ${err instanceof Error ? err.name : typeof err}`))
      .finally(() => {
        active--;
      });
    return reply(res, 202, { accepted: true });
  };

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error(`worker request failed: ${err instanceof Error ? err.name : typeof err}`);
      if (!res.headersSent) reply(res, 500, { error: 'internal' });
    });
  });
}

if (require.main === module) {
  const token = process.env.WORKER_TOKEN;
  if (!token || !process.env.DATABASE_URL) {
    console.error('WORKER_TOKEN and DATABASE_URL are required');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8080);
  createWorkerServer({ token }).listen(port, () => console.log(`worker listening on :${port}`));
}
