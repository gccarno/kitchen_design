# Kitchen Design App

Design a kitchen with the help of an LLM. Upload room photos and a measured wall length or two for scale (or sketch the room by hand), get a draft 2D floor plan, refine it through a chat-driven LLM, and place cabinets, appliances, and furniture from a catalog. Exports to JSON and SVG/PNG.

See [`docs/plan.md`](docs/plan.md) for the full implementation plan (5 phases).

## Status

**Phase 1 — Foundations:** complete (Tasks 1–8).
**Phase 2 — Photo capture & extraction:** in progress. Tasks 9–13 done — milestone 1: photos + measurements (or a hand sketch) → reviewed, saved room. Phase 3 in progress: Tasks 14–15 (canvas, outline editing) done; Task 16 (doors and windows) is next.

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
