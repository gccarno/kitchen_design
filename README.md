# Kitchen Design App

Design a kitchen with the help of an LLM. Upload room photos and a measured wall length or two for scale (or sketch the room by hand), get a draft 2D floor plan, refine it through a chat-driven LLM, and place cabinets, appliances, and furniture from a catalog. Exports to JSON, SVG/PNG (plan and wall elevations), and a CSV parts list.

A **layout check** scores the kitchen against the NKBA planning guidelines — work triangle, counter beside the sink, range and fridge, dishwasher next to the sink, aisle width — and the chat can fix what fails ("fix the layout check").

An **estimate** prices the parts list — cabinets, appliances, countertop, closet parts and brackets, plus installation and tax — from rough default prices you can change per project, and exports it as CSV.

The **elevations** draw each kitchen wall as a front view, the way a cabinet maker would: cabinets with doors, appliances, the countertop, windows and doors at their real heights, and dimensions. They're shown in the editor and exported as SVG and PNG.

It also designs **reach-in closets**: pick "Closet" for a new project and lay out rods, shelves, shelf towers, drawer units, shoe shelves, baskets, hooks and valet rods on a front view of the closet, set its size and doors (bifold, sliding, hinged or open), and get warnings about clothes hitting things, drawers the doors block, and shelves out of reach. The chat works for closets too ("double hang on the left, drawers in the middle").

See [`docs/plan.md`](docs/plan.md) for the full implementation plan (6 phases), [`docs/superpowers/specs/2026-10-04-closet-design.md`](docs/superpowers/specs/2026-10-04-closet-design.md) for the closet design, and [`docs/testing-guide.md`](docs/testing-guide.md) for how to test the app.

## Status

**Phase 1 — Foundations:** complete (Tasks 1–8).
**Phase 2 — Photo capture & extraction:** in progress. Tasks 9–13 done — milestone 1: photos + measurements (or a hand sketch) → reviewed, saved room. Phase 3 in progress: Tasks 14–16 (canvas, outline editing, doors and windows) done; Tasks 17–18 (catalog: 24 appliances/fixtures/furniture + 40 generated cabinets) done; Task 19 done — milestone 2: a manual kitchen editor (outline, doors/windows, catalog items with wall snapping and clearance warnings). Phase 4 in progress: Task 20 done — ask for changes in plain words ("move the fridge to the north wall"); every edit is reviewed before it's applied.
**Phase 6 — Closets:** done (Tasks 27–34) — reach-in closet projects with a front-elevation editor, closet warnings, chat, export, and list thumbnails.
**Phase 8 — Layout check:** done (Tasks 40–45) — NKBA guideline checklist for kitchens, also fed to the chat.
**Phase 9 — Estimate:** done (Tasks 46–51) — priced parts list for kitchens and closets, editable prices with undo, CSV export.
**Phase 10 — Elevations:** done (Tasks 52–57) — kitchen wall elevations in the editor, exported as SVG and PNG.

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
