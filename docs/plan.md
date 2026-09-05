# Kitchen Design App — Implementation Plan

> **For Hermes:** This plan is sized for `subagent-driven-development` (one fresh subagent per task, two-stage review). All file paths are relative to the repo root.

## Goal

A web app (mobile-friendly PWA) that turns a few room photos into an editable 2D kitchen floor plan. Users upload 3–6 photos with a reference object (credit card, tape measure, etc.) for scale; the app extracts rough dimensions and a room outline, drafts a floor plan with an LLM, and then lets the user insert cabinets, appliances, and furniture from a catalog. The LLM is chat-driven for refinement ("move the fridge to the north wall", "swap to an L-shape layout"). Output is JSON + 2D SVG/PNG.

## Decisions (locked in with user)

| Question | Choice |
|---|---|
| Platform | Web (PWA, mobile-first, starts as web app) |
| Photo-to-plan pipeline | MVP: upload N photos + reference object → prompt-driven extraction with vision LLM |
| Catalog | Search public sources first; fall back to generic parameterized boxes (JSON) |
| LLM | OpenAI-compatible interface, default to OpenAI, swap via config (works for any compatible provider: OpenAI, OpenRouter, Together, Groq, local llama.cpp server) |
| Output | JSON + 2D SVG/PNG only. No 3D. |

## Current Context / Assumptions

- New project. No existing code.
- User has OpenAI API key (or equivalent) — read from env var `LLM_API_KEY`.
- Photos come from phone camera; EXIF orientation handled in browser.
- Single-user local app to ship first; multi-user/cloud save is out of scope but the data model supports it (every "project" is a JSON document).
- The LLM is treated as a *proposer*, never the source of truth. Every LLM edit is diffed and shown to the user before being applied. This is non-negotiable for a design tool.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Next.js 15 (App Router)            │
│   React + Tailwind + shadcn/ui + Zustand            │
│   PWA manifest, mobile-first camera capture         │
└──────────────────┬──────────────────────────────────┘
                   │ tRPC
┌──────────────────▼──────────────────────────────────┐
│              Node.js API (Next routes)               │
│  - photo upload + EXIF normalize                    │
│  - LLM provider abstraction (OpenAI-compatible)     │
│  - floor-plan diff/apply with confirmation          │
│  - catalog loader (file + URL cache)                │
└──────────────────┬──────────────────────────────────┘
                   │
       ┌───────────┼────────────┐
       ▼           ▼            ▼
   LLM API    Catalog JSON   File storage
   (env)      (disk)         (./data/projects)
```

Data flow:

1. **Capture:** User takes 4–6 photos + marks a reference object on one photo.
2. **Extract:** Photos + reference object pixels → vision LLM → proposed room outline (JSON: walls, openings).
3. **Refine:** User chats with the LLM to adjust the floor plan. Every proposal comes back as a structured JSON Patch; UI shows a diff and applies on confirm.
4. **Furnish:** User drags items from a sidebar catalog onto the plan; positions/snap are computed locally. LLM can also propose layouts that the user confirms.

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript, Tailwind, shadcn/ui, Zustand for local state, `react-konva` or `pixi.js` for the 2D canvas editor.
- **Backend:** Next.js API routes + tRPC for typed RPC.
- **LLM:** `openai` npm SDK pointed at a configurable base URL (`LLM_BASE_URL`). One abstraction layer with `chat()`, `chatWithVision()`, `completeJSON()`.
- **Storage:** Local filesystem under `./data/projects/<id>/` (photos + plan.json). Easy to swap for S3 later.
- **Testing:** Vitest for unit, Playwright for one end-to-end happy path.
- **Lint/format:** ESLint + Prettier, strict TS.

## Data Model (the contract)

```ts
// Plan document — single source of truth, versioned
type Project = {
  id: string;
  name: string;
  units: 'mm' | 'in';
  createdAt: string;
  updatedAt: string;
  revision: number;            // bumped on every applied edit
  photos: Photo[];
  room: Room;
  items: PlacedItem[];
  history: PlanRevision[];     // undo stack
};

type Photo = {
  id: string;
  path: string;                // relative to project dir
  width: number;
  height: number;
  referenceObject?: {
    kind: 'credit_card' | 'a4_paper' | 'us_letter' | 'tape_measure' | 'coin_us_quarter' | 'custom';
    knownSizeMm: number;        // for built-ins; ignored if 'custom'
    customSizeMm?: number;
    pixelBox: [number, number, number, number]; // user-drawn rectangle
  };
  wallHint?: 'north' | 'east' | 'south' | 'west' | 'unknown';
};

type Room = {
  polygon: [number, number][];  // mm, in plan coords
  walls: Wall[];
  openings: Opening[];
};

type Wall = { id: string; from: [number, number]; to: [number, number]; thicknessMm: number };
type Opening = { id: string; wallId: string; kind: 'door' | 'window' | 'pass_through';
                  positionMm: number; widthMm: number; heightMm: number };

type PlacedItem = {
  id: string;
  catalogId: string;            // FK into catalog
  position: { x: number; y: number };  // mm
  rotationDeg: number;
  tag?: string;                // 'fridge', 'sink', etc. — drives clearance rules
};

type PlanRevision = { revision: number; patch: JsonPatchOp[]; at: string; source: 'user' | 'llm'; summary: string };
```

All LLM responses are validated against a Zod schema matching this shape before they ever touch state. Invalid → retry once → ask user.

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
│   ├── catalog/
│   │   ├── seed.json                  # generic boxes if no public source fetched yet
│   │   └── sources.json               # URLs we tried to ingest (cached fetch log)
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
│   │       ├── trpc/[trpc]/route.ts
│   │       └── upload/route.ts
│   ├── components/
│   │   ├── PhotoCapture.tsx
│   │   ├── ReferenceMarker.tsx        # draw box over credit card
│   │   ├── FloorPlanCanvas.tsx        # Konva-based 2D editor
│   │   ├── CatalogSidebar.tsx
│   │   ├── ChatPanel.tsx              # LLM refinement
│   │   └── DiffPreview.tsx            # show proposed change before apply
│   ├── lib/
│   │   ├── llm/
│   │   │   ├── provider.ts            # interface
│   │   │   ├── openai-compatible.ts   # default impl
│   │   │   ├── prompts.ts             # versioned prompts as functions returning strings
│   │   │   └── schemas.ts             # Zod schemas for every LLM response
│   │   ├── plan/
│   │   │   ├── geometry.ts            # polygon ops, snap, collision
│   │   │   ├── diff.ts                # JSON Patch producer/consumer
│   │   │   └── validate.ts            # room closes? items inside?
│   │   ├── catalog/
│   │   │   ├── loader.ts
│   │   │   └── ingest.ts              # fetches public sources, normalizes to our schema
│   │   ├── storage/
│   │   │   └── projects.ts            # read/write Project JSON, atomic writes
│   │   └── exif.ts
│   ├── server/
│   │   ├── trpc.ts                    # init
│   │   └── routers/
│   │       ├── projects.ts
│   │       ├── photos.ts
│   │       ├── llm.ts                 # extractRoomFromPhotos, refinePlan
│   │       └── catalog.ts
│   └── store/
│       └── editor.ts                  # Zustand
└── tests/
    ├── unit/
    │   ├── geometry.test.ts
    │   ├── diff.test.ts
    │   ├── llm-schemas.test.ts
    │   └── catalog-ingest.test.ts
    └── e2e/
        └── happy-path.spec.ts         # upload 1 photo w/ credit card → see room outline
```

---

## Phase 1 — Foundations (tasks 1–8)

### Task 1: Initialize repo and tooling

**Objective:** Bootstrap Next.js + TS + Tailwind + Vitest + Playwright.

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `.env.example`, `.eslintrc.json`, `.prettierrc`.

**Step 1:** `pnpm create next-app@latest . --ts --tailwind --app --eslint --src-dir --no-import-alias --use-pnpm`
**Step 2:** Add deps: `pnpm add zod zustand @trpc/server @trpc/client @trpc/react-query @trpc/next react-konva konva openai react-dropzone exifr`
**Step 3:** Add dev deps: `pnpm add -D vitest @vitest/ui @testing-library/react @playwright/test happy-dom`
**Step 4:** Configure `tsconfig.json` strict mode, path alias `@/*` → `src/*`.
**Step 5:** Initialize git, first commit.

**Verify:** `pnpm dev` serves the default page; `pnpm test` runs an empty Vitest pass; `pnpm exec playwright install chromium` succeeds.

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

## Phase 2 — Photo capture & extraction (tasks 9–13)

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

### Task 11: Vision extraction endpoint

**Objective:** tRPC mutation that calls the vision LLM and returns a validated `Room`.

**Files:**
- Create: `src/server/trpc.ts`, `src/server/routers/llm.ts`, `src/server/routers/photos.ts`.

Steps:
1. Build `trpc` server + a `trpcClient` provider in `src/app/providers.tsx`.
2. `llm.extractRoom({ projectId })` → loads photos, builds the prompt (including reference-object size and pixel box), calls `chatWithVision`, validates the response with `ExtractedRoomSchema`, and returns a candidate `Room`.
3. **Important:** does NOT mutate the project. The candidate goes back to the client for review.
4. Commit: `feat: vision extraction endpoint`.

### Task 12: Diff preview component

**Objective:** Show the candidate room side-by-side with current state and require an explicit confirm.

**Files:**
- Create: `src/components/DiffPreview.tsx`, `src/components/DiffPreview.test.tsx`.

Steps:
1. Render current vs proposed room polygon on a small canvas.
2. List openings/walls as a table of changes.
3. "Apply" calls `applyPatch` server-side; "Discard" drops it.
4. Commit: `feat: diff preview component`.

### Task 13: Project page shell + routing

**Objective:** Wire up `/project/[id]` to load a project, render the photo panel and (empty for now) floor plan canvas.

**Files:**
- Create: `src/app/project/[id]/page.tsx`, `src/app/layout.tsx` (extend), `src/store/editor.ts` (Zustand store).

Commit: `feat: project page shell`.

---

## Phase 3 — Floor plan editor (tasks 14–19)

### Task 14: Konva canvas + viewport

**Objective:** Render the room polygon on a pannable/zoomable canvas with a unit-aware ruler.

**Files:**
- Create: `src/components/FloorPlanCanvas.tsx`.

Use `react-konva`. Initial: render polygon + walls only. Snap-to-grid on. Mobile: pinch zoom, two-finger pan.

Commit: `feat: floor plan canvas`.

### Task 15: Drag-to-edit walls and polygon vertices

**Objective:** User can drag polygon vertices and add/remove vertices.

**Files:** extend `FloorPlanCanvas.tsx`.

Commit: `feat: edit room polygon`.

### Task 16: Insert doors/windows on walls

**Objective:** Click a wall → drop a door/window at the click position; drag to resize width.

**Files:** extend `FloorPlanCanvas.tsx`, add `src/lib/plan/openings.ts`.

Commit: `feat: insert openings`.

### Task 17: Catalog loader + sidebar

**Objective:** Load `data/catalog/seed.json` and any fetched sources; render as a searchable, filterable sidebar.

**Files:**
- Create: `src/lib/catalog/loader.ts`, `src/lib/catalog/loader.test.ts`, `src/components/CatalogSidebar.tsx`, `src/data/catalog/seed.json`.

The seed must be at least 40 items covering: base cabinet, wall cabinet, tall pantry, refrigerator (counter-depth), range/cooktop, dishwasher, sink, microwave, range hood, island, dining table (4 sizes), chair, stool. Each item: `{ id, category, name, defaultSizeMm: {w,d,h}, footprintMm: {w,d}, tags: string[], clearanceMm?: {front, sides} }`.

Commit: `feat: catalog sidebar + seed`.

### Task 18: Catalog ingest from public sources

**Objective:** Try to pull real catalog data; otherwise ship the seed.

**Files:**
- Create: `src/lib/catalog/ingest.ts`, `src/lib/catalog/sources.ts`, `src/lib/catalog/ingest.test.ts`, `src/data/catalog/sources.json`.

**Sources to attempt (in order, all permissive — best effort):**
1. **IKEA Kitchen JSON** — IKEA's product data has been mirrored in several open datasets; check `https://github.com/IKEA-Products/` mirrors and `https://world.openfoodfacts.org` is not relevant — focus on the IKEA REST API used by their site (kitchen product range JSON). Use a single endpoint with user-agent and respect rate limits.
2. **Houzz** — has no public API; skip.
3. **Home Depot / Lowe's** — no public API; skip.
4. **IKEA DIMENSJÖN / ENHET / SEKTION** measurements from IKEA product spec sheets, scraped from `ikea.com/<country>/en/cat/kitchen-products/` — only if a robots.txt-compliant path exists.
5. **Generic parametric generator** (always succeeds): produces base/wall/tall cabinet variations in standard widths (300/400/450/600/800/900/1200 mm), depths (300/560/610 mm), heights (720/900/2100 mm).

The ingest step:
- Respects `robots.txt` and a per-source rate limit (1 req / 2s).
- Caches the raw response in `data/catalog/raw/<source>.json`.
- Normalizes everything to our `CatalogItem` schema.
- On any network/auth error, falls back to the generator and records what happened in `sources.json`.

Commit: `feat: catalog ingest with fallback`.

### Task 19: Place items on the plan

**Objective:** Drag from sidebar → drop on canvas → snap to grid → validate inside polygon → store as `PlacedItem`.

**Files:**
- Modify: `src/components/FloorPlanCanvas.tsx`, `src/components/CatalogSidebar.tsx`.
- Add: `src/lib/plan/placement.ts`.

Commit: `feat: place catalog items`.

---

## Phase 4 — LLM-driven refinement (tasks 20–22)

### Task 20: Chat panel + refinement endpoint

**Objective:** User types natural-language edits; LLM returns a JSON Patch (or a sequence) against the current plan.

**Files:**
- Create: `src/components/ChatPanel.tsx`, `src/server/routers/llm.ts` (extend), `src/lib/llm/prompts.ts` (extend with `buildRefinePrompt`).

Prompt contract:
- System: explains the plan schema and the JSON-Patch format.
- User: current plan (compact form — only relevant fields), the user's instruction, the catalog (filtered to items that might be referenced).
- Response validated against a `RefinementSchema`:
  ```ts
  z.object({ patch: z.array(JsonPatchOpSchema), summary: z.string() })
  ```

Server returns the patch; client shows it in `DiffPreview`; on confirm, applies.

Commit: `feat: chat panel + refinement endpoint`.

### Task 21: Layout proposals ("design a U-shape")

**Objective:** Higher-level command: "design me an L-shape with the fridge near the sink". LLM proposes several `PlacedItem`s at once.

**Files:**
- Modify: `src/server/routers/llm.ts`, `src/lib/llm/prompts.ts`.

Same diff/confirm flow as Task 20. The prompt includes room geometry, door/window locations, and the catalog.

Commit: `feat: layout proposals`.

### Task 22: Undo/redo + revision history

**Objective:** Every applied patch is appended to `history`. UI exposes undo.

**Files:**
- Modify: `src/lib/storage/projects.ts`, `src/components/FloorPlanCanvas.tsx`.

Commit: `feat: undo/redo`.

---

## Phase 5 — Export & polish (tasks 23–26)

### Task 23: SVG export

**Objective:** Render the plan to a clean, dimensioned SVG.

**Files:**
- Create: `src/lib/plan/svg.ts`, `src/lib/plan/svg.test.ts`, `src/app/api/export/[id]/svg/route.ts`.

Output: walls as black strokes, openings as arcs (doors) and double lines (windows), items as labeled rectangles, a ruler, and a scale bar. mm units.

Commit: `feat: svg export`.

### Task 24: PNG export

**Objective:** Rasterize the SVG to PNG at 1× and 2× via `sharp`.

**Files:**
- Create: `src/app/api/export/[id]/png/route.ts`.

Commit: `feat: png export`.

### Task 25: Project list page + PWA manifest

**Objective:** `/` lists projects (thumbnail from current plan SVG), lets you create/rename/delete. PWA manifest + icons so it installs on phones.

**Files:**
- Create: `src/app/page.tsx`, `public/manifest.json`, `public/icons/icon-192.png`, `public/icons/icon-512.png`.

Commit: `feat: project list + pwa`.

### Task 26: End-to-end happy-path test

**Objective:** Playwright drives a real browser through: open app → new project → upload 1 mock photo with a known-size reference → click "Extract" → confirm the diff → place 1 cabinet → export SVG.

**Files:**
- Create: `tests/e2e/happy-path.spec.ts`, `tests/e2e/fixtures/kitchen-photo.jpg` (a synthetic test image with a credit-card-sized marker).

The e2e test must mock the LLM HTTP call.

Commit: `test: e2e happy path`.

---

## Tests / Validation Strategy

- **Unit (Vitest):** geometry, JSON Patch, Zod schemas, catalog loader, plan validation, SVG generation. Target ≥ 80% lines on `src/lib/**`.
- **Integration (Vitest + supertest-style):** tRPC routes with a stub LLM.
- **E2E (Playwright):** exactly one happy-path test (Task 26). Keep it tight.
- **Manual QA gate at each phase boundary:** open the app on a real phone, do the happy path by hand.

## Risks, Tradeoffs, Open Questions

| Risk | Mitigation |
|---|---|
| Vision LLMs guess dimensions when they shouldn't | Always show the diff; never auto-apply; reject rooms whose polygon area is wildly inconsistent with the reference-object math. |
| Public catalog scraping is brittle / against ToS | Always ship the parametric fallback; treat scraped data as a best-effort enhancement logged in `sources.json`. Never hard-depend on it. |
| LLM returns invalid JSON | Zod parse + one retry with the same prompt + the validation errors, then surface to user. |
| Snap-to-grid hides design mistakes | Keep a "free placement" mode for advanced users. |
| Single-user, local storage — sync later? | Data model already uses `Project` JSON documents. Sync layer can be a separate project. |
| Mobile photo quality varies wildly | We don't try to be photogrammetric in v1 — we ask the LLM to reason about rough shape. Document this in the UI. |

**Open questions to resolve before Phase 4:**
1. Do we want basic clearance-rule suggestions (e.g. "fridge needs 100mm side clearance")? Recommend yes, very low cost.
2. Single language or i18n-ready strings from day one? Recommend English-only v1.

## Execution Notes

- Tasks 1–8 (foundations) are the critical path. Don't skip Task 7 (JSON Patch) — every LLM edit depends on it.
- After Task 13 you'll have a working "photo in → proposed room" loop. That's the first demo-able milestone.
- After Task 19 you'll have a working manual editor with the catalog. That's the second milestone.
- After Task 22 you'll have LLM-driven refinement. That's the third milestone.
- After Task 26 you're done with v1.

---

## Verification Checklist (run before declaring v1 done)

- [ ] `pnpm lint && pnpm typecheck && pnpm test` all green.
- [ ] `pnpm exec playwright test` green (one happy-path test).
- [ ] Manual: create project on phone → upload 4 photos with credit card → extract → confirm room outline.
- [ ] Manual: drag fridge from sidebar onto plan → export SVG → opens cleanly in browser.
- [ ] Manual: chat "move the fridge to the north wall" → diff shows the move → apply → persisted after reload.
- [ ] Switching `LLM_BASE_URL` to a local llama.cpp server still works (proves the abstraction holds).