# Photo workflow and usability improvements

## Context

A code review of the app found that the photo path (capture → upload → extraction → review → size confirmation) is where a new user is most likely to stall, especially on a phone:

- The browser uploads untouched originals (up to 20 MB) although the server shrinks everything to 2560 px.
- A failed upload has no retry or dismiss.
- Nothing says what or how many photos to take, and photos can't be labelled.
- The photo list is a tall stack of full-size images.
- The review step doesn't show the photos the proposal came from.
- Size confirmation is a dropdown of "Wall 3 — north".
- On a phone a new project opens on an empty plan, above the step that adds photos.

The user chose to do all three groups of fixes, in order, as three pull requests.

## Ground rules

- Branch off `main` for each PR; no dependency changes are planned (so the Render build is unaffected).
- `AGENTS.md`: read the relevant guide in `node_modules/next/dist/docs/` before touching route handlers.
- Test-first, matching the existing colocated `*.test.ts(x)` files (vitest + happy-dom + Testing Library).
- Before PR 1, save this design as `docs/superpowers/specs/2026-11-15-photo-workflow-usability-design.md` (repo convention).

## PR 1 — Phone capture flow

**1. Shrink photos in the browser before upload**
- New `src/lib/client/shrink-photo.ts`: `shrinkPhoto(file): Promise<Blob>` using `createImageBitmap(file, { imageOrientation: 'from-image' })` → canvas → JPEG (quality 0.9), long edge capped at the stored size.
- Any failure (undecodable HEIC, no canvas, result larger than the original) returns the original file, so the server path stays the safety net.
- Move `STORED_MAX_EDGE_PX` from `src/lib/exif.ts` (imports `sharp`) to `src/lib/storage/limits.ts` (pure, already browser-imported) and re-export it from `exif.ts`.
- Call it in `uploadOne` in `src/components/PhotoCapture.tsx`; add original and sent sizes to the existing `uploadStep('upload-start', …)` breadcrumb.

**2. Retry and dismiss for failed uploads**
- Keep the `File` on the `UploadStatus` error entry; render "Try again" (re-runs `uploadOne` with the same key) and "Dismiss".

**3. Thumbnails and a compact grid**
- `GET /api/projects/[id]/photos/[photoId]?w=320` in `src/app/api/projects/[id]/photos/[photoId]/route.ts`: resize with `sharp` for an allow-listed width (320 only); same immutable cache header.
- `PhotoCapture` renders a grid of square thumbnails (3 columns on a phone). Tapping one opens that photo's detail below the grid: larger image, label field, the existing `ReferenceMarker` toggle, and Remove.
- Check `public/sw.js` and `src/lib/client/offline-cache.ts`: the `PHOTO` pattern already matches by pathname; add the thumbnail URL to what "keep offline" pre-caches.

**4. Guidance and count**
- Above the buttons: "Take 3–6 photos. Stand in each corner and shoot the opposite walls; keep the floor line and whole doors and windows in frame." plus "N of 8".

**5. Per-photo labels (my call: free text, not compass)**
- `wallHint` is compass-based, which means nothing before a room exists. Add `label: z.string().max(60).optional()` to `PhotoSchema` in `src/lib/plan/schemas.ts`; leave `wallHint` alone.
- `PATCH /api/projects/[id]/photos/[photoId]` with `{ label }`; move the `setPhoto` helper from the reference route into `src/lib/storage/service.ts` and reuse it in both routes.
- `src/lib/llm/extract.ts` passes the label; `buildExtractRoomPrompt` in `src/lib/llm/prompts.ts` adds `the user says it shows "…"`; bump `PROMPT_VERSION` to 1.4.0.
- Confirm the Postgres backend stores photos inside the project document (`src/lib/storage/pg-projects.ts`), so no migration is needed.

**6. Room step first on phones for a fresh project**
- In `src/components/ProjectEditor.tsx`, when the project is fresh (same test as `defaultStep`), give the step column `order-1 lg:order-2` and the canvas section `order-2 lg:order-1`.

## PR 2 — Trusting the result

**1. Photos in the review step**
- `src/components/DiffPreview.tsx`: when `proposal.source === 'llm'` and it changes the room, show a strip of the project's thumbnails (`current.photos`, `?w=320`) under the two plans; tap to enlarge.

**2. Confirm the size by tapping a wall**
- `src/components/PlanThumbnail.tsx`: optional `selectedWallId` and `onPickWall` props (wide transparent hit lines per wall, highlighted when selected, wall numbers already drawn).
- `src/components/ConfirmScale.tsx`: show the thumbnail as the picker, synced with the existing select (kept for doors/windows and keyboard users).

**3. Measuring before extraction is the visible default**
- `src/components/ExtractPanel.tsx`: replace the collapsed `<details>` with one always-visible optional row ("Measured a wall? Sizes will be exact"); suggest photo labels from PR 1 for "Which wall" via a `<datalist>`.

## PR 3 — Editor tidy-up

- **Room step as a choice**: a "From photos / Sketch it" toggle in `ProjectEditor.tsx` (remembered per tab like the step). "Confirm the size" is prominent only while `room.sizeEstimated`; otherwise it sits in a closed "Rescale from a measurement" disclosure.
- **Wording**: remove "Revision N" from both headers (history stays in `HistoryControls`).
- **Export errors**: replace `window.alert` in `ExportLink` with an inline `role="alert"` message.
- **Keep the extraction form across reloads**: persist rows and hint in `sessionStorage` under `kd-extract-draft:<projectId>` (read with `useBrowserValue` from `src/lib/client/browser-value.ts`); clear on a successful proposal.

## Out of scope

- Reworking the reference-object marker (zoom, drag handles). It moves into the photo detail view in PR 1 but is otherwise unchanged.
- Changing the model, provider or extraction wait time.

## Verification (each PR)

- `npm run lint && npm run typecheck && npm test`; `npm run e2e` for the happy path.
- New/updated unit tests: `shrink-photo` (shrinks, falls back), `PhotoCapture` (retry, dismiss, grid, label save), photo route (`?w=320`, rejected widths, `PATCH`), `prompts` (label line), `DiffPreview` (photo strip), `ConfirmScale` (wall tap selects), `ExtractPanel` (draft restored), `ProjectEditor` (ordering, room choice).
- On the Android emulator (adb + CDP, per the saved notes): take a camera photo, confirm the upload breadcrumb shows a reduced size, force a failure (airplane mode) and retry, label a photo, run an extraction, check the photos appear in review, confirm a size by tapping a wall.
- After merge, watch Sentry for `upload-failed` and picker-lost reports.
