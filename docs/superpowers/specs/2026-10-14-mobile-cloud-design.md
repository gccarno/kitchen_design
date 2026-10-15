# Plan: Android app + synced cloud backend for Home Design (kitchen_design)

## Context
Today the app is a single-user Next.js 15 app. Projects are JSON files under `DATA_DIR` (`src/lib/storage/projects.ts`), photos sit on local disk, and there is no auth and no deploy config. The goal is an Android app plus the existing web app, both working on the same projects and kept in sync through one hosted backend. The setup copies the garden app's pattern:
- **Render** runs the app server.
- **Neon** holds the Postgres database.
- **Google Cloud Storage** holds photos and exports.
- **Terraform** manages the cloud resources.
- **The Oracle free VM** (`oci-free`, ARM, 2 OCPU / 12 GB) gives extra compute.

Decisions already made:
- **Android app:** a Capacitor wrapper around the existing web UI.
- **Offline:** projects can be viewed offline, but edits need a connection. This matches the garden app.
- **Oracle VM:** runs heavy jobs (PDF export, LLM extract/refine).
- **Auth:** email/password accounts, as in the garden app.

## Architecture
```
Android (Capacitor WebView) ─┐
                             ├─ HTTPS ─► Render: Next.js app (UI + /api)  ──► Neon Postgres (users, projects JSONB, jobs)
Browser (web) ───────────────┘                │        │                 ──► GCS bucket (photos/, exports/)
                                              │ POST /run (bearer)
                                              ▼ via Tailscale Funnel (no OCI ports opened)
                                   oci-free: kitchen-worker container (arm64)
                                   runs PDF / extract / refine jobs → writes Neon + GCS
```
- **Single source of truth:** sync works because every client reads and writes the same Postgres rows. This is the same as the garden app. The project's existing `revision` number and base-revision check give optimistic concurrency, so a stale edit gets a 409 and the client reloads.
- **The Android app is a thin native shell.** Its `server.url` points at the Render URL, so web and mobile always run the same code. Capacitor plugins fill the native gaps: camera, file save/share, network status, the back button and the splash screen.
- **The worker is an accelerator, not a dependency.** Render first tries to hand a job to the worker. If the worker doesn't answer within about 2 s, Render runs the same job handler itself. Neon only wakes when a user is active, because the worker never polls the database. Constant polling would keep Neon's compute awake and use up the free compute hours.

## Phase 0: Terraform (`infra/terraform/`, new, flat layout like the garden app)
- **Files:** `versions.tf`, `providers.tf`, `state.tf`, `gcs.tf`, `neon.tf`, `outputs.tf` and `LEARNING.md`. Commit `.terraform.lock.hcl`.
- **Providers:** `hashicorp/google ~> 8.4` and `kislerdm/neon ~> 0.18`. These are the same versions as the garden app (`garden_app/gardening_app/infra/terraform/versions.tf`).
- **State:** a `gcs` backend in the existing `innate-conquest-491313-k3-tfstate` bucket, with `prefix = "kitchen-design"`. The bucket stays managed by the garden repo.
- **`gcs.tf`:**
  - A private bucket `kitchen-design-files` in us-east1, with public access blocked and versioning off.
  - A lifecycle rule that deletes `exports/` objects after 7 days.
  - Two service accounts, `kitchen-design-server` (Render) and `kitchen-design-worker` (OCI), each with `roles/storage.objectAdmin` on this bucket only.
  - Service-account keys are **not** Terraform resources, so they never land in state. Create them with gcloud. Render's key goes in as a Secret File, as in the garden app.
- **`neon.tf`:**
  - `neon_project "kitchen"`: name "KitchenDesign", the same org, `aws-us-east-1`, PG 18, `history_retention_seconds = 21600`, autoscaling 0.25 to 2 CU and `prevent_destroy`.
  - If the free plan's project limit blocks this, fall back to a `neon_database` inside the GardenApp project.
- **Render is not in Terraform.** It uses `render.yaml`, for the same reason as the garden app: two tools managing one service would overwrite each other.
- **Gotchas to follow (from the garden app's LEARNING.md):**
  - Never run `terraform output` on sensitive values.
  - Leaving a block out means "this should not exist", so write out every setting Google adds by default.

## Phase 1: Storage abstraction → Neon + GCS
All of today's storage calls are synchronous: `loadProject`, `saveProject`, `updateProject`, `listProjects`, `optionGroup`, `duplicateAsOption`, `deleteProject` and `projectExists` in `src/lib/storage/projects.ts`, plus `lookupPhoto` and `photoFilePath` in `src/lib/storage/photos.ts`. About 30 route handlers and pages call them.
- **`src/lib/storage/store.ts`:** an async `ProjectStore` interface with the same operations. Each call is scoped to the owner (user id).
- **`FsProjectStore`:** wraps the current fs code. Keep it for local dev, Vitest and Playwright when `DATABASE_URL` is unset. This mirrors the garden app's SQLite fallback.
- **`PgProjectStore`:**
  - Uses Drizzle ORM with `postgres` (porsager).
  - Table `projects(id uuid pk, owner_id, name, kind, option_of, revision int, doc jsonb, created_at, updated_at, deleted_at)`.
  - `updateProject` runs `UPDATE … WHERE id=$1 AND revision=$base RETURNING`, so the revision check happens atomically in the database instead of through the fs lock.
- **`PhotoStore` interface:**
  - `FsPhotoStore` is the current code.
  - `GcsPhotoStore` writes objects at `projects/<pid>/photos/<photoId>` using `@google-cloud/storage`.
  - The photo GET route streams the object with `Cache-Control: private, max-age=31536000, immutable`. Photos are immutable by id.
- **`src/lib/storage/index.ts`:** `getStores()` chooses the fs or Postgres/GCS stores from the environment.
- **Callers:** update every caller to `await`. That covers `src/app/api/**/route.ts`, `src/app/page.tsx`, `src/app/project/[id]/page.tsx`, `src/app/compare/[groupId]/page.tsx` and `src/lib/export/drawing.ts` (`loadExportProject`, `loadDrawing`, `loadElevations`).
- **Migrations:** drizzle-kit SQL files committed in `drizzle/`.
  - The app runs migrations at startup, before it serves requests, as the garden app does with Alembic.
  - A guard refuses manual migrations against a non-localhost database unless `MIGRATE_ALLOW_REMOTE=1` is set.
- **`scripts/import-local-data.ts`:** a one-off script that uploads the existing `./data/projects/*` into Neon and GCS.
- **As built (Phase 1):** no `deleted_at` column — deletes stay permanent, as before; Phase 6's offline cache does full refreshes, so no tombstones are needed. Postgres tests run on PGlite instead of a Docker Postgres. Blob storage is a general `BlobStore` (disk or GCS) keyed `projects/<id>/…`, so Phase 3's PDF exports reuse it.

## Phase 2: Auth (same model as the garden app)
- **Tables:** `users(id, email unique, password_hash)` and `auth_tokens(token_hash pk, user_id, label, created_at, last_used_at)`.
- **Passwords:** argon2 via `@node-rs/argon2`.
- **Tokens:** `crypto.randomBytes(32)`. The database stores only the SHA-256 hash of each token.
- **Delivery:** the token is set as an httpOnly, Secure, SameSite=Lax `session` cookie. A cookie works for both server components and the Capacitor WebView, which loads the same origin. `Authorization: Bearer` is also accepted, for scripts and e2e tests.
- **Middleware:** `src/middleware.ts` sends unauthenticated page requests to `/login` and returns 401 for unauthenticated `/api/*` calls. Exceptions are `/api/health`, the auth routes and the worker callback.
- **Registration:** open only for the first user or when `ALLOW_REGISTRATION=1`. `scripts/create-user.ts` is the fallback.
- **Ownership:** every store call takes `userId`. Sharing is out of scope for now.

## Phase 3: Read API + async jobs
- **New endpoints:**
  - `GET /api/projects` returns `id, name, kind, revision, updated_at`.
  - `GET /api/projects/[id]` returns the full doc.
  - These let the service worker and the mobile shell cache project data. Today pages read disk directly and there are no GET endpoints.
- **Jobs table:** `jobs(id uuid, user_id, project_id, kind, status queued|running|done|failed, input jsonb, result jsonb, error, attempts, created_at, started_at, finished_at)`.
- **`src/lib/jobs/handlers.ts`:** shared handlers that both Render and the worker run.
  - `pdf` runs `buildSpecSheet` (`src/lib/export/spec-sheet.ts`), uploads the result to `exports/<jobId>.pdf` and returns a download path.
  - `extract` wraps `src/lib/llm/extract.ts`.
  - `refine` and `closet-refine` wrap `src/lib/llm/refine.ts` and `src/lib/llm/closet.ts`.
- **Endpoint changes:**
  - `/api/projects/[id]/extract`, `/refine` and `/api/export/[id]/pdf` now return `{jobId}` with status 202.
  - The client polls `GET /api/jobs/[id]`, and when the job is done it fetches the result: a proposal, or a PDF stream from `/api/jobs/[id]/file`.
  - The proposal still goes through the existing diff-review flow (`DiffPreview`, `src/lib/client/revisions.ts`).
  - This removes the 660 s held request, which would be fragile on a phone connection.
- **Dispatcher (`src/lib/jobs/dispatch.ts`):** if `WORKER_URL` is set, it POSTs to `${WORKER_URL}/run/{jobId}` with `WORKER_TOKEN` and a 2 s timeout. If that fails, it runs the handler inside the Render process without blocking the response.
- **Recovery:** jobs stuck in `running` for over 15 minutes are re-queued the next time someone polls them.

## Phase 4: Render deploy
- **Root `render.yaml`:** a Node web service with no `region:` key (a garden-app lesson).
  - Build: `npm ci && npm run build`. Start: `npm run start`.
  - Health check: `/api/health`, which checks the database.
  - Env vars:
    - `DATABASE_URL` and `LLM_API_KEY` are `sync:false`. Set them by hand, and verify they're set after deploy.
    - `GCS_BUCKET`.
    - `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/gcs.json` (the Secret File).
    - `LLM_BASE_URL=https://openrouter.ai/api/v1` with the free models already chosen. Copy the key from the garden app's `.env`.
    - `WORKER_URL`, `WORKER_TOKEN` (`generateValue`) and `ALLOW_REGISTRATION=0`.
- **Risk: `next build` running out of the free tier's memory.** If it does, build a Docker image (`Dockerfile`, Next `output: "standalone"`) in GitHub Actions and deploy that image to Render instead.
- **Database connections:** use a direct Neon connection with a small pool (`max: 5`), `idle_timeout` and reconnect on error, because Neon suspends idle compute.
- **Cold starts:** expect 30 to 60 s after Render sleeps. The Android splash screen and the offline page cover this (Phase 7).

## Phase 5: OCI worker (work lands in both repos)
- **`src/worker/server.ts`** (this repo):
  - A small `node:http` server: `POST /run/:jobId` (bearer `WORKER_TOKEN`) and `GET /health`.
  - It imports `src/lib/jobs/handlers.ts` and the Postgres/GCS stores, and allows 2 jobs at once.
- **Image:**
  - `Dockerfile.worker` builds from `node:22-bookworm-slim`. The `sharp` package already ships arm64 builds.
  - `.github/workflows/worker-image.yaml` builds it with buildx for `linux/arm64` and pushes it to GHCR on every push to main.
- **oci-infra repo, new `workloads/kitchen-worker/` folder:**
  - `compose.yaml`: the worker plus a `tailscale` sidecar running Funnel, which gives a public HTTPS `*.ts.net` URL.
  - `.env.example` and `setup.sh`, which installs Docker, logs in to GHCR and copies the worker's GCP key to `/data/secrets/`.
  - A systemd timer that runs `docker compose pull && up -d` every 15 minutes, so updates are pulled without CI ever SSHing in.
  - Put persistent files on `/data`.
- **Terraform:** no changes to the OCI Terraform, since Funnel needs no open ports. Add a note to `cloud-init.yaml` for rebuilds, plus a README section titled "Hosting a workload". `cloud-init` does not re-run on a VM that already exists, so run `setup.sh` over `ssh oci-free` this time.
- **Shared VM:** set compose CPU and memory limits (`cpus: 1.5`, `mem_limit: 4g`) so ML batches still fit alongside the worker.

## Phase 6: Offline viewing (PWA layer, works on web and Android)
- **Service worker:** add one with `@serwist/next`.
  - Navigations and `GET /api/projects*`: try the network first, fall back to the cache.
  - Photo GETs: serve from the cache first, since photos are immutable.
  - App shell and static files: precache them.
- **"Keep offline" toggle:** on the project list, it fetches the project page, its JSON and its photos into the cache.
- **Offline mode:**
  - Uses `navigator.onLine` plus failed fetches, and Capacitor's `Network` plugin on Android.
  - Shows an offline banner, and `ProjectEditor` and `ChatPanel` turn read-only: edit, chat and export controls are disabled.
  - Read-only exports (CSV and SVG are pure, via `src/lib/estimate/csv.ts` and `src/lib/plan/svg.ts`) can still be built in the browser.
- **Conflicts:** a 409 from `revisions`/`undo` means the project changed elsewhere. The client reloads the latest version and tells the user, then the user re-applies their change. The base-revision check already exists, so this is only new UI.

## Phase 7: Android app (Capacitor)
- **Setup:**
  - Add `@capacitor/core`, `@capacitor/cli` and `@capacitor/android`.
  - `capacitor.config.ts`: `appId: "com.homedesign.app"`, `server.url` taken from `CAP_SERVER_URL` (prod on Render, or a LAN dev URL), and `server.errorPath: "offline.html"`.
  - `mobile/www/` holds the bundled `index.html` and `offline.html`, the page shown while Render wakes up or when there's no network. It retries automatically.
  - Run `npx cap add android`, which creates `android/`, and commit it.
- **Plugins:**
  - `@capacitor/camera`: use it from `PhotoCapture` when `Capacitor.isNativePlatform()` is true. On the web, the `react-dropzone` input stays.
  - `@capacitor/filesystem` and `@capacitor/share`: WebViews don't handle downloads. In `src/lib/client/download.ts`, the PDF, CSV and PNG exports fetch a blob, write it to the cache directory, then open the share sheet. On the web they stay normal links.
  - `@capacitor/network`, `@capacitor/app` (hardware back button → `router.back()`), `@capacitor/splash-screen` and `@capacitor/status-bar`.
- **Mobile UX:**
  - Viewport meta and a responsive layout pass on `ProjectEditor`, `ChatPanel`, `EstimatePanel` and `CompareOptions` (stacked panels and a bottom sheet for chat).
  - Pinch-zoom and pan in `FloorPlanStage` using Konva touch events. Larger hit targets in `src/lib/plan/canvas-hit.ts`.
- **Build and install (same as the garden app):**
  - Build locally with `cd android && ./gradlew assembleDebug` and install with `adb install -r` or wireless debugging.
  - The release build uses a keystore kept outside the repo.
  - Write `android/BUILD.md` and `android/UPDATE_PHONE.md`.
  - The shell only needs rebuilding when native plugins or config change. UI changes ship when Render redeploys.

## Phase 8: CI and docs
- **`.github/workflows/ci.yaml`:**
  - typecheck, lint and vitest.
  - A `migrations` job: a `postgres:18` service, `drizzle-kit migrate`, then `drizzle-kit check`, which fails if the schema has drifted from the migrations. This lesson comes from the garden app.
  - Playwright on the fs stores.
  - A Pg-store integration test against the service container.
  - An `android` job: `npx cap sync android && ./gradlew assembleDebug` on JDK 21, with the APK uploaded as an artifact.
- **`worker-image.yaml`:** builds and pushes the worker image (see Phase 5).
- **`e2e-live.yaml`:** weekly or manual, against prod with `[E2E]`-prefixed data. It has a "sync relay" spec: two authenticated browser contexts, one as desktop and one as the Pixel 7 device profile. A changes the plan, B sees it, B edits, A sees it, and B's stale-revision write gets a 409.
- **Docs:** `DEPLOYMENT.md` (Terraform → keys → Render → worker → APK), plus updates to `README.md` and `.env.example`.

## Critical files
- **Change:**
  - `src/lib/storage/projects.ts` and `src/lib/storage/photos.ts` (put them behind the interfaces).
  - All `src/app/api/**/route.ts`.
  - `src/app/page.tsx`, `src/app/project/[id]/page.tsx` and `src/app/compare/[groupId]/page.tsx`.
  - `src/lib/export/drawing.ts`, `src/components/{ProjectEditor,PhotoCapture,ChatPanel,FloorPlanStage}.tsx`, `src/lib/client/revisions.ts`, `next.config.ts` and `package.json`.
- **New:**
  - `src/lib/storage/{store,pg,gcs,index}.ts`, `src/lib/db/schema.ts`, `drizzle/`.
  - `src/lib/auth/*`, `src/middleware.ts`, `src/app/login/`.
  - `src/lib/jobs/*`, `src/app/api/jobs/`, `src/worker/server.ts`.
  - `infra/terraform/*`, `render.yaml`, `Dockerfile.worker`, `capacitor.config.ts`, `android/`, `mobile/www/`, `.github/workflows/*`.
  - In the oci-infra repo, `workloads/kitchen-worker/*`.
- **Reuse unchanged:** all pure code in `src/lib/plan/*`, `src/lib/closet/*`, `src/lib/estimate/*`, `src/lib/llm/*` and `src/lib/export/spec-sheet.ts`. The job handlers call these directly.

## Verification
1. **Locally:**
   - With `DATABASE_URL` unset, `npm test`, `npm run e2e` and `npm run typecheck` all stay green, using the fs stores.
   - With a local Postgres in Docker plus `GCS_BUCKET` pointing at a test prefix, the Pg-store integration tests pass and the whole Playwright suite passes with `STORE=pg`.
2. **Terraform:** `terraform plan` shows only the new bucket, the two service accounts, the IAM bindings and the Neon project. After `apply`, `gsutil ls` and the Neon console confirm them.
3. **Render:**
   - `/api/health` returns 200.
   - Log in and import the local data with `scripts/import-local-data.ts`. The project list matches the local list.
   - Check that the LLM key is set by running a refine on a free model and getting a non-"not configured" result.
4. **Worker:**
   - `curl https://<funnel>.ts.net/health` responds.
   - A PDF export job shows `started_by=worker` in its row, and the PDF downloads.
   - Stop the container and export again: the job still finishes, this time on Render through the fallback.
5. **Sync:**
   - `e2e-live.yaml`'s sync-relay spec passes against prod.
   - Manually: edit on the phone, refresh the web app and see the change. Edit the same project on both and the second gets the conflict reload message.
6. **Android:**
   - The APK installs and logs in.
   - Camera capture adds a photo, and PDF export opens the share sheet.
   - In airplane mode, a cached project opens read-only with the offline banner.
   - With Render asleep on a cold start, the offline page shows, then the app loads.

## Carry-forward from the Phase 1 final review
- Phase 2: assign the null-owner rows created by `npm run import:local` to the first registered user, or imported projects vanish once `getStorage(userId)` scopes by owner.
- Phase 3: add one shared key validator (`assertKey`) used by both blob stores; add an `exportKey()` helper; give `BlobStore.get` a content type or a streaming/signed-URL path; add an orphan sweep for `projects/` blobs with no row (failed GCS delete after `deleteProject`, failed duplicate insert).
- Phase 0/3: `GCS_PREFIX` shifts `exports/` to `<prefix>exports/`, so the 7-day lifecycle rule on `exports/` will not match prefixed exports. Use no prefix in prod.
- Phase 4: the Drizzle migrator takes no advisory lock (one migrator at a time); `drizzle/` is read from `process.cwd()`, so a standalone/Docker image must copy it; use a direct (non-pooled) Neon connection.
- Before Phase 4: run the "After Phase 1" smoke test against a real Neon branch and a GCS dev prefix. Postgres has only run on PGlite and GCS only on a fake bucket.
