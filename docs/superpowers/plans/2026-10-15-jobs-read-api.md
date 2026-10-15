# Read API and Async Jobs (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add `GET /api/projects` and `GET /api/projects/[id]`, and turn the two long LLM calls (extract, refine) into async jobs the client polls, so a phone connection never holds a request open for minutes. A job runs on the OCI worker when one answers, else inside the web process.

**Architecture:** A `jobs` table (Postgres) or an in-memory map (disk mode) holds `queued → running → done|failed` jobs, scoped by user. Routes validate synchronously (400/404/503 as today), create a job, start it, and return `202 {jobId}`. `GET /api/jobs/[id]` returns status and result. `runJob(jobId)` is the single handler both the web process and (Phase 5) the worker call. `dispatchJob` first POSTs to `WORKER_URL` (2 s timeout), else runs `runJob` in-process without blocking the response.

**Tech Stack:** Drizzle/PGlite (existing), Zod, existing `src/lib/llm/*`, fetch.

**Spec:** `docs/superpowers/specs/2026-10-14-mobile-cloud-design.md` (Phase 3). Branch from `main`: `feat/jobs`.

## Global Constraints

- Auth rules from Phase 2 hold: every job and read endpoint goes through `getStorage()` / the validated user; another user's job or project is **404**. `GET /api/jobs/[id]` is not public. Jobs are scoped by `user_id` (null in disk mode).
- **Ruling (recorded in spec):** the PDF export stays a synchronous `GET /api/export/[id]/pdf` (it takes about a second and is pure TS); only `extract` and `refine` (incl. closet refine) become jobs. Revisit if a PDF ever exceeds a few seconds.
- Synchronous validation stays synchronous: bad id 400, unknown project 404, bad body 400, no photos 400, LLM not configured 503 all return before any job is created, with today's exact messages. Only the LLM work moves into the job.
- Job statuses: `queued | running | done | failed`. Kinds: `extract | refine`. Result of a successful job is exactly today's 200 body (`extractRoom` result / `refinePlan`/`refineCloset` result). A failed job stores `{ status: <http-ish code 502|500|503>, error: string, issues?: unknown }` mirroring today's error responses, so the client shows the same messages.
- Stuck-job recovery: when a job is polled and `status='running'` and `started_at` is older than 5 minutes (changed from 15 in the final review: LLM calls are bounded at ~60 s plus one retry), it is re-queued (attempts < 3) and re-dispatched, else marked failed `{status:500,error:'job timed out'}`.
- Worker contract (implemented in Phase 5, only the client side here): `POST ${WORKER_URL}/run/${jobId}` with header `Authorization: Bearer ${WORKER_TOKEN}`, body `{}`; 2 s timeout; any non-2xx or error → fall back to in-process.
- Tests: Vitest on PGlite (`sharedTestDb`) and the in-memory store through one shared contract suite (as the storage layer does). `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run e2e` pass at the end of every task. Never commit `elevation-svg.test.ts.snap` / `example-layouts.test.ts.snap` if `npm test` rewrites them (git checkout them).
- Migrations via `npx drizzle-kit generate`; never apply to a real DB.
- Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Ci5vpeZ6daMwqsFnDbRH6w`.

## Review Focus

1. User B can never read, poll, or trigger user A's job (404) — polling an unknown/non-UUID id is 404, never 500.
2. Two pollers re-queueing a stuck job, or the web process and the worker both running a job: a job is executed at most once (claim is an atomic `queued→running` transition).
3. A job whose project was deleted or whose LLM call throws ends `failed` with a message, never stays `running`.
4. A server restart while a job is queued/running: it is re-queued by the stuck-job rule on next poll, not lost.
5. The client keeps working when the user navigates away and back (polling resumes from the jobId) and when the poll request itself fails once.

---

### Task 78: Read API

**Files:**
- Modify: `src/app/api/projects/route.ts` (add `GET`), `src/app/api/projects/[id]/route.ts` (add `GET`)
- Test: `src/app/api/projects/route.test.ts`, `src/app/api/projects/[id]/route.test.ts` (extend or create), extend `src/app/api/unauthorized.test.ts`

**Interfaces:**
- Produces: `GET /api/projects` → 200 `ProjectSummary[]` minus the heavy plan fields: `[{id,name,kind,revision,createdAt,updatedAt,optionOf?}]`, newest first, `Cache-Control: no-store`. `GET /api/projects/[id]` → 200 full project doc (the same JSON `loadProject` returns, with `history` omitted), 400 invalid id, 404 unknown or another user's; `no-store`. Both wrapped with `withUnauthorized`.

- [ ] **Step 1:** failing tests (list order + shape, doc without history, 404/400, unauthorized). **Step 2:** fail. **Step 3:** implement via `getStorage()`. **Step 4:** full checks. **Step 5:** Commit `feat(api): read endpoints for project list and project document`.

---

### Task 79: Job store

**Files:**
- Modify: `src/lib/db/schema.ts` (add `jobs`), create `drizzle/0002_*.sql` via `npx drizzle-kit generate`; extend `resetTestDb` to truncate `jobs`
- Create: `src/lib/jobs/types.ts`, `src/lib/jobs/store.ts` (interface + `JobNotFoundError`), `src/lib/jobs/mem-jobs.ts`, `src/lib/jobs/pg-jobs.ts`, `src/lib/jobs/contract.ts` (shared suite), `src/lib/jobs/index.ts` (`getJobStore(userId)`: Pg when `DATABASE_URL` set else a process-wide in-memory store keyed by user), tests `mem-jobs.test.ts`, `pg-jobs.test.ts`

**Interfaces:**
- `Job = { id: string; userId: string | null; projectId: string; kind: 'extract' | 'refine'; status: 'queued'|'running'|'done'|'failed'; input: unknown; result: unknown | null; error: JobError | null; attempts: number; createdAt: string; startedAt: string | null; finishedAt: string | null }`, `JobError = { status: number; error: string; issues?: unknown }`.
- Table `jobs(id uuid pk default gen_random_uuid(), user_id uuid null references users(id) on delete cascade, project_id uuid not null, kind text not null, status text not null, input jsonb not null, result jsonb, error jsonb, attempts int not null default 0, created_at/started_at/finished_at timestamptz)`, index on `(user_id, created_at)` and `(status, started_at)`.
- `JobStore` (owner-scoped like `ProjectStore`; one instance per user): `create(projectId, kind, input): Promise<Job>`; `get(id): Promise<Job | null>` (null for non-UUID or other user's); `claim(id): Promise<Job | null>` — atomically `queued → running` (sets `started_at`, `attempts+1`), null if not queued; `complete(id, result)`; `fail(id, error)`; `requeueStale(id, olderThanMs, maxAttempts): Promise<'requeued'|'failed'|'noop'>` — if running and `started_at` older than the threshold: back to `queued` when `attempts < maxAttempts`, else `failed` with `{status:500,error:'job timed out'}`. Also an unscoped `claimAny(id)`-style capability is NOT exposed; the worker/runner uses `getJobStoreForJob(jobId)` which loads the row's `user_id` internally (Task 80) — design this accessor here: `jobOwner(jobId): Promise<{ userId: string | null } | null>` exported from `index.ts`, Pg: select `user_id` by id; memory: search all users.
- Contract suite covers: create/get round-trip; other user's job → null; non-UUID id → null; `claim` succeeds once (two concurrent `claim` calls → exactly one non-null); complete/fail transitions and timestamps; `requeueStale` cases (fresh running → noop, stale + attempts<max → requeued, stale + attempts>=max → failed); complete on a non-running job is a no-op that does not overwrite.

- [ ] **Step 1:** failing tests. **Step 2:** fail. **Step 3:** implement (Pg `claim` = `UPDATE … WHERE id=$1 AND status='queued' AND <owner> RETURNING`). **Step 4:** full checks. **Step 5:** Commit `feat(jobs): job store with atomic claim and stale-job recovery`.

---

### Task 80: Handlers, runner, dispatcher

**Files:**
- Create: `src/lib/jobs/handlers.ts` (`runExtract`, `runRefine` — pure functions taking `{ storage, project, input, provider }` and returning the result or throwing), `src/lib/jobs/run.ts` (`runJob(jobId)`), `src/lib/jobs/dispatch.ts` (`dispatchJob(jobId, opts?)`), `src/lib/jobs/errors.ts` (`toJobError(err): JobError` mapping `ExtractionError`/`RefinementError` → 502 with issues, `LLMRequestError` → 502, `LLMNotConfiguredError` → 503 with today's messages, anything else → 500 "unexpected server error during extraction|refinement"; log only `err.name` plus message for unexpected)
- Test: `handlers.test.ts`, `run.test.ts`, `dispatch.test.ts`, `errors.test.ts`

**Interfaces:**
- Consumes: Task 79 store; `getStorageFor(userId)` from `src/lib/storage` (the runner is not in a request, so it builds storage for the job's owner); `providerFromEnv`, `extractRoom`, `refinePlan`, `refineCloset`, `loadCatalog`, `readPhoto` (move the logic out of the two routes; routes in Task 81 call these).
- Produces: `runJob(jobId, deps?)`: finds the owner via `jobOwner`, `claim`s (no-op if already claimed), loads the project (missing → `fail` 404-ish `{status:404,error:'project not found'}`), runs the handler, `complete`s with the result or `fail`s with `toJobError(err)`. Never throws (catches and fails the job); `deps` allows injecting `provider`/`now` for tests. `dispatchJob(jobId, { fetch, env })`: if `WORKER_URL` and `WORKER_TOKEN` set, POST per the Global Constraints worker contract with a 2 s `AbortSignal.timeout`; on 2xx return `'worker'`; on any failure (non-2xx, network, timeout) start `void runJob(jobId)` in-process (not awaited, errors swallowed and logged by name) and return `'local'`; with no worker configured go straight to local. Requeue-on-poll helper `ensureProgress(job)` (used by Task 81): applies `requeueStale` (5 min, max attempts 3) and re-dispatches when it returns `'requeued'`.

- [ ] **Step 1:** failing tests: extract and refine happy paths (fake `LLMProvider` from the existing llm tests' fixtures), each error mapping, deleted project → failed 404, double `runJob` runs the handler once, never-throws, dispatch worker 2xx → `'worker'` (no local run), worker 500/timeout/network error → `'local'`, no env → `'local'`, `ensureProgress` requeue → re-dispatch. **Step 2:** fail. **Step 3:** implement. **Step 4:** full checks. **Step 5:** Commit `feat(jobs): job handlers, runner and worker-or-local dispatcher`.

---

### Task 81: Routes, polling API, client

**Files:**
- Modify: `src/app/api/projects/[id]/extract/route.ts`, `refine/route.ts` (validate as today, create job, `dispatchJob`, return `202 {jobId}`; set `maxDuration` back to a small value), `src/middleware.ts` only if a matcher/public-path change is needed (it must not be: jobs are authenticated)
- Create: `src/app/api/jobs/[id]/route.ts` (`GET` → 200 `{id,kind,status,result?,error?}`; 404 unknown/other user's/non-UUID; calls `ensureProgress`; `no-store`; wrapped `withUnauthorized`), `src/lib/client/jobs.ts` (`startAndWait<T>(startRequest: () => Promise<Response>, opts?: { pollMs?: number; signal?: AbortSignal; onJobId?: (id: string) => void }): Promise<T>` — POSTs, reads `{jobId}`, polls `GET /api/jobs/:id` every 1.5 s (backing off to 5 s), tolerates single transient poll failures, throws an `Error` whose message is the job's `error` (and carries `status`/`issues`) on `failed`, returns `result` on `done`; non-202 responses behave as today: throw with the response's `error`), tests
- Modify: `src/components/ExtractPanel.tsx`, `src/components/ChatPanel.tsx` to use `startAndWait` (keep their existing UI states; show a "still working" hint after 20 s); store the in-flight `jobId` in `sessionStorage` (wrapped in try/catch) so a remount resumes polling instead of re-posting
- Test: update the existing route tests for extract/refine to the 202 + job flow (poll the job store directly or via the jobs route), add `src/app/api/jobs/[id]/route.test.ts` (cross-user 404, non-UUID 404, unauthorized 401, running job, done job, failed job body), `src/lib/client/jobs.test.ts` (fake fetch + fake timers: success, failed job error mapping, transient poll error recovered, abort), component tests where they exist; extend `unauthorized.test.ts`
- Docs: README "Jobs" section (flow, `WORKER_URL`/`WORKER_TOKEN` env, stale-job rule), `.env.example`, spec "As built" note including the PDF ruling.

**Interfaces:**
- Consumes: Tasks 78–80.
- Produces: the HTTP contract above; `startAndWait` for later UI.

- [ ] **Step 1:** failing tests as listed. **Step 2:** fail. **Step 3:** implement; keep error strings identical to today. **Step 4:** full checks including `npm run e2e` (e2e runs disk mode with `LLM_API_KEY=''`, so extract/refine give the synchronous 503 path; confirm the existing UI tests for that still pass). **Step 5:** Commit `feat(jobs): async extract/refine via polled jobs`.
