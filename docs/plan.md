# Kitchen Design App — Implementation Plan

> This plan is sized for `subagent-driven-development` (one fresh subagent per task, two-stage review). All file paths are relative to the repo root.

## Goal

A web app (mobile-friendly PWA) that turns a few room photos into an editable 2D kitchen floor plan. Users upload 3–6 photos and type in one or two tape-measured wall lengths for scale (a reference object such as a credit card is an optional secondary hint); the app drafts a room outline with a vision LLM, or the user sketches it by hand, and then lets the user insert cabinets, appliances, and furniture from a catalog. The LLM is chat-driven for refinement ("move the fridge to the north wall", "swap to an L-shape layout"). Output is JSON + 2D SVG/PNG.

## Status

- [x] Task 1 — Repo + tooling
- [x] Task 2 — Domain types + Zod schemas
- [x] Task 3 — Project storage
- [x] Task 4 — LLM provider abstraction
- [x] Task 5 — Extraction schemas + prompt
- [x] Task 6 — Geometry helpers
- [x] Task 7 — JSON Patch diff/apply
- [x] Task 8 — Plan validation
- [x] Task 9 — Photo upload + EXIF
- [x] Task 10 — Reference-marker UI (completed in Task 10.5)
- [x] Task 10.5 — Hardening + data model migration (manual phone check waits until Task 13 mounts `PhotoCapture` on a page)
- [x] Task 10.6 — Measured walls + manual room sketch (`RoomSketch` mounts on a page in Task 13)
- [x] Task 11 — Vision extraction endpoint (REST; tRPC dropped)
- [x] Task 12 — Diff preview component
- [x] Task 13 — Project page shell — **milestone 1 reached** (photos + measurements → proposed room, or a hand sketch → review → saved)
- [ ] Manual phone check of Tasks 10–13 (now possible: `next dev -H 0.0.0.0`, open `http://<laptop-ip>:3000` on the phone)
- [x] Task 14 — Konva canvas + viewport
- [x] Task 15 — Drag-to-edit walls and polygon vertices
- [x] Task 16 — Insert doors/windows on walls
- [x] Task 17 — Catalog loader + sidebar
- [x] Task 18 — Parametric catalog generator
- [x] Task 19 — Place items on the plan — **milestone 2 reached** (manual editor with the catalog)
- [x] Task 20 — Chat panel + refinement endpoint (verified against OpenRouter free models)
- [ ] **Next: Task 21 — Layout proposals**
- [x] Phase 6 — Closets (Tasks 27–34; see below and `docs/superpowers/specs/2026-10-04-closet-design.md`)
- [x] Phase 7 — Example layouts and the layout bugs they found (Tasks 35–39; see below)

## Decisions (locked in with user)

| Question | Choice |
|---|---|
| Platform | Web (PWA, mobile-first, starts as web app) |
| Photo-to-plan pipeline | Photos + 1–2 user-measured wall lengths (primary scale) → vision-LLM extraction, rescaled server-side to the measured walls. Reference object is an optional secondary hint. Manual "sketch room" path works with zero LLM calls. |
| Catalog | Parametric generator + curated seed of standard dimensions. Public-source ingest/scraping is out of scope for v1 (brittle, ToS risk). |
| LLM | OpenAI-compatible interface, swap via config (OpenAI, OpenRouter, Together, Groq, local llama.cpp server). **In use: OpenRouter free models** (Gemma 4 vision) with fallback lists, a 429 retry, and a 120 s timeout — free models are slow and often rate-limited; a paid model (e.g. `google/gemini-2.5-flash`) is a one-line change. |
| API style | Plain Next.js route handlers (JSON over `fetch`), Zod-validated on the server; shared Zod schemas give client/server types. tRPC was dropped at Task 11 — fewer moving parts for a single-user local app. |
| LLM edit format | LLM emits typed commands (`addItem`, `moveItem`, …); the server compiles them to JSON Patch. The LLM never writes raw patch paths. |
| Output | JSON + 2D SVG/PNG only. No 3D. |

## Current Context / Assumptions

- Tasks 1–20 are complete (see Status). Package manager is **npm** (`package-lock.json`), not pnpm.
- User has OpenAI API key (or equivalent) — read from env var `LLM_API_KEY`.
- Photos come from phone camera; EXIF orientation is normalized server-side with `sharp` (Task 9).
- **Storage is always mm.** `Project.units` is display-only; conversion happens at the UI edge.
- Single-user local app to ship first; multi-user/cloud save is out of scope but the data model supports it (every "project" is a JSON document).
- The LLM is treated as a *proposer*, never the source of truth. Every LLM edit is diffed and shown to the user before being applied. This is non-negotiable for a design tool.
- A single photo + reference object cannot give room dimensions: the scale is only valid at the object's depth, and perspective distorts everything else. Measured wall lengths are the scale source of truth.
- **Phone testing:** use `<input type="file" accept="image/*" capture="environment">` (works over plain HTTP on the LAN). `getUserMedia` and PWA install/service worker need HTTPS — use `next dev --experimental-https` or a tunnel when testing those.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Next.js 15 (App Router)            │
│   React + Tailwind + shadcn/ui + Zustand            │
│   PWA manifest, mobile-first camera capture         │
└──────────────────┬──────────────────────────────────┘
                   │ JSON routes (fetch)
┌──────────────────▼──────────────────────────────────┐
│              Node.js API (Next routes)               │
│  - photo upload + EXIF normalize                    │
│  - LLM provider abstraction (OpenAI-compatible)     │
│  - floor-plan diff/apply with confirmation          │
│  - catalog loader (seed + parametric generator)     │
└──────────────────┬──────────────────────────────────┘
                   │
       ┌───────────┼────────────┐
       ▼           ▼            ▼
   LLM API    Catalog JSON   File storage
   (env)      (disk)         (./data/projects)
```

Data flow:

1. **Capture:** User takes 3–6 photos, enters 1–2 measured wall lengths, and optionally marks a reference object on a photo.
2. **Extract:** Photos (downscaled) + measurements → vision LLM → proposed room outline (JSON: polygon, walls, openings) → server rescales so measured walls match exactly. Alternative: user sketches the room manually (no LLM).
3. **Refine:** User chats with the LLM to adjust the floor plan. The LLM returns typed commands; the server compiles them to a JSON Patch; UI shows a diff and applies on confirm.
4. **Furnish:** User drags items from a sidebar catalog onto the plan; positions/snap are computed locally. LLM can also propose layouts that the user confirms.

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript, Tailwind, shadcn/ui, Zustand for local state, `react-konva` or `pixi.js` for the 2D canvas editor.
- **Backend:** Next.js route handlers under `src/app/api/**`, request bodies validated with Zod.
- **LLM:** `fetch` against any OpenAI-compatible `/chat/completions` endpoint at `LLM_BASE_URL` (no vendor SDK). One abstraction layer with `completeText()`, `completeJSON()`, `chatWithVision()`; 60 s timeout; typed errors (`LLMRequestError` not retried, `LLMResponseError` retried once with feedback).
- **Storage:** Local filesystem under `./data/projects/<id>/` (photos + plan.json). Easy to swap for S3 later.
- **Testing:** Vitest for unit, Playwright for one end-to-end happy path.
- **Lint/format:** ESLint + Prettier, strict TS.

## Data Model (the contract)

> Zod schemas in `src/lib/plan/schemas.ts` are the source of truth; `types.ts` re-exports inferred types. The code matches this model as of Task 10.5.

```ts
// Plan document — single source of truth, versioned. All lengths in mm.
type Project = {
  id: string;                  // UUID — validated before use in any filesystem path
  name: string;
  units: 'mm' | 'in';          // display-only
  createdAt: string;
  updatedAt: string;
  revision: number;            // bumped on every applied edit
  photos: Photo[];
  room: Room;
  items: PlacedItem[];
  history: PlanRevision[];     // undo stack, capped at 200 entries
};

type Photo = {
  id: string;
  path: string;                // relative to project dir
  width: number;               // natural pixels after EXIF normalization
  height: number;
  referenceObject?: {
    kind: 'credit_card' | 'a4_paper' | 'us_letter' | 'coin_us_quarter' | 'custom';
    side: 'long' | 'short';    // which edge of the object the box measures
    knownSizeMm: number;       // resolved from reference-objects.ts, or the custom value
    pixelBox: [number, number, number, number]; // [x1,y1,x2,y2] in NATURAL image pixels
  };
  wallHint?: 'north' | 'east' | 'south' | 'west' | 'unknown';
};

type Room = {
  polygon: [number, number][];  // mm, plan coords, implicitly closed — the walls' INTERIOR face (walls extend outward)
  walls: Wall[];                // walls[i] is the edge polygon[i] → polygon[(i+1) % n]; length === polygon.length
  openings: Opening[];
  measurements?: { wallId: string; lengthMm: number; source: 'user' }[]; // scale anchors
};

// Wall geometry is DERIVED from the polygon edge — never stored — so dragging a
// vertex can't desync walls. Ids travel with their edge on vertex insert/remove.
type Wall = { id: string; thicknessMm: number };
type Opening = { id: string; wallId: string; kind: 'door' | 'window' | 'pass_through';
                  positionMm: number; widthMm: number; heightMm: number };

type PlacedItem = {
  id: string;
  catalogId: string;            // FK into catalog
  sizeMm: { w: number; d: number; h: number }; // snapshot at placement; validation never needs the catalog
  mount?: 'floor' | 'counter' | 'wall';          // level it occupies (default floor); only same-level items can collide
  clearanceMm?: { front: number; sides: number };  // snapshot from the catalog; drives clearance warnings
  position: { x: number; y: number };  // mm, item centre
  rotationDeg: number;
  tag?: string;                // 'fridge', 'sink', etc. — drives clearance rules
};

type PlanRevision = {
  revision: number;
  patch: JsonPatchOp[];
  inverse: JsonPatchOp[];      // applied on undo
  at: string;
  source: 'user' | 'llm';
  summary: string;
};
```

Invariants enforced in code:

- **Patchable-path allowlist.** `applyJsonPatch` only accepts ops whose `path`/`from` start with `/name`, `/room`, or `/items`. `id`, `revision`, `history`, `photos`, and timestamps are server-managed.
- **Optimistic concurrency.** Every proposal carries `baseRevision`; applying it fails if `project.revision !== baseRevision`.
- **Reference sizes** come from one table, `src/lib/plan/reference-objects.ts` (`{ longMm, shortMm }` per kind). No other file hard-codes object sizes.

All LLM responses are validated against a Zod schema before they ever touch state. Invalid → retry once with the Zod errors fed back → ask user.

## Files Likely to Change (initial skeleton)

```
.
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── .env.example                       # LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_VISION_MODEL
├── data/
│   └── projects/.gitkeep
├── public/
│   ├── manifest.json                  # PWA
│   └── icons/...
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                   # project list / new
│   │   ├── project/[id]/page.tsx      # main editor
│   │   └── api/
│   │       ├── upload/route.ts                          # POST photo
│   │       └── projects/
│   │           ├── route.ts                             # POST create project
│   │           └── [id]/
│   │               ├── revisions/route.ts               # POST commit a patch (the one plan-edit path)
│   │               ├── extract/route.ts                 # POST photos → candidate room (no mutation)
│   │               └── photos/[photoId]/
│   │                   ├── route.ts                     # GET photo bytes
│   │                   └── reference/route.ts           # PUT/DELETE reference object
│   ├── components/
│   │   ├── PhotoCapture.tsx
│   │   ├── ReferenceMarker.tsx        # draw box over credit card
│   │   ├── RoomSketch.tsx             # manual room + measured walls (no LLM)
│   │   ├── FloorPlanCanvas.tsx        # Konva-based 2D editor
│   │   ├── CatalogSidebar.tsx
│   │   ├── ChatPanel.tsx              # LLM refinement
│   │   └── DiffPreview.tsx            # show proposed change before apply
│   ├── lib/
│   │   ├── llm/
│   │   │   ├── provider.ts            # interface
│   │   │   ├── openai-compatible.ts   # default impl
│   │   │   ├── images.ts              # downscale photos for vision requests
│   │   │   ├── extract.ts             # photos → candidate room (+ retry, rescale, patch)
│   │   │   ├── prompts.ts             # versioned prompts as functions returning strings
│   │   │   └── schemas.ts             # Zod schemas for every LLM response
│   │   ├── plan/
│   │   │   ├── geometry.ts            # polygon ops, snap, collision (only copy of these helpers)
│   │   │   ├── diff.ts                # JSON Patch producer/consumer + path allowlist
│   │   │   ├── validate.ts            # room closes? items inside?
│   │   │   ├── reference-objects.ts   # the one table of known object sizes
│   │   │   ├── room-edit.ts           # vertex insert/remove → wall split/merge, opening remap
│   │   │   ├── scale.ts               # rescale a room so measured walls match
│   │   │   └── commands.ts            # typed LLM commands → JSON Patch
│   │   ├── catalog/
│   │   │   ├── loader.ts
│   │   │   ├── generator.ts           # parametric cabinet variants
│   │   │   └── seed.json              # curated appliances/furniture
│   │   ├── storage/
│   │   │   ├── projects.ts            # read/write Project JSON, atomic writes, per-project lock
│   │   │   └── photos.ts              # photo lookup + file paths
│   │   └── exif.ts
│   └── store/
│       └── editor.ts                  # Zustand
└── tests/
    ├── unit/
    │   ├── geometry.test.ts
    │   ├── diff.test.ts
    │   ├── llm-schemas.test.ts
    │   └── catalog-generator.test.ts
    └── e2e/
        └── happy-path.spec.ts         # upload 1 photo w/ credit card → see room outline
```

---

## Phase 1 — Foundations (tasks 1–8)

### Task 1: Initialize repo and tooling

**Objective:** Bootstrap Next.js + TS + Tailwind + Vitest + Playwright.

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `.env.example`, `.eslintrc.json`, `.prettierrc`.

**Step 1:** `npx create-next-app@latest . --ts --tailwind --app --eslint --src-dir --use-npm`
**Step 2:** Add deps: `npm i zod zustand react-konva@~19.2 konva react-dropzone exifr sharp fast-json-patch`
**Step 3:** Add dev deps: `npm i -D vitest @vitest/ui @testing-library/react @playwright/test happy-dom`
**Step 4:** Configure `tsconfig.json` strict mode, path alias `@/*` → `src/*`.
**Step 5:** Initialize git, first commit.

**Verify:** `npm run dev` serves the default page; `npm test` runs an empty Vitest pass; `npx playwright install chromium` succeeds.

> ✅ Done. Note: `react-konva@^18` was installed; it does not support React 19 — upgraded in Task 10.5.

### Task 2: Project domain types + Zod schemas

**Objective:** Single source of truth for `Project`, `Room`, `PlacedItem`, etc., as both TS types and Zod schemas.

**Files:**
- Create: `src/lib/plan/types.ts`, `src/lib/plan/schemas.ts`, `src/lib/plan/schemas.test.ts`.

**Step 1 — failing test:**
```ts
import { ProjectSchema } from '@/lib/plan/schemas';
import minimalProject from '@/lib/plan/__fixtures__/minimal.json';
test('validates a minimal project', () => {
  expect(() => ProjectSchema.parse(minimalProject)).not.toThrow();
});
```
**Step 2 — implement:** Define types and Zod schemas mirroring the Data Model section above. Add a fixture JSON.
**Step 3 — pass.**
**Step 4 — commit:** `feat: project domain types and zod schemas`.

### Task 3: Project storage (atomic JSON on disk)

**Objective:** Read, create, list, and save projects atomically. API surface in `src/lib/storage/projects.ts`.

**Files:**
- Create: `src/lib/storage/projects.ts`, `src/lib/storage/projects.test.ts`.

**Steps:**
1. Test: create project → file exists at `data/projects/<id>/project.json` → reading back returns same data.
2. Implement: `createProject`, `loadProject`, `saveProject` (atomic: write to `.tmp` then rename), `listProjects`. Each project dir also has `photos/`.
3. Use `randomUUID` for ids.
4. Commit: `feat: project storage on disk`.

### Task 4: LLM provider abstraction

**Objective:** One interface, one implementation against the OpenAI-compatible API, swappable via env.

**Files:**
- Create: `src/lib/llm/provider.ts`, `src/lib/llm/openai-compatible.ts`, `src/lib/llm/provider.test.ts`, `.env.example` (extend).

**Interface:**
```ts
export interface LLMProvider {
  completeText(opts: { system: string; user: string; temperature?: number; maxTokens?: number }): Promise<string>;
  completeJSON<T>(opts: { system: string; user: string; schema: z.ZodType<T> }): Promise<T>;
  chatWithVision(opts: {
    system: string; user: string;
    images: { mime: string; dataBase64: string }[];
    schema: z.ZodType<T>;
  }): Promise<T>;
}
```

**Steps:**
1. Test: stub provider in tests; assert the real `openai-compatible` builds the right request shape (mock `fetch`).
2. Implement `openai-compatible` against `https://api.openai.com/v1` by default, overridable via `LLM_BASE_URL`.
3. Read `LLM_API_KEY`, `LLM_MODEL`, `LLM_VISION_MODEL` from env. Never log the key.
4. Commit: `feat: openai-compatible LLM provider`.

### Task 5: LLM response schemas for room extraction

**Objective:** Lock down the shape the vision LLM must return when extracting a room from photos.

**Files:**
- Create: `src/lib/llm/schemas.ts`, `src/lib/llm/schemas.test.ts`, `src/lib/llm/prompts.ts`, `src/lib/llm/__fixtures__/extraction-ok.json`, `src/lib/llm/__fixtures__/extraction-bad.json`.

**Schema (Zod):**
```ts
export const ExtractedRoomSchema = z.object({
  confidence: z.number().min(0).max(1),
  polygonMm: z.array(z.tuple([z.number(), z.number()])).min(3),
  walls: z.array(z.object({
    fromIdx: z.number().int(), toIdx: z.number().int(), thicknessMm: z.number().positive(),
  })),
  openings: z.array(z.object({
    wallIdx: z.number().int(), kind: z.enum(['door','window','pass_through']),
    positionMm: z.number(), widthMm: z.number(), heightMm: z.number(),
  })),
  notes: z.string(),
});
```

**Steps:**
1. Tests assert fixtures parse / fail as expected and reject an out-of-range polygon.
2. Implement schema and prompts as functions returning strings (so we can version them).
3. Commit: `feat: llm response schemas + extraction prompt`.

### Task 6: Geometry helpers (pure functions, well-tested)

**Objective:** Pure geometry ops used by the editor and validation.

**Files:**
- Create: `src/lib/plan/geometry.ts`, `src/lib/plan/geometry.test.ts`.

Functions to implement with tests first (each as its own TDD cycle):
- `polygonAreaMm2(p)` — shoelace.
- `polygonIsClosed(p)` — first ≈ last (within ε).
- `pointInPolygon(p, poly)` — ray casting.
- `polygonsOverlap(a, b)` — SAT for convex, general for concave.
- `snapToGrid(point, stepMm)`.
- `rotateAround(point, center, deg)`.
- `polygonBounds(p)` — min/max for bbox.
- `insetPolygon(p, mm)` — for clearance checks.

Commit per function or in one commit at the end of the task: `feat: plan geometry helpers`.

### Task 7: JSON Patch diff/apply for plan revisions

**Objective:** Every LLM edit is a JSON Patch the user confirms.

**Files:**
- Create: `src/lib/plan/diff.ts`, `src/lib/plan/diff.test.ts`.

Use `fast-json-patch` (add dep). Implement:
- `planToJsonPatch(before, after)` — produces minimal op list.
- `applyPatch(plan, patch)` — applies then re-validates with `ProjectSchema`.
- `summarizePatch(patch)` — human-readable string ("Add 600mm base cabinet at (1200, 800)").

Commit: `feat: json-patch diff/apply for plan revisions`.

### Task 8: Plan validation

**Objective:** Reject invalid plan states before they hit storage.

**Files:**
- Create: `src/lib/plan/validate.ts`, `src/lib/plan/validate.test.ts`.

Rules:
- Room polygon must be simple (no self-intersections).
- Every wall must reference two polygon vertex indices in range.
- Every opening must reference an existing wall.
- Every `PlacedItem.position` must lie inside the room polygon (with a 1mm ε).
- Two items with overlapping footprints → warning, not error.

Commit: `feat: plan validation`.

---

## Phase 2 — Photo capture & extraction (tasks 9–13, incl. 10.5 and 10.6)

### Task 9: Photo upload + EXIF normalization

**Objective:** Upload endpoint that saves photos with EXIF orientation baked in.

**Files:**
- Create: `src/app/api/upload/route.ts`, `src/lib/exif.ts`, `src/lib/exif.test.ts`.

Use `exifr` to read orientation; use `sharp` (add dep) to re-encode the image rotated correctly. Store under `data/projects/<id>/photos/<photoId>.jpg`. Return the saved photo metadata.

Commit: `feat: photo upload with EXIF normalization`.

### Task 10: Reference-marker UI

**Objective:** On each uploaded photo, let the user drag a rectangle over a known-size object and pick the object kind.

**Files:**
- Create: `src/components/PhotoCapture.tsx`, `src/components/ReferenceMarker.tsx`.

Mobile-first: tap-and-drag draws the box. Dropdown to pick known-size object; "Custom" opens a numeric input. Persist to project on each change.

Commit: `feat: reference-marker ui`.

> ⚠️ Partial. Shipped mouse-only handlers, box stored in CSS pixels (not natural image pixels), no custom input, no preview, and no persistence. `PhotoCapture.tsx` was not created. Completed in Task 10.5.

### Task 10.5: Hardening (from the post-Task-10 review)

**Objective:** Fix defects in merged code and migrate to the target data model before building anything else on top of it. Each item: failing test first.

**Files:**
- Modify: `src/lib/storage/projects.ts`, `src/app/api/upload/route.ts`, `src/components/ReferenceMarker.tsx`, `src/lib/plan/schemas.ts`, `src/lib/plan/diff.ts`, `src/lib/plan/validate.ts`, `src/lib/plan/geometry.ts`, `src/lib/llm/schemas.ts`, `src/lib/llm/prompts.ts`, fixtures, `package.json`.
- Create: `src/lib/plan/reference-objects.ts`, `src/app/api/projects/[id]/photos/[photoId]/route.ts`, `src/components/PhotoCapture.tsx`.

**Steps:**
1. **Path traversal.** `projectDir()` validates `id` as a UUID and throws otherwise; the upload route returns 400 on a bad id and 404 if the project doesn't exist. Test: `projectId=../../etc` is rejected and nothing is written outside `data/projects/`.
2. **Register uploaded photos.** Upload loads the project, appends the `Photo`, bumps `updatedAt`, and calls `saveProject`. Remove the `.ref.json` sidecar. Add a `setReference(projectId, photoId, referenceObject)` write (a REST route). Serialize writes per project (simple in-process mutex) so concurrent uploads don't lose photos.
3. **Serve photos.** `GET /api/projects/[id]/photos/[photoId]` streams the JPEG with the same id validation. `photoId` must match an entry in `project.photos`.
4. **Reference sizes.** Create `reference-objects.ts` (`{ longMm, shortMm }` per kind); delete the size tables in the upload route and `ReferenceMarker`. Drop `tape_measure`. Add `side` to the reference schema.
5. **ReferenceMarker.** Use pointer events (mouse + touch + pen) with `touch-action: none`; convert to natural pixels via `naturalWidth / clientWidth`; draw a live preview rectangle; custom-size input; long/short side selector; call `setReference` on change. Remove the leftover stream-of-thought comments. Create `PhotoCapture.tsx` (file input with `capture="environment"`, multi-select, upload progress).
6. **Dependencies.** `react-konva@^19` (v18 doesn't support React 19).
7. **Dedup.** Move `signedArea` / `segsIntersect` / self-intersection from `llm/schemas.ts` and `validate.ts` into `geometry.ts`. Replace the two different `RefineResult` types (`llm/schemas.ts`, `plan/diff.ts`) with one shared type.
8. **Data model migration** (see Data Model): walls derived from polygon edges (`{ id, thicknessMm }`, `walls.length === polygon.length`), `PlacedItem.sizeMm`, `PlanRevision.inverse`, `Room.measurements`, patch-path allowlist + `baseRevision` check in `diff.ts`, history cap. `validate.ts` uses `sizeMm` + rotation instead of the 600×600 placeholder. Update fixtures; update `ExtractedRoomSchema` so walls are per-edge.

**Verify:** `npm run lint && npm run typecheck && npm test` green; manual on a phone: upload a photo, draw a box with a finger, reload — the reference persists.

Commit: `fix: post-review hardening + data model migration`.

### Task 10.6: Measured walls + manual room sketch

**Objective:** Give the plan a trustworthy scale and a zero-LLM path to a valid room.

**Files:**
- Create: `src/components/RoomSketch.tsx`, `src/lib/plan/scale.ts`, `src/lib/plan/scale.test.ts`.

**Steps:**
1. `scale.ts`: `rescaleRoomToMeasurements(room)` — uniform scale so the measured wall matches exactly; with two measurements, use the average scale factor and return the residual so the UI can warn when they disagree by >5%.
2. `RoomSketch.tsx`: "Rectangle W × D" quick start, plus tap-to-add corners on a grid; tap a wall to type its measured length (stored in `room.measurements`).
3. Saves through the normal diff/confirm path (`source: 'user'`).

**Verify:** A user with no API key can create a project, sketch a 3000 × 4000 room, and see it persisted.

Commit: `feat: measured walls + manual room sketch`.

> ✅ Done. Also added the write path the sketch needs: `POST /api/projects` (create) and `POST /api/projects/[id]/revisions` (the single plan-edit endpoint: `commitRevision` under the project lock; 400 invalid edit, 409 stale `baseRevision`). `src/lib/id.ts` provides UUIDs over plain HTTP, where `crypto.randomUUID` is unavailable. Verified over HTTP against the dev server with no `LLM_API_KEY`.

### Task 11: Vision extraction endpoint

**Objective:** `POST /api/projects/[id]/extract` calls the vision LLM and returns a validated candidate `Room`.

**Files:**
- Create: `src/app/api/projects/[id]/extract/route.ts`, `src/lib/llm/extract.ts`, `src/lib/llm/images.ts` (+ tests).

Steps:
1. Request body: `{ measurements?: [{ description, lengthMm }] (≤ 4), hint? }` — measurements are described in the user's words ("sink wall"), since the extracted outline's walls don't exist yet.
2. `extractRoom()` → loads photos, **downscales each to ≤1568px long edge** with `sharp` before base64 (uploads can be 20 MB), builds the prompt (measured wall lengths first, reference-object size/side/pixel box as a secondary hint), calls `chatWithVision`, validates with `ExtractedRoomSchema` + `refineExtractedRoom`, then applies `rescaleRoomToMeasurements` and returns a candidate `Room` plus `confidence` and `notes`.
3. The model returns `measuredWalls` — for each measurement, the edge it describes — so the rescale has an anchor. Reference boxes are mapped into the downscaled image's pixels.
4. Request timeout (60s) and a single retry that feeds the Zod/refine errors back to the model.
5. **Important:** does NOT mutate the project. Returns `{ room, confidence, notes, scale, residual, warnings, baseRevision, patch }`; the client commits `patch` via `POST .../revisions` on confirm.
6. Status codes: 400 bad body / no photos, 404, 502 LLM failure, 503 no `LLM_API_KEY` (manual sketch still works).
7. Commit: `feat: vision extraction endpoint`.

> ✅ Done. Removed the unused `@trpc/*`, `@tanstack/react-query`, and `openai` packages. The dev-server integration test runs against a fake OpenAI-compatible server via `LLM_BASE_URL`, exercising the real provider over HTTP.

### Task 12: Diff preview component

**Objective:** Show the candidate room side-by-side with current state and require an explicit confirm.

**Files:**
- Create: `src/components/DiffPreview.tsx`, `src/components/DiffPreview.test.tsx`.

Steps:
1. Render current vs proposed room polygon on a small canvas.
2. List openings/walls as a table of changes; for LLM proposals show `confidence` and `notes` prominently.
3. "Apply" posts the patch to `POST /api/projects/[id]/revisions` with `baseRevision` (409 → "plan changed, re-run"); "Discard" drops it.
4. Commit: `feat: diff preview component`.

> ✅ Done. The change list comes from `src/lib/plan/changes.ts` (`describePlanChanges`, compares whole plans, so wording is about walls and items, not JSON paths; a full room replacement reads as one "All walls replaced" line). Both thumbnails share one scale via the shared `PlanThumbnail` component, which `RoomSketch` now uses too.

### Task 13: Project page shell + routing

**Objective:** Wire up `/project/[id]` to load a project, render the photo panel and (empty for now) floor plan canvas.

**Files:**
- Create: `src/app/project/[id]/page.tsx`, `src/app/layout.tsx` (extend), `src/store/editor.ts` (Zustand store).

Commit: `feat: project page shell`.

> ✅ Done. `/project/[id]` (server page, 404 for malformed/unknown ids) renders `ProjectEditor`: current room, photos with reference marking, "Room from photos" (`ExtractPanel`), "Or sketch it by hand" (`RoomSketch`), and `DiffPreview` for every change. `src/store/editor.ts` holds the saved project and at most one pending proposal (`src/lib/plan/proposal.ts`). `/` got a minimal project list and create form (Task 25 adds thumbnails, rename, delete). Playwright e2e now runs on its own port with a throwaway `DATA_DIR` and covers creating a project, sketch → review → apply → reload, and dragging a reference box with a real pointer (checked in natural pixels).

---

## Phase 3 — Floor plan editor (tasks 14–19)

### Task 14: Konva canvas + viewport

**Objective:** Render the room polygon on a pannable/zoomable canvas with a unit-aware ruler.

**Files:**
- Create: `src/components/FloorPlanCanvas.tsx`.

Use `react-konva`. Initial: render polygon + walls only. Snap-to-grid on. Mobile: pinch zoom, two-finger pan.

Commit: `feat: floor plan canvas`.

> ✅ Done. Viewport math is pure and unit-tested in `src/lib/plan/viewport.ts` (fit, zoom-at-point, pan, pinch, ruler ticks in m/mm or ft/in, adaptive grid step, `formatLength`). `FloorPlanCanvas` owns gestures on the wrapper with pointer events (one pointer pans, two pinch; wheel zooms at the cursor without scrolling the page) and draws HTML rulers; `FloorPlanStage` is the Konva drawing (walls at real thickness, openings, items, wall labels inside the room), loaded client-only. `next.config.ts` aliases Konva's optional `canvas` dependency away (it broke every route's compile). Snapping lands with vertex dragging in Task 15; the grid it will snap to is drawn now. Canvas behaviour is covered by Playwright (pixel checks, wheel, drag, buttons, a real CDP two-finger pinch).

### Task 15: Drag-to-edit walls and polygon vertices

**Objective:** User can drag polygon vertices and add/remove vertices.

**Files:** extend `FloorPlanCanvas.tsx`; create `src/lib/plan/room-edit.ts`, `src/lib/plan/room-edit.test.ts`.

Because walls are derived from polygon edges, `room-edit.ts` owns the bookkeeping (TDD):
- `insertVertex(room, edgeIdx, point)` splits wall `edgeIdx` into two (original id keeps the first half, new id for the second); openings move to whichever half contains them, with `positionMm` remapped.
- `removeVertex(room, vertexIdx)` merges the two adjacent walls; openings are remapped onto the merged wall.
- `moveVertex(room, vertexIdx, point)` keeps opening positions proportional along the resized walls and drops `measurements` for the changed walls (they're no longer true).
- Every edit goes through the diff path as `source: 'user'` so undo works.

> ✅ Done. `room-edit.ts` (17 tests) plus a pure hit test (`canvas-hit.ts`) that decides whether a pointer grabs a corner, taps a wall's "+" handle, or pans — so all gestures stay in `FloorPlanCanvas`'s pointer handlers. "Edit outline" mode: drag corners (snap to 50 mm, toggleable — the plan's "free placement" mode), "+" on a wall adds a corner, "Delete corner" removes the selected one. Direct edits commit immediately via `/revisions` (no review dialog; that's for LLM proposals) using the shared `submitRevision()` client helper; edits that fail `validateRoom` (e.g. crossing walls) are refused before saving. The view no longer refits after an edit — only when the room is replaced wholesale.

Commit: `feat: edit room polygon`.

### Task 16: Insert doors/windows on walls

**Objective:** Click a wall → drop a door/window at the click position; drag to resize width.

**Files:** extend `FloorPlanCanvas.tsx`, add `src/lib/plan/openings.ts`.

Commit: `feat: insert openings`.

> ✅ Done. `openings.ts` (18 tests): `nearestWallPoint`, `addOpening` (standard sizes — door 800, window 1200, pass-through 900 mm — centred on the tap, shifted/narrowed to fit), `resizeOpening` (either end, min 300 mm), `moveOpening`, `removeOpening`; none let an opening leave its wall or overlap a neighbour, and `validateRoom` now rejects overlaps too. In edit mode: "Add door / window / pass-through" then tap a wall; drag an opening's end squares to resize or its body to slide (50 mm snap); Delete acts on the selected corner or opening; the selected opening's width and position are shown in the project's units; a colour legend explains the opening kinds.

### Task 17: Catalog loader + sidebar

**Objective:** Load the curated seed plus the parametric generator's output (Task 18); render as a searchable, filterable sidebar.

**Files:**
- Create: `src/lib/catalog/schema.ts` (`CatalogItemSchema`), `src/lib/catalog/loader.ts`, `src/lib/catalog/loader.test.ts`, `src/components/CatalogSidebar.tsx`, `src/lib/catalog/seed.json`.

Each item also has a `mount` level (`floor` / `counter` / `wall`), snapshotted onto `PlacedItem`: overlap checks only compare items at the same level, so a wall cabinet above a base cabinet, a hood above a range, or a microwave on a counter isn't flagged.

The curated seed covers the non-cabinet items with standard dimensions: refrigerator (standard + counter-depth), range/cooktop (600/760/900), dishwasher, sink base, microwave, range hood, island, dining table (4 sizes), chair, stool. Cabinets come from the generator. Each item: `{ id, category, name, sizeMm: {w,d,h}, tags: string[], clearanceMm?: {front, sides} }` — the footprint is `sizeMm.w × sizeMm.d`. The loader validates every item with Zod and fails loudly on duplicate ids.

Commit: `feat: catalog sidebar + seed`.

> ✅ Done. 24 seed items (`src/lib/catalog/seed.json`), `CatalogItemSchema` (`schema.ts`), `buildCatalog` / `loadCatalog` / `searchCatalog` (`loader.ts`; every invalid item reported at once, duplicate ids fail), and `CatalogSidebar` (search in any word order, category filter, sizes in project units). The catalog is bundled static data, identical on server and client. Mounted browse-only on the project page; Task 19 passes `onPick` to place items.

### Task 18: Parametric catalog generator

**Objective:** Generate standard cabinet variants deterministically, so the catalog is complete without depending on any external source.

**Files:**
- Create: `src/lib/catalog/generator.ts`, `src/lib/catalog/generator.test.ts`.

Produces base, wall, and tall cabinets in standard widths (300/400/450/600/800/900/1200 mm), with type-appropriate depths (wall 300–350, base 560–610, tall 560–610) and heights (base 720, wall 720/900, tall 2100). Also corner base/wall units and filler strips (50/75/100).

Tests assert: deterministic, stable ids (e.g. `base-600x560x720`) so saved plans keep resolving; no duplicate ids with the seed; every item passes `CatalogItemSchema`.

> Scraping IKEA / retailer sites was dropped (brittle, ToS risk, little value over standard dimensions). See Out of Scope.

Commit: `feat: parametric catalog generator`.

> ✅ Done. 40 cabinets: base in 7 widths × 560/610 deep, wall in 7 widths × 720/900 high (320 deep, `mount: 'wall'`), 4 tall pantries, corner base 900 × 900 and corner wall 600 × 600, and base/wall fillers at 50/75/100 mm. `loadCatalog()` merges seed + generated; `buildCatalog` would fail on any id clash.

### Task 19: Place items on the plan

**Objective:** Drag from sidebar → drop on canvas → snap to grid → validate inside polygon → store as `PlacedItem` (with `sizeMm` copied from the catalog item).

Clearance rules (resolved yes, from Open Questions): `validate.ts` emits **warnings** when an item's `clearanceMm.front` zone overlaps another item or a wall, and when a door swing overlaps an item.

> ✅ Done. Pick an item in the catalog, tap the plan: `placement.ts` puts it back-to-wall facing into the room when the tap is within its depth + 300 mm of a wall (snapped along the wall, kept within it), otherwise on the 50 mm grid; wall-mounted items must go on a wall. Placed items snapshot size, mount, clearance and a tag. Tap to select (again to cycle through stacked items: wall cabinet → base cabinet), drag to move (re-snaps to walls), Rotate 90° / Remove item. Clearance warnings (front zone, side zones, door swings; floor-level items only) are listed under the canvas as "Heads up" and name items by catalog id. The canvas now draws walls outward from the outline with mitred corners (`walls.ts`) — the outline is the interior face, as tape measurements are — and wall-length labels sit outside the walls, along them.

**Files:**
- Modify: `src/components/FloorPlanCanvas.tsx`, `src/components/CatalogSidebar.tsx`.
- Add: `src/lib/plan/placement.ts`.

Commit: `feat: place catalog items`.

---

## Phase 4 — LLM-driven refinement (tasks 20–22)

### Task 20: Chat panel + refinement endpoint

**Objective:** User types natural-language edits; the LLM returns **typed commands** that the server compiles into a JSON Patch against the current plan.

**Why commands, not raw JSON Patch:** LLM-authored patches address arrays by index (`/items/3/position`), which breaks the moment indices shift, and they can target any field. Commands reference stable ids and a small verb set; the compiler owns the paths.

**Files:**
- Create: `src/lib/plan/commands.ts`, `src/lib/plan/commands.test.ts`, `src/components/ChatPanel.tsx`.
- Create: `src/app/api/projects/[id]/refine/route.ts`.
- Modify: `src/lib/llm/prompts.ts` (add `buildRefinePrompt`), `src/lib/llm/schemas.ts` (add `RefinementSchema`).

Command set (discriminated union on `type`):
```ts
addItem{ catalogId, x, y, rotationDeg } | moveItem{ id, x, y } | rotateItem{ id, rotationDeg }
| removeItem{ id } | setWallThickness{ wallId, thicknessMm }
| addOpening{ wallId, kind, positionMm, widthMm, heightMm } | removeOpening{ id } | renameProject{ name }
```
`compileCommands(project, commands, catalog)` → `{ patch, inverse }`, or an error naming the bad id. `addItem` copies `sizeMm` from the catalog.

Prompt contract:
- System: explains the plan (compact), the command set, and mm units.
- User: current plan (items with id/catalogId/position/rotation, walls with id/length, openings), the user's instruction, the catalog filtered to plausibly-referenced items.
- Response: `z.object({ commands: z.array(CommandSchema), summary: z.string() })`.

Server compiles, runs `validatePlan` on the result, and returns `{ patch, summary, warnings, baseRevision }`; client shows it in `DiffPreview`; on confirm, applies.

> ✅ Done. `POST /api/projects/[id]/refine` `{ message, history? }` → `{ commands, patch, summary, reply, warnings, baseRevision }` (never mutates). The model sees the plan as compact text (`src/lib/llm/plan-context.ts`) with short refs — walls `w1…` matching the on-screen numbers, with compass sides (north is up); openings `o1…`; items `i1…` with facing and the wall they're against — plus the catalog. Commands (`src/lib/plan/commands.ts`) can place items by `wall` + `alongMm`, reusing the canvas's back-to-wall placement, or by x/y. Compile errors and malformed JSON get one retry with the problem fed back; only warnings the change introduces are reported; the model may just `reply` (questions, unclear requests). `ChatPanel` keeps the conversation on the page and sends the last turns as history; edits go to the review dialog. Real test with free models: "move the fridge to the north wall", "add a dishwasher on the east wall", and a question all correct in 5–15 s.

Commit: `feat: chat panel + refinement endpoint`.

### Task 21: Layout proposals ("design a U-shape")

**Objective:** Higher-level command: "design me an L-shape with the fridge near the sink". LLM proposes several `PlacedItem`s at once.

**Files:**
- Modify: `src/app/api/projects/[id]/refine/route.ts` (or a sibling `layout/route.ts`), `src/lib/llm/prompts.ts`.

Same command/diff/confirm flow as Task 20 (mostly `addItem` commands). The prompt includes room geometry, door/window locations, clearance rules, and the catalog.

> ✅ Done. Same chat and endpoint; the model tells a layout from a small edit. New command `addRun{ wall, items[], from? }`: the model lists a row of catalog ids for one wall and the server packs them back to back (`src/lib/plan/runs.ts`), skipping doors and pass-throughs, windows (for wall cabinets and items ≥ 1400 mm tall), items already there at the same level, and the corner taken by a run on the neighbouring wall; wall cabinets sit above base cabinets but not above a fridge. A run that doesn't fit fails with the space needed and what's in the way, which feeds the one retry. The refine prompt (v1.1.0) adds a short layout guide (L/U/galley, work triangle, dishwasher by the sink, sink not range under a window, hood aligned over the range). Live with free models: "add an island" 17 s; "design me an L-shaped kitchen with the fridge near the sink" gave a sensible L (sink under the window, dishwasher beside it, fridge at the corner, range with hood on the other wall) in 212 s. Gemma was rate-limited; dots reasons for 2–4 min on a whole layout and ignores reasoning caps (7 s with reasoning off, but the layouts were wrong), so `LLM_TIMEOUT_MS` is now 300 s. Known gap: at an L corner the front-clearance check flags the two runs meeting (e.g. "not enough room in front of the corner cabinet").

Commit: `feat: layout proposals`.

### Task 22: Undo/redo + revision history

**Objective:** Every applied patch is appended to `history` with its `inverse`. UI exposes undo/redo.

- Undo applies `inverse`; redo re-applies `patch`. Both go through the path allowlist and bump `revision`.
- `inverse` is computed at apply time as `planToJsonPatch(after, before)` restricted to allowlisted paths — no hand-written inverses.
- History is capped at 200 entries (oldest dropped).

> ✅ Done. Undo and redo are revisions like any other (`src/lib/plan/history.ts`): an undo applies the `inverse` of the change it reverts and is marked `undoes: <revision>`; a redo applies the undo's `inverse` and is marked `redoes`. Both go through `commitRevision` (allowlist, validation, stale check). What undo/redo act on next is derived by replaying the history, so it survives reloads and the 200 cap; a new edit clears redo. `POST /api/projects/[id]/undo` `{ action, baseRevision }`. The editor shows Undo / Redo (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y, ignored while typing), the last change, and a collapsible list of the last 20 revisions (`HistoryControls`). No canvas changes were needed.

**Files:**
- Modify: `src/lib/plan/diff.ts`, `src/lib/storage/projects.ts`, `src/components/FloorPlanCanvas.tsx`.

Commit: `feat: undo/redo`.

---

## Phase 5 — Export & polish (tasks 23–26)

### Task 23: SVG export

**Objective:** Render the plan to a clean, dimensioned SVG.

**Files:**
- Create: `src/lib/plan/svg.ts`, `src/lib/plan/svg.test.ts`, `src/app/api/export/[id]/svg/route.ts`.

Output: walls as black strokes, openings as arcs (doors) and double lines (windows), items as labeled rectangles, a ruler, and a scale bar. mm units.

> ✅ Done. `planToSvg(project, { labels })` (`src/lib/plan/svg.ts`) draws a 1:50 drawing in plan mm (document width/height in paper mm): mitred black walls (`wallQuads`), openings cut into them — doors with the leaf and a dashed swing arc (hinged at the start, opening inward, as in the clearance check), windows as two glass lines, pass-throughs as a plain gap — items as outlines with a heavy front edge and fitted, never-upside-down labels (wall cabinets dashed), each wall's length on a dimension line outside it (numbered like the canvas, in the project's units), a 2 m (6 ft) scale bar, a north arrow, and a title block (name, scale, revision, date). Instead of rulers, every wall is dimensioned. `GET /api/export/[id]/svg` labels items with catalog names; the editor header has "Download drawing (SVG)".

Commit: `feat: svg export`.

### Task 24: PNG export

**Objective:** Rasterize the SVG to PNG at 1× and 2× via `sharp`.

> ✅ Done. `GET /api/export/[id]/png?scale=1|2` rasterizes the Task 23 drawing with `sharp` (`src/lib/export/drawing.ts`, shared with the SVG route). 1× is 1 px per 5 mm of plan (a 5 m room ≈ 1000 px wide), 2× doubles it; white background, no alpha; file names `<name>.png` / `<name>@2x.png`. The editor header links SVG · PNG · PNG (2×). Wall polygons get a hairline stroke so mitred corners show no anti-aliasing seams.

**Files:**
- Create: `src/app/api/export/[id]/png/route.ts`.

Commit: `feat: png export`.

### Task 25: Project list page + PWA manifest

**Objective:** `/` lists projects (thumbnail from current plan SVG), lets you create/rename/delete. PWA manifest + icons so it installs on phones.

> ✅ Done. `/` shows a card per project (newest first): a thumbnail of the current plan (the existing `PlanThumbnail` drawn inline from the room and items the list now returns — lighter than fetching each project's full SVG export), name, revision and date. **Rename** is saved as a normal revision (`Rename to …`), so it can be undone on the project page; **Delete** asks in place, then `DELETE /api/projects/[id]` removes the project and its photos (after any save in flight; permanent, no trash). `public/manifest.json` (standalone, dark theme colour) with 192/512 px icons, a maskable icon and an Apple touch icon, all generated by `node scripts/make-icons.mjs`; the layout links them. There is no service worker, so the app needs the server: it installs and opens like an app but doesn't work offline. Phones need to reach the server over HTTPS (or localhost) to offer installation.

**Files:**
- Create: `src/app/page.tsx`, `public/manifest.json`, `public/icons/icon-192.png`, `public/icons/icon-512.png`.

Commit: `feat: project list + pwa`.

### Task 26: End-to-end happy-path test

**Objective:** Playwright drives a real browser through: open app → new project → upload 1 mock photo → enter one measured wall length → click "Extract" → confirm the diff → place 1 cabinet → export SVG.

**Files:**
- Create: `tests/e2e/happy-path.spec.ts`, `tests/e2e/fixtures/kitchen-photo.jpg` (a synthetic test image with a credit-card-sized marker).

The e2e test must mock the LLM HTTP call.

> ✅ Done. `tests/e2e/happy-path.spec.ts` runs the whole journey in one test: new project → upload the synthetic `fixtures/kitchen-photo.jpg` → measured wall ("sink wall", 4000 mm) → "Get room from photos" → review and Apply → place a base cabinet → download the SVG and check it. The extract response is mocked in the browser (the e2e server has no LLM key); its patch is built with `planToJsonPatch` from the saved project. The real endpoint → provider path stays covered by `tests/integration/dev-server.test.ts`. Manual walkthrough: `docs/testing-guide.md`.

Commit: `test: e2e happy path`.

---

## Phase 6 — Closets (tasks 27–34)

Reach-in closets as a second project kind, designed on a front elevation. Design: `docs/superpowers/specs/2026-10-04-closet-design.md`. Code: `src/lib/closet/*`, `src/components/Closet*.tsx`, `src/lib/llm/closet.ts`.

### Task 27: Project kind + closet schema
> ✅ Done. `ProjectSchema` gets an optional `kind` (`'kitchen'` when absent, so old projects load unchanged) and a `closet` (size, door opening, components). `validatePlan` requires a closet exactly on closet projects. `/closet/**` joins the patch allowlist (`/kind` stays non-editable). `createProject` / `POST /api/projects` take `kind`; a closet starts 1830 × 2440 × 610 with a full-width bifold opening, and its room is its footprint.

### Task 28: Closet catalog + validation
> ✅ Done. `closet/catalog.ts`: eight generic component kinds with standard sizes. `closet/validate.ts`: errors (outside the closet, too deep, bad counts, opening past the side) and warnings (overlapping boxes, a shelf through a box, 950 mm garment drop below rods, 50 mm hanger clearance, drawers behind the doors' stack-back or across sliding-door halves, things hidden over 300 mm past the opening, shelves above 2200 mm, non-standard widths).

### Task 29: Closet commands
> ✅ Done. `closet/commands.ts`: `setClosetSize`, `setOpening`, `add/move/resize/removeComponent` (refs c1…), `renameProject` → patch; components are clamped inside the closet; a full-width opening follows width changes. `closet/changes.ts` describes closet edits for the diff preview.

### Task 30: Elevation drawing + export
> ✅ Done. `closet/drawing.ts` produces plain shapes shared by `closetToSvg` (dimensioned 1:50 export; PNG via the same rasterizer) and the `ClosetElevation` React SVG used by the project list (with a "Closet" badge) and the diff preview.

### Task 31–32: Closet editor
> ✅ Done. `ClosetEditor` (elevation, palette, selected-component details with exact sizes, size and doors form) and `ClosetElevationCanvas` (tap to place, drag to move with edge/grid snapping, side handles to resize). Plain SVG rather than Konva: the closet is small enough to need no pan/zoom, and SVG is testable in jsdom. Interaction math is pure in `closet/canvas.ts`.

### Task 33: Closet chat
> ✅ Done. `/refine` routes closet projects to `refineCloset` (`llm/closet.ts`): the closet as text (incl. where drawers clear the doors and current problems), a closet-design prompt with US standard heights, and the closet command compiler with the usual one retry.

### Task 34: Naming + e2e
> ✅ Done. The app is "Home Design". `tests/e2e/closet.spec.ts` covers create → place → drag → warnings → undo → export → list card, and size/doors → reviewed chat edit.

---

## Phase 7 — Example layouts (tasks 35–39)

`tests/integration/example-layouts.test.ts` builds example kitchens and closets through the real create and revisions routes and expects each to reload valid with **no warnings**. Building the first seven surfaced two bugs; this phase fixes them and widens the gallery to exercise every command, opening style, component kind and most catalog items.

### Task 35: Runs keep side clearance
> ✅ Done.

`packRun` packs pieces back to back, so a fridge (50 mm side clearance) in a run lands tight against its neighbour and always warns, and so does a run that starts in a corner. Fix: a piece with `clearanceMm.sides` reserves that gap on both sides (against walls, neighbours and existing items); existing items with side clearance are padded the same way. Unit tests in `runs.test.ts`; the galley example goes back to a fridge inside the run.

### Task 36: Seats don't block tables and islands
> ✅ Done.

A table's or island's front/side clearance is where its chairs and stools go, but `validatePlan` counts them as obstructions, so any seated table warns. Fix: for an item tagged `table` or `island`, items tagged `chair` or `stool` don't block its clearance zones (walls and other furniture still do; seats still block cabinets). Unit tests in `validate.test.ts`.

### Task 37: Ten more example kitchens
> ✅ Done — studio, long narrow, open plan for six, island with breakfast bar, a six-wall L-shaped room, a remodel (remove/move/pass-through, a mistake undone), entertainer's, an L with a corner cabinet, thick-walled cottage, rotated prep island. 51 of the 64 catalog items are used (every kind; only some size variants aren't). Building them found two more bugs, fixed:
> - **x/y placement snapped to walls.** `addItem`/`moveItem` with x/y went through the canvas drop snapping (within depth + 300 mm of a wall → flush against it), so a table 1.2 m from a wall, or a chair beside a table, was moved and turned. Commands now place free-standing items exactly at x/y (`positionItem(…, { free: true })`); wall-mounted items still go to the nearest wall.
> - **Corner cabinets warned in every L.** The corner base's 900 mm straight-ahead clearance pointed at the other run. Items tagged `corner` now skip that check; the runs beside it cover its access.

Diverse rooms (L-shaped room, long narrow, square, big open plan, small studio, thick walls…), all three run anchors, both fridge depths and the 600 fridge, every range/hood/dishwasher/microwave/sink, the three islands, every table with seating, base/wall/tall/corner/filler cabinets, deep bases and tall uppers; follow-up revisions with `moveItem`, `rotateItem`, `removeItem`, `removeOpening`, `setWallThickness`, `renameProject`; and an undo.

### Task 38: Ten more example closets
> ✅ Done — wall-to-wall sliding, open mudroom nook, pantry, broom closet, couple's 8' reach-in, sliding linen with tower, kid's closet refitted for a teen, remeasured closet (a mistake undone), wardrobe with offset doors, 9' high-ceiling closet. All built cleanly on the first try; the high-ceiling closet's step-stool warning is expected and asserted.

Every door style (bifold, sliding, hinged, open) with offset openings, every component kind (shelf, rod, tower, drawers, shoe shelf, basket, hooks, valet rod) with counts and custom sizes, sizes from a 2' broom closet to a 10' wall, and follow-up revisions with `moveComponent`, `resizeComponent`, `removeComponent`, `setClosetSize`, `renameProject`.

### Task 39: Record results
> ✅ Done. 28 example tests (13 kitchens, 14 closets, the sample cleaning closet), all clean. `EXAMPLES_DATA_DIR=./data npx vitest run tests/integration/example-layouts.test.ts` writes them into the app's data to browse. Known gaps, not fixed: chairs don't need room behind them to pull out; an island's back (seating side) has no clearance at all.

Layouts that can't be built cleanly are noted here with the reason, not forced through.

---

## Tests / Validation Strategy

- **Unit (Vitest):** geometry, JSON Patch (incl. allowlist + inverse round-trip), Zod schemas, room-edit, scale, commands compiler, catalog loader/generator, plan validation, SVG generation. Target ≥ 80% lines on `src/lib/**`.
- **Integration (Vitest):** route handlers called directly with a stub LLM; one live `next dev` suite (`tests/integration/dev-server.test.ts`) against a fake OpenAI-compatible server.
- **E2E (Playwright):** exactly one happy-path test (Task 26). Keep it tight.
- **Manual QA gate at each phase boundary:** open the app on a real phone, do the happy path by hand.

## Risks, Tradeoffs, Open Questions

| Risk | Mitigation |
|---|---|
| Vision LLMs guess dimensions when they shouldn't | User-measured walls are the scale source of truth; server rescales the LLM polygon to match them (Task 10.6/11). Always show the diff + confidence; never auto-apply. Manual sketch path needs no LLM. |
| Reference object gives misleading scale (perspective) | Treated as a secondary hint only; never the sole scale source. |
| LLM edits target wrong array index / forbidden fields | LLM emits typed commands keyed by id; server compiles to JSON Patch; patch-path allowlist + `baseRevision` check on apply. |
| LLM returns invalid JSON | Zod parse + one retry with the validation errors fed back, then surface to user. |
| Path traversal / local file exposure via `projectId`/`photoId` | UUID validation in `projectDir()`; photo route only serves ids listed in the project (Task 10.5). |
| LLM cost/latency with large phone photos | Downscale to ≤1568px before sending; 60s timeout; single retry. |
| Concurrent writes to `project.json` (parallel uploads) | Per-project in-process write lock; atomic rename. |
| Snap-to-grid hides design mistakes | Keep a "free placement" mode for advanced users. |
| Single-user, local storage — sync later? | Data model already uses `Project` JSON documents. Sync layer can be a separate project. |
| Mobile photo quality varies wildly | We don't try to be photogrammetric in v1 — we ask the LLM to reason about rough shape. Document this in the UI. |

**Resolved questions:**
1. Clearance-rule suggestions — **yes**, as validation warnings (folded into Task 19).
2. i18n — **English-only v1.**

**Out of scope / future:**
- Catalog ingest from public/retailer sources (IKEA, etc.).
- Photogrammetric / multi-view metric reconstruction.
- Multi-user sync and cloud storage.

## Execution Notes

- Tasks 1–8 (foundations) are the critical path. Don't skip Task 7 (JSON Patch) — every edit depends on it.
- **Task 10.5 must land before Task 11.** The data model migration touches schemas, diff, validate, and fixtures; everything after builds on the new shape.
- After Task 13 (with 10.5/10.6) you'll have a working "photos + measurement in → proposed room" loop, plus a manual-sketch path. That's the first demo-able milestone.
- After Task 19 you'll have a working manual editor with the catalog. That's the second milestone.
- After Task 22 you'll have LLM-driven refinement. That's the third milestone.
- After Task 26 you're done with v1.

---

## Verification Checklist (run before declaring v1 done)

- [ ] `npm run lint && npm run typecheck && npm test` all green.
- [x] `npx playwright test` green (31 tests, including the happy path).
- [ ] Manual: create project on phone → upload 4 photos → enter one measured wall → extract → confirm room outline; measured wall length matches exactly.
- [ ] Manual: with no `LLM_API_KEY`, sketch a room by hand and place items — full editor works.
- [ ] Manual: drag fridge from sidebar onto plan → export SVG → opens cleanly in browser.
- [ ] Manual: chat "move the fridge to the north wall" → diff shows the move → apply → persisted after reload.
- [ ] Switching `LLM_BASE_URL` to a local llama.cpp server still works (proves the abstraction holds).