# Kitchen Design App

Design a kitchen with the help of an LLM. Upload room photos and a measured wall length or two for scale (or sketch the room by hand), get a draft 2D floor plan, refine it through a chat-driven LLM, and place cabinets, appliances, and furniture from a catalog. Exports to JSON and SVG/PNG.

See [`docs/plan.md`](docs/plan.md) for the full implementation plan (5 phases) and [`docs/testing-guide.md`](docs/testing-guide.md) for how to test the app.

## Status

**Phase 1 — Foundations:** complete (Tasks 1–8).
**Phase 2 — Photo capture & extraction:** in progress. Tasks 9–13 done — milestone 1: photos + measurements (or a hand sketch) → reviewed, saved room. Phase 3 in progress: Tasks 14–16 (canvas, outline editing, doors and windows) done; Tasks 17–18 (catalog: 24 appliances/fixtures/furniture + 40 generated cabinets) done; Task 19 done — milestone 2: a manual kitchen editor (outline, doors/windows, catalog items with wall snapping and clearance warnings). Phase 4 in progress: Task 20 done — ask for changes in plain words ("move the fridge to the north wall"); every edit is reviewed before it's applied.

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
