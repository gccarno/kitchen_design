# Offline viewing (PWA layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Projects already opened (or marked "Keep offline") can be viewed with no network, on the web and in the Android WebView; all editing stays online-only.

**Architecture:** One hand-written service worker (`public/sw.js`, no build plugin) caches GET responses; a small client module tracks online state; edit controls disable themselves when offline. A 409 on a write reloads the latest project.

**Spec:** `docs/superpowers/specs/2026-10-14-mobile-cloud-design.md` (Phase 6).

## Global Constraints
- Offline = view only. Never queue or replay writes.
- Caches hold per-user data: sign-out AND login must clear them (a second user on the same browser must never see the first user's projects).
- Never cache `/api/auth/*`, `/api/health`, `/api/jobs/*`, any non-GET request, or any response with status other than 200.
- The service worker is registered only when `process.env.NODE_ENV === 'production'` (dev and Playwright must not be affected); the e2e suite must stay 37/37 with `LLM_API_KEY=''`.
- `/sw.js` and `/offline` must be reachable without a session (add to the middleware public list and matcher, and its tests). `/offline` is a static page with no project data.
- Match existing code style; every new module gets a vitest file. Do not touch the two snapshot files (`git checkout` them if `npm test` rewrites them).

## Review Focus
- Sign-out then login as another user: no cached project from user A is served to user B.
- A cached page served while offline must not show a stale "online" editing UI.
- Photo responses are immutable by id and large: cache-first, bounded count (evict oldest beyond 300 entries).
- `/api/projects/[id]` and pages are network-first: when online, always the freshest copy; offline falls back.
- Offline navigation to an uncached page shows `/offline`, not the browser error page.

---

### Task 82: Service worker, offline page, registration, cache clearing

**Files:**
- Create: `public/sw.js`, `src/app/offline/page.tsx`, `src/components/ServiceWorkerRegistrar.tsx`, `src/lib/client/offline-cache.ts`
- Modify: `src/app/layout.tsx` (render the registrar), `src/middleware.ts` (+ its test: public `/sw.js`, `/offline`), `src/components/SignOutButton.tsx`, `src/components/LoginForm.tsx` (call `clearOfflineCaches()` before/after the auth request succeeds)
- Test: `src/lib/client/offline-cache.test.ts`, `src/middleware.test.ts` (extend), `src/components/ServiceWorkerRegistrar.test.tsx`

**Interfaces — Produces:**
- `clearOfflineCaches(): Promise<void>` — deletes every cache whose name starts with `hd-` (via `caches.delete`) and asks the active worker to do the same via `postMessage({type:'clear'})`; never throws (no `caches` API = no-op).
- `cacheUrls(urls: string[]): Promise<{cached: number; failed: number}>` — fetches each URL with `credentials:'same-origin'` and puts 200 responses in the cache `hd-pages-v1` (for `/api/projects/*/photos/*` URLs use `hd-photos-v1`); used by Task 84.
- Cache names: `hd-static-v1` (cache-first: `/_next/static/`, `/icons/`, `/manifest.json`), `hd-pages-v1` (network-first: navigations and `GET /api/projects` + `/api/projects/<id>`), `hd-photos-v1` (cache-first, max 300 entries). Offline fallback page cached at install under `hd-static-v1`.

- [ ] **Step 1:** Write failing tests for `clearOfflineCaches` (deletes only `hd-` caches, no-op without `caches`), the middleware public paths, and the registrar (registers `/sw.js` only in production, never throws when `serviceWorker` is missing).
- [ ] **Step 2:** Implement `public/sw.js`: `install` precaches `/offline` and `skipWaiting`; `activate` deletes `hd-*` caches not in the current set and `clients.claim()`; `fetch` handler only for same-origin GET; routing per the cache table above (navigations: network-first, fall back to the cached page, then `/offline`; photos: cache-first then network, trim to 300; never cache excluded paths or non-200); `message {type:'clear'}` deletes all `hd-` caches.
- [ ] **Step 3:** Implement `/offline` page (plain "You're offline — open a project you've viewed before" with a link home), registrar, layout wiring, middleware changes, sign-out/login clearing.
- [ ] **Step 4:** `npm test`, `npm run typecheck`, `npm run lint`, then `npm run build` and confirm `/sw.js` is served from `public/`. Commit.

### Task 83: Online state and read-only editing

**Files:**
- Create: `src/lib/client/online.ts`, `src/components/OfflineBanner.tsx`
- Modify: `src/app/layout.tsx` (banner), `src/components/ProjectEditor.tsx`, `src/components/ChatPanel.tsx`, `src/components/ExtractPanel.tsx`, `src/components/HistoryControls.tsx`, `src/components/ProjectList.tsx` (delete/duplicate/new), `src/components/PhotoCapture.tsx` — disable write controls when offline
- Test: `src/lib/client/online.test.ts`, `src/components/OfflineBanner.test.tsx`, plus one offline case in each modified component's existing test file

**Interfaces — Produces:**
- `useOnline(): boolean` — `useSyncExternalStore` over `window` `online`/`offline` events and `navigator.onLine` (server snapshot `true`).
- `markOffline()` — exported setter that a failed `fetch` (TypeError) can call so a flaky connection that still reports `onLine` flips to offline; reset to online by the next `online` event or successful fetch via `markOnline()`.

- [ ] **Step 1:** Failing tests for `useOnline` (initial value, event flips, SSR snapshot).
- [ ] **Step 2:** Implement hook and `OfflineBanner` ("You're offline — viewing saved data. Editing is disabled.", `role="status"`, shown only when offline).
- [ ] **Step 3:** In each listed component, derive `const online = useOnline()` and disable (with `disabled` + `title="Offline"`) every control that writes or calls the network: drag/placement/edit actions in the editor, chat send, extract, undo/redo, new/delete/duplicate, photo upload. Keep pan/zoom/selection and read-only exports (CSV/SVG links) enabled where they work from loaded data; link-based exports that hit the server are disabled offline.
- [ ] **Step 4:** Full test/typecheck/lint/build run; e2e still 37/37. Commit.

### Task 84: "Keep offline" and 409 handling

**Files:**
- Create: `src/components/KeepOfflineButton.tsx`
- Modify: `src/components/ProjectList.tsx` (button per project), `src/lib/client/revisions.ts` and `ProjectEditor.tsx` (409 → reload latest and show "This project changed elsewhere — loaded the latest version; re-apply your change")
- Test: `src/components/KeepOfflineButton.test.tsx`, `src/lib/client/revisions.test.ts` (extend)

- [ ] **Step 1:** Failing tests: the button calls `cacheUrls` with the project page `/project/<id>`, `/api/projects/<id>`, and one URL per photo (read the photo ids from `GET /api/projects/<id>`), shows "Saved offline (n photos)" or "Some items failed", and is disabled offline; a 409 from revisions triggers a reload and the message.
- [ ] **Step 2:** Implement. Photo URL shape: see `src/app/api/projects/[id]/photos/[photoId]/route.ts`.
- [ ] **Step 3:** Full verification as in Task 83. Commit.
