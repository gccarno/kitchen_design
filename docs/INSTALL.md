# Install guide

How to get the Kitchen Design App running on your own machine. For hosting it for other people, see [`DEPLOYMENT.md`](DEPLOYMENT.md). For the phone app, see [`../android/BUILD.md`](../android/BUILD.md).

## 1. Prerequisites

| Need | Version | Notes |
|---|---|---|
| Node.js | 22 or newer | The worker image uses 22; development has been done on 24. |
| npm | the one that ships with Node | `npm ci` or `npm install` both work. |
| Git | any recent | |

Nothing else is needed to run the app. There is no database to install: by default projects are stored as JSON files in `./data`.

## 2. Get the code and install

```bash
git clone https://github.com/gccarno/kitchen_design.git
cd kitchen_design
npm install
```

## 3. Configure

```bash
cp .env.example .env.local     # Windows PowerShell: Copy-Item .env.example .env.local
```

You can start the app without changing anything. The one thing that needs a key is the LLM (see below).

### Running without an LLM key

With `LLM_API_KEY` empty, everything works except the two features that call a model:

- **Room from photos** (extraction), and
- **Chat** (refinement).

You can still create a project (blank, from a template, or the sample), sketch the room, place cabinets and appliances, see the layout check, elevations and estimate, duplicate options, and export JSON, SVG, PNG, CSV and PDF. Asking for photo extraction or chat without a key answers "not configured" rather than failing.

### Adding an LLM

Any OpenAI-compatible endpoint works. Set these in `.env.local`:

```
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=google/gemma-4-31b-it:free
LLM_VISION_MODEL=google/gemma-4-31b-it:free
```

- `LLM_MODEL` and `LLM_VISION_MODEL` can be comma-separated lists on OpenRouter. The first is used and the rest are fallbacks.
- Free models are often busy and can take minutes for a whole-kitchen layout. Raise `LLM_TIMEOUT_MS` (for example `300000`) if requests time out.
- For OpenAI, leave `LLM_BASE_URL` at its default and set a model such as `gpt-4o-mini`.
- Paid models cost money per request. Check your provider's pricing first.

`.env.example` documents every other setting. The optional ones (Postgres, accounts, Google Cloud Storage, background worker) are explained in the README under "Storage backends", "Accounts" and "Jobs".

## 4. Run it

```bash
npm run dev
```

Open <http://localhost:3000>. Create a project on the home page. Picking **Start from** lets you begin from a template; **Try a sample kitchen** gives you a finished design to look at.

To use it from a phone on the same network: `npm run dev -- -H 0.0.0.0`, then open `http://<your-computer-ip>:3000`. Camera upload works over plain HTTP on a LAN. Installing it as a PWA needs HTTPS (or localhost), for example through a tunnel such as `npx localtunnel --port 3000`.

### Production build

```bash
npm run build
npm start
```

## 5. Check that it works

| Command | What it checks |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Unit and integration tests (Vitest). No database, key or network needed. |
| `npm run e2e` | Browser tests (Playwright). Uses its own port (3310), a temporary data directory and a mocked LLM, so it never touches `./data` or a dev server you have open. |

Playwright needs a browser the first time:

```bash
npx playwright install chromium
```

[`testing-guide.md`](testing-guide.md) has a manual walkthrough of the whole app.

## 6. Where your data lives

- Projects: `./data/projects/<id>/project.json`, with photos next to them in `photos/`.
- Delete `./data` for a clean slate. Back it up by copying the folder.
- Change the folder with `DATA_DIR` in `.env.local`.

## Troubleshooting

**`npm test` crashes workers or runs out of memory.** Limit the worker count:
`npx vitest run --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=3`

**Port 3000 is already in use.** Run `npm run dev -- -p 3001`.

**Photo extraction or chat says "not configured".** `LLM_API_KEY` is empty or not in `.env.local`. Restart `npm run dev` after editing it.

**Chat or extraction times out.** The model is slow or rate-limited. Add fallback models to the comma-separated lists, or raise `LLM_TIMEOUT_MS`.

**"Request was lost (the server restarted)".** In disk mode, background jobs live in memory, so restarting the server loses any in-flight request. Send it again.

**Playwright says the browser is missing.** Run `npx playwright install chromium`.

**Git prints "LF will be replaced by CRLF" on Windows.** This is a harmless line-ending notice. Test runs can also rewrite snapshot files with only line-ending changes; discard those with `git checkout -- <file>`.
