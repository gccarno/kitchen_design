# Kitchen Design App

Design a kitchen with the help of an LLM. Upload room photos with a reference object for scale, get a draft 2D floor plan, refine it through a chat-driven LLM, and place cabinets, appliances, and furniture from a catalog. Exports to JSON and SVG/PNG.

See [`docs/plan.md`](docs/plan.md) for the full implementation plan (26 tasks across 5 phases).

## Status

**Phase 1 — Foundations:** in progress. Starting with Task 1 (repo bootstrap).

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript + Tailwind
- tRPC for typed RPC
- Zustand for client state
- react-konva for the 2D editor
- OpenAI-compatible LLM provider (works with OpenAI, OpenRouter, Together, Groq, local llama.cpp server)
- Vitest + Playwright for tests
- Zod for runtime validation

## Development

```bash
npm install
npm run dev
npm test
```

## Configuration

Copy `.env.example` to `.env.local` and set:

- `LLM_BASE_URL` — defaults to `https://api.openai.com/v1`
- `LLM_API_KEY` — your API key
- `LLM_MODEL` — text model (default `gpt-4o-mini`)
- `LLM_VISION_MODEL` — vision model (default `gpt-4o-mini`)
