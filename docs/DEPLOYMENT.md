# Deployment (Terraform → keys → Render)

Everything below that creates cloud resources is run by you; nothing is automated.

## 1. Cloud resources
Follow `infra/terraform/README.md`: `terraform init/plan/apply`, then create the two
service-account keys with gcloud. Copy the Neon **direct** (non-pooled) connection string
from the Neon console.

## 2. Smoke test against real Neon + GCS (before Render)
Use a Neon dev branch and a GCS dev prefix so nothing real is touched:
```
GCS_BUCKET=kitchen-design-files GCS_PREFIX=dev/ DATABASE_URL=<neon dev branch> npm run import:local -- --dry-run
```

## 3. Create the first user (before the URL goes live)
In production registration is closed (`ALLOW_REGISTRATION=0`). From your machine, with
`DATABASE_URL` pointing at the prod Neon database:
```
MIGRATE_ALLOW_REMOTE=1 NEW_USER_PASSWORD=<password> npm run create-user -- <email>
```
The script refuses a non-local database without `MIGRATE_ALLOW_REMOTE=1`. Optionally bring existing local
projects over with `npm run import:local -- --owner <email>` (needs `GCS_BUCKET` and `DATABASE_URL`).

## 4. Render
1. New → Blueprint → this repo; it reads `render.yaml`. Choose region Virginia in the dashboard.
2. Set the `sync:false` variables: `DATABASE_URL`, `LLM_API_KEY` (OpenRouter key from the garden
   app `.env`), `LLM_MODEL`, `LLM_VISION_MODEL`.
3. Environment → Secret Files → add `gcs.json` with the contents of `server-key.json`
   (mounted at `/etc/secrets/gcs.json`). Delete the local key copy afterwards.
4. The app applies DB migrations itself at startup. `/api/health` must return 200.
5. After the first deploy, re-open Environment and confirm every `sync:false` variable has a value.

## 5. Post-deploy checks
- `curl https://<service>.onrender.com/api/health` → `{"ok":true}`.
- Log in over HTTPS with the user from step 3; confirm the session cookie is `Secure`.
- Login throttling uses `X-Forwarded-For`: send a few bad logins and confirm the throttle keys on
  your IP, not a proxy IP. If Render adds more than one trusted hop, adjust `TRUSTED_PROXY_HOPS`.
- Run one refine/extract on a free model and confirm it does not report "not configured".
- Free tier sleeps: expect a 30–60 s cold start.

## Notes
- If `next build` runs out of memory on the free tier, build a Docker image in CI (Next
  `output: "standalone"`; copy `drizzle/` into the image since migrations read it at startup).
- Without a worker, jobs run inside the web process (Phase 5 adds the worker).
