# Kitchen Design App

Design a kitchen with the help of an LLM. Upload room photos and a measured wall length or two for scale (or sketch the room by hand), get a draft 2D floor plan, refine it through a chat-driven LLM, and place cabinets, appliances, and furniture from a catalog. Exports to JSON, SVG/PNG (plan and wall elevations), a CSV parts list, and a PDF spec sheet.

A **layout check** scores the kitchen against the NKBA planning guidelines — work triangle, counter beside the sink, range and fridge, dishwasher next to the sink, aisle width — and the chat can fix what fails ("fix the layout check").

An **estimate** prices the parts list — cabinets, appliances, countertop, closet parts and brackets, plus installation and tax — from rough default prices you can change per project, and exports it as CSV.

The **elevations** draw each kitchen wall as a front view, the way a cabinet maker would: cabinets with doors, appliances, the countertop, windows and doors at their real heights, and dimensions. They're shown in the editor and exported as SVG and PNG.

**Design options** let you try another version of a design without losing the first: "Duplicate as option" makes a linked copy ("Option B"), and "Compare options" shows the options side by side — estimate, layout check, and which parts differ. The **spec sheet** downloads one design as a PDF to hand to a contractor or cabinet shop: the plan at a standard scale, the wall elevations, the parts list and estimate, and the layout check.

It also designs **reach-in closets**: pick "Closet" for a new project and lay out rods, shelves, shelf towers, drawer units, shoe shelves, baskets, hooks and valet rods on a front view of the closet, set its size and doors (bifold, sliding, hinged or open), and get warnings about clothes hitting things, drawers the doors block, and shelves out of reach. The chat works for closets too ("double hang on the left, drawers in the middle").

See [`docs/plan.md`](docs/plan.md) for the full implementation plan (6 phases), [`docs/superpowers/specs/2026-10-04-closet-design.md`](docs/superpowers/specs/2026-10-04-closet-design.md) for the closet design, and [`docs/testing-guide.md`](docs/testing-guide.md) for how to test the app.

## Status

**Phase 1 — Foundations:** complete (Tasks 1–8).
**Phase 2 — Photo capture & extraction:** in progress. Tasks 9–13 done — milestone 1: photos + measurements (or a hand sketch) → reviewed, saved room. Phase 3 in progress: Tasks 14–16 (canvas, outline editing, doors and windows) done; Tasks 17–18 (catalog: 24 appliances/fixtures/furniture + 40 generated cabinets) done; Task 19 done — milestone 2: a manual kitchen editor (outline, doors/windows, catalog items with wall snapping and clearance warnings). Phase 4 in progress: Task 20 done — ask for changes in plain words ("move the fridge to the north wall"); every edit is reviewed before it's applied.
**Phase 6 — Closets:** done (Tasks 27–34) — reach-in closet projects with a front-elevation editor, closet warnings, chat, export, and list thumbnails.
**Phase 8 — Layout check:** done (Tasks 40–45) — NKBA guideline checklist for kitchens, also fed to the chat.
**Phase 9 — Estimate:** done (Tasks 46–51) — priced parts list for kitchens and closets, editable prices with undo, CSV export.
**Phase 10 — Elevations:** done (Tasks 52–57) — kitchen wall elevations in the editor, exported as SVG and PNG.

**Phase 11 — Options and spec sheet:** done (Tasks 58–66) — design options with a side-by-side comparison, and a PDF spec sheet.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript + Tailwind
- Next.js route handlers (JSON over fetch), Zod-validated
- Zustand for client state
- react-konva for the 2D editor
- OpenAI-compatible LLM provider (works with OpenAI, OpenRouter, Together, Groq, local llama.cpp server)
- Vitest + Playwright for tests
- Zod for runtime validation

## Development

```bash
npm install
npm run dev
npm test          # unit + integration (Vitest)
npm run e2e       # browser tests (Playwright; own port and temp data dir)
```

## Configuration

Copy `.env.example` to `.env.local` and set:

- `LLM_BASE_URL` — defaults to `https://api.openai.com/v1`
- `LLM_API_KEY` — your API key
- `LLM_MODEL` — text model (default `gpt-4o-mini`)
- `LLM_VISION_MODEL` — vision model (default `gpt-4o-mini`)
- `LLM_TIMEOUT_MS` — per-request timeout (default `60000`)

Any OpenAI-compatible endpoint works. For **OpenRouter**, set `LLM_BASE_URL=https://openrouter.ai/api/v1`; `LLM_MODEL` and `LLM_VISION_MODEL` may then be comma-separated lists — the first model is used and the rest are fallbacks OpenRouter tries when it is rate-limited or down (useful with `:free` models, which are often busy). Rate-limited requests (HTTP 429) are retried once. See `.env.example`.

## Storage backends

Projects and photos go through `getStorage()` (`src/lib/storage/index.ts`), which picks a backend from the environment:

| Setting | Projects | Photos |
|---|---|---|
| nothing set (default) | `DATA_DIR/projects/<id>/project.json` | `DATA_DIR/projects/<id>/photos/` |
| `DATABASE_URL` | Postgres (`projects` table, document in `jsonb`) | — |
| `GCS_BUCKET` (+ `GOOGLE_APPLICATION_CREDENTIALS`) | — | GCS objects `projects/<id>/photos/<photo>.jpg` |

- Schema changes: edit `src/lib/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`. The app applies pending migrations at startup.
- `npm run db:migrate` applies them by hand to a local database (it refuses a remote one unless `MIGRATE_ALLOW_REMOTE=1`).
- `npm run import:local -- --dry-run` previews copying `./data` into the configured backends; `--yes` is needed for a non-local database.
- Tests need no database: Postgres tests run on PGlite (in-process), GCS tests on an in-memory bucket.

## Jobs

The two slow LLM calls — room extraction from photos and chat refinement (kitchen and closet) — run as jobs, so no request is held open for minutes (fragile on a phone connection).

- `POST /api/projects/[id]/extract` and `.../refine` validate synchronously (400 bad id/body/no photos, 404 unknown project, 503 no LLM configured, same messages as before), then create a job and answer `202 { jobId }` straight away.
- The client polls `GET /api/jobs/[id]` (every 1.5 s, backing off to 5 s): `200 { id, kind, status: queued|running|done|failed, result?, error? }`. `result` is what the route used to return; `error` is `{ status, error, issues? }` with the old error status and message. Another user's, unknown or non-UUID job ids are 404. In disk mode jobs live in memory, so a restart loses them: the poll gets 404 and the UI says "The request was lost (the server restarted). Please try again."
- The panels remember the in-flight job id in `sessionStorage`, so leaving the page and coming back resumes polling instead of posting again. After 20 s they show a "still working" hint.
- Where a job runs: with `WORKER_URL` and `WORKER_TOKEN` set, the web process POSTs `${WORKER_URL}/run/<jobId>` (bearer `WORKER_TOKEN`, 2 s timeout); on any failure, or with no worker configured, it runs the job in-process without blocking the response. An atomic `queued → running` claim means a job runs at most once per queueing.
- Stale jobs: when a poll finds a job `running` for over 15 minutes it is re-queued and dispatched again (after 3 attempts it fails with `job timed out`); a job still `queued` a minute after creation is dispatched again.
- The PDF export stays a synchronous `GET /api/export/[id]/pdf` (about a second, pure TypeScript).

## Accounts

Accounts are on whenever `DATABASE_URL` is set; in disk mode there is no login and nothing changes.

- Each user sees only their own projects. Sign in at `/login`; the home page header shows your email and a **Sign out** button.
- Outside production, registration is open only while there are no users (the first user also claims any owner-less projects from `import:local`). In production (`NODE_ENV=production`) it is closed entirely, even for the first user: create that account with `create-user` before the URL goes live, or set `ALLOW_REGISTRATION=1` to let anyone sign up. Add accounts by hand with:
  `NEW_USER_PASSWORD='at least 10 chars' npm run create-user -- you@example.com` (the password comes from the environment, not argv; a non-local database needs `MIGRATE_ALLOW_REMOTE=1`).
- `npm run import:local -- --owner you@example.com` imports `./data` straight into that existing user's account (without `--owner`, projects are imported owner-less). Re-running skips projects that user already has.
- `create-user` and `import:local` do not run migrations: start the app once (it migrates on boot) or run `npm run db:migrate` against a local database first.
- Login throttling keys on the client IP taken from `X-Forwarded-For`: `TRUSTED_PROXY_HOPS` (default `1`) says how many trailing entries your proxies append (the Nth from the right is the client; `0` ignores the header). The Phase 4 smoke test must verify what Render actually sends.
- Sessions are an httpOnly `session` cookie (or `Authorization: Bearer` for scripts). Failed logins are throttled.
