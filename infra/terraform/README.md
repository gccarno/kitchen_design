# Terraform — Home Design cloud resources

Creates: GCS bucket `kitchen-design-files` (7-day expiry on `exports/`), service accounts
`kitchen-design-server` (Render) and `kitchen-design-worker` (OCI), bucket-scoped IAM, and the
Neon project `KitchenDesign` (PG 18, aws-us-east-1). Render is deliberately not here (see `render.yaml`, Phase 4).

## One-time setup (you run these; nothing here is applied automatically)
1. `gcloud auth application-default login` (the account must own project `innate-conquest-491313-k3`).
2. Create a Neon API key in the console, then `export NEON_API_KEY=...` (never commit it).
3. `cd infra/terraform`, then `terraform init`, then `terraform plan`.
4. Read the plan line by line. Expected: 1 bucket, 2 service accounts, 2 IAM members, 1 Neon project. Anything "destroy/replace" is a stop.
5. `terraform apply` once the plan matches.

## After apply (also yours to run; keys must stay out of state and git)
```
gcloud iam service-accounts keys create server-key.json --iam-account kitchen-design-server@innate-conquest-491313-k3.iam.gserviceaccount.com
gcloud iam service-accounts keys create worker-key.json --iam-account kitchen-design-worker@innate-conquest-491313-k3.iam.gserviceaccount.com
```
Render gets `server-key.json` as a Secret File (Phase 4); the OCI VM gets `worker-key.json` (Phase 5). Delete local copies afterwards.
Copy the Neon connection string from the Neon console (do not run `terraform output` on it).

## If Neon refuses a second free project
Remove `neon.tf` and add a `neon_database` in the existing GardenApp project instead (needs that project's id from the garden state).

## Gotchas (from the garden app)
- Never `terraform output` a sensitive value.
- Write out every default Google adds to a resource (the `encryption` block) or the plan shows drift.
- Smoke test after apply: `GCS_BUCKET=kitchen-design-files GCS_PREFIX=dev/ DATABASE_URL=<neon dev branch> npm run import:local -- --dry-run`.
