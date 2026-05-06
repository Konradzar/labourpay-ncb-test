# Handoff — paused 2026-05-07 (after Task 3, mid-Task 4)

## Where we are

- Repo: `C:\Users\konra\Documents\GitHub\labourpay-ncb-test\`
- Branch: `master` (no remote yet — GitHub repo creation is Task 12)
- Commits so far:
  ```
  6ac34ba feat: NCB labourpay_ncb_test database created + schema docs   ← Tasks 2+3
  8f87ce6 docs: design + plan + env example                              ← Task 1 (docs)
  49694a6 Initial commit from Create Next App                            ← Task 1 (scaffold)
  ```
- Working tree: `cors.json` is untracked (written but not committed yet).
- NCB: database `35120_labourpay_ncb_test` exists, `workers` table created, RLS = `public_readwrite`.
- AWS S3: bucket `foxfitt-nocodebackend-001` exists. **CORS NOT YET APPLIED** — that's the next step.
- `.env.local`: not created yet. Will be created in Task 5.

## What's next (in order)

### Task 4 (resume) — Apply S3 CORS

`cors.json` is in the repo root, ready to apply. Two options to apply it:

1. **AWS Console (no install, ~2 min)** — open https://s3.console.aws.amazon.com/s3/buckets/foxfitt-nocodebackend-001 → Permissions → CORS → paste contents of `cors.json` → Save.
2. **AWS CLI** — install via `winget install -e --id Amazon.AWSCLI`, then `aws configure` (paste IAM keys from NordPass, region `af-south-1`), then `aws s3api put-bucket-cors --bucket foxfitt-nocodebackend-001 --cors-configuration file://cors.json`.

After CORS is applied, commit `cors.json`:
```powershell
git add cors.json
git commit -m "feat: S3 CORS config for localhost dev"
```

### Task 5 — Env vars + lib/ncb-utils.ts

1. `copy .env.local.example .env.local` (in repo root).
2. Open `.env.local`, paste real values from NordPass:
   - `NCB_SECRET_KEY=` (entry: `NCB labourpay_ncb_test secret key`)
   - `AWS_ACCESS_KEY_ID=` (entry: `AWS nocodebackend-s3_01 access key` — or wherever you stored it)
   - `AWS_SECRET_ACCESS_KEY=` (same entry)
3. Verify `git status` does NOT show `.env.local` — it should be gitignored.
4. Use `mcp__nocodebackend__get_integration_prompts(database="35120_labourpay_ncb_test")` to fetch the canonical `lib/ncb-utils.ts` source. Save it to `lib/ncb-utils.ts` in the repo.
5. Commit.

### Tasks 6–10 — pure-code subagent tasks

See `docs/plans/2026-05-07-worker-profile-slice-plan.md` for the original plan, but **read `docs/NCB_NOTES.md` first** for plan amendments (route paths use verb prefixes, public-data not data, etc.).

### Tasks 11–12 — docs + GitHub push

Standard.

## Critical reminders

🚨 **NCB Secret Key**: should be in NordPass by the time you read this. If not, retrieve from the NCB dashboard's Secret Key reveal for the `35120_labourpay_ncb_test` database. Was relayed once during Task 2 — see commit message of `6ac34ba` for the safety summary.

🚨 **RLS policy on `workers` is `public_readwrite`** — localhost dev only. Switch to `private`/`shared_readwrite` before any deploy.

🚨 **Don't commit `.env.local`** — `.gitignore` is already set correctly, but `git status` should always be eyeballed before any commit.

## How to resume

If continuing in the same Claude session: just keep going.

If a fresh Claude session: point it at this folder and tell it:
> "Continue executing the V0 plan at docs/plans/2026-05-07-worker-profile-slice-plan.md. Read docs/HANDOFF.md first for current state. Read docs/NCB_NOTES.md for plan amendments. We're partway through Task 4."

## Useful files

- [`docs/plans/2026-05-07-worker-profile-slice-design.md`](plans/2026-05-07-worker-profile-slice-design.md) — design (signed off, don't change)
- [`docs/plans/2026-05-07-worker-profile-slice-plan.md`](plans/2026-05-07-worker-profile-slice-plan.md) — original plan (read alongside NCB_NOTES.md)
- [`docs/NCB_NOTES.md`](NCB_NOTES.md) — plan amendments based on what NCB actually returned
- [`docs/SCHEMA.md`](SCHEMA.md) — current state of the NCB schema
- [`cors.json`](../cors.json) — S3 CORS config to apply
- [`.env.local.example`](../.env.local.example) — env var template (committed; real values in `.env.local`, gitignored)
