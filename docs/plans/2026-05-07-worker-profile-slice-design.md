# Design — V0 Worker Profile Slice (NCB + S3 test project)

**Date**: 2026-05-07
**Author**: Konrad (collaborated with Claude)
**Status**: Approved — ready for implementation plan

---

## Purpose & non-goals

A standalone learning project to evaluate **NoCodeBackend (NCB)** as a database-as-a-service and **AWS S3** as file storage, by rebuilding a tiny vertical slice of the existing FoxFitt LabourPay payroll app.

**Explicitly NOT a goal**:
- Replace the existing Flatlogic LabourPay app.
- Touch the `LabourPay_v5` GitHub repo, branches, or working tree.
- Share code with the existing Django app.
- Ship a production payroll system.

This is a parallel test project. It might one day grow into a replacement; for now it's a learning instrument.

**The slice (V0)**: create + view a worker profile (name, monthly salary, photo, ID document). Three pages — Add Worker, Workers list, Worker detail. Nothing else.

---

## Decisions log

| # | Decision | Reasoning |
|---|---|---|
| 1 | Scope: tiny end-to-end slice (not full clone) | Validates the stack in days, not months. Surfaces real integration friction without massive write-off if it doesn't work. |
| 2 | Slice = Worker profile (1 table, 2 file fields) | Smallest surface that exercises NCB CRUD + S3 file storage + a UI. No FK relationships to distract us. |
| 3 | Architecture = browser + tiny backend (Next.js API routes) | Browsers cannot keep secrets. NCB Secret Key + AWS keys must stay server-side. |
| 4 | Auth in V0 = none; real per-user login in V0.2+ | Auth is its own learning milestone. Decoupling keeps V0 focused on data + files. |
| 5 | NCB native auth ENABLED at DB creation | One-way door per NCB docs — must be enabled at creation if we ever want it. We enable but don't use. |
| 6 | Frontend stack = Next.js (TypeScript / React, App Router) | Matches NCB's integration guide exactly; ready-made code via `get_integration_prompts` MCP tool. |

---

## Architecture overview

```
                ┌──────────────────────────────────────┐
                │  Your laptop (during learning)       │
                │                                      │
   browser  ←──→│   Next.js dev server (localhost:3000)│
   (Chrome)     │   ├── pages (React UI)               │
                │   └── API routes  ← the "data proxy" │
                │       │                              │
                └───────┼──────────────────────────────┘
                        │  HTTPS, server-side only
            ┌───────────┴───────────┐
            ▼                       ▼
   ┌────────────────┐      ┌────────────────────┐
   │ NCB data API   │      │ AWS S3              │
   │ Bearer:        │      │ foxfitt-…-001       │
   │ NCB_SECRET_KEY │      │ region af-south-1   │
   └────────────────┘      └────────────────────┘
```

**Key invariants**:
- The browser NEVER receives the NCB Secret Key or any AWS access key.
- The browser DOES talk to S3 directly — but only via short-lived presigned URLs generated server-side.
- The bucket stays fully private (Block Public Access ON, all four settings).

---

## Repo

- **Brand new GitHub repo**, NOT a fork: `labourpay-ncb-test`
- **Local path**: `C:\Users\konra\Documents\GitHub\labourpay-ncb-test\`
- **Bootstrap**: `npx create-next-app@latest` (TypeScript, App Router, ESLint enabled, Tailwind TBD during implementation)
- `.env.local` and `.env.local.example` set up at scaffold time. `.env.local` gitignored from minute 1.

---

## Data model — one NCB table: `workers`

| Column | Type | Notes |
|---|---|---|
| `id` | auto | NCB-generated primary key |
| `name` | string | Worker's full name |
| `monthly_salary` | decimal/number | Money — precision matters |
| `photo_key` | string | S3 object key, e.g. `workers/<uuid>.jpg` (NOT a URL) |
| `id_doc_key` | string | S3 object key, e.g. `workers/<uuid>.pdf` |
| `created_at` | datetime auto | NCB-generated |
| `user_id` | auto | NCB-injected because native auth is enabled (unused in V0) |

**Why store object keys instead of full URLs**: keys are stable forever; URLs change with bucket / region / CDN / signing scheme. Mirrors the Flatlogic pattern of storing `worker.photo = ImageField()` as a relative path.

**RLS policy on `workers`**: `public_readwrite` for V0 (localhost dev only). 🚨 **Must change to `private` or `shared_readwrite` before any deploy.** Triple-flagged in README, code comment, and deploy checklist.

---

## File flow — S3 presigned URLs

### Upload (browser → S3 directly)

1. User picks a file in `<input type="file">`.
2. Browser POSTs `/api/upload-url` with `{ kind: "photo" | "id_doc", ext: "jpg" | "png" | "pdf" }`.
3. Next.js server: validates `kind`/`ext`, generates `key = workers/<uuid>.<ext>`, calls AWS SDK to create a **presigned PUT URL** (5-min expiry, scoped to that exact key + content-type).
4. Server returns `{ url, key }` to browser.
5. Browser PUTs file bytes to the presigned URL — direct to S3, no AWS keys involved client-side.
6. Browser stores the returned `key` in form's hidden state.
7. Form submit POSTs `{ name, monthly_salary, photo_key, id_doc_key }` to `/api/data/workers`.
8. Next.js writes the row to NCB via the data proxy.

### Download (browser → S3 directly)

1. User opens `/workers/<id>`.
2. Server fetches the row from NCB.
3. Server generates presigned GET URLs for `photo_key` and `id_doc_key` (5-min expiry).
4. Page renders `<img src={signedPhotoUrl}>` and `<a href={signedDocUrl}>View document</a>`.
5. Browser fetches files directly from S3 using the presigned URLs.

### Constraints

- **File types**: JPEG, PNG, PDF — accepted for both photo and ID doc fields.
- **Max size**: 5 MB (matches Flatlogic).
- **Expiry**: 5 minutes for both upload and download URLs.
- **Upload-on-pick**: triggered when the file is selected, not on form submit (avoids URL expiring while user fills the rest of the form).
- **Orphans**: accepted for V0. If user picks a file then cancels the form, the file lives in S3 forever. Cost is negligible at our scale.
- **MIME validation**: enforced server-side in `/api/upload-url` before any URL is signed.

---

## CORS on the S3 bucket

`cors.json` lives at the repo root:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Apply with:

```sh
aws s3api put-bucket-cors \
  --bucket foxfitt-nocodebackend-001 \
  --cors-configuration file://cors.json
```

🚨 Add the Greta domain to `AllowedOrigins` before any non-localhost deploy.

---

## Secrets

**Canonical store**: NordPass.
**Runtime location**: `.env.local` on the laptop only. Gitignored. Never copied elsewhere.

```env
# === NCB ===
NCB_INSTANCE=labourpay_ncb_test
NCB_SECRET_KEY=<paste from NordPass>
NCB_AUTH_API_URL=https://app.nocodebackend.com/api/user-auth
NCB_DATA_API_URL=https://app.nocodebackend.com/api/data
NCB_APP_URL=https://app.nocodebackend.com

# === AWS S3 ===
AWS_REGION=af-south-1
AWS_ACCESS_KEY_ID=<paste from NordPass>
AWS_SECRET_ACCESS_KEY=<paste from NordPass>
S3_BUCKET_NAME=foxfitt-nocodebackend-001
```

A sibling `.env.local.example` (placeholder values only) is committed to git as documentation.

**Forbidden**:
- ❌ `NEXT_PUBLIC_*` prefix on any of these (would expose to browser bundle).
- ❌ Hardcoded values in source code.
- ❌ Pasting into git, Slack, screenshots, or any cloud service except NordPass.

---

## Local dev — first-run workflow

```
1. winget install -e --id OpenJS.NodeJS.LTS
   winget install -e --id Amazon.AWSCLI
   winget install -e --id Git.Git    # if not already installed
2. git clone <repo>
3. cd labourpay-ncb-test
4. npm install
5. cp .env.local.example .env.local
   # then paste real secrets from NordPass
6. aws s3api put-bucket-cors --bucket foxfitt-nocodebackend-001 --cors-configuration file://cors.json
7. npm run dev
8. open http://localhost:3000
```

After day 1, daily workflow is just `npm run dev`.

---

## Acceptance criteria (V0 = done when all pass)

1. **Add Worker page** accepts name, salary, photo (JPEG/PNG/PDF), ID doc (JPEG/PNG/PDF). On Save, 1 NCB row + 2 S3 objects exist.
2. **Workers list page** renders every worker as a row with name + salary.
3. **Worker detail page** shows fields, renders photo as `<img>`, provides "View ID document" link.
4. `MANUAL_TEST.md` end-to-end click-through passes (create worker → verify in S3 console → verify in NCB Records).

---

## Error handling — V0 policy

Errors are **loud and uncomplicated**. Goal: see failures, not paper over them.

| Failure | Behaviour |
|---|---|
| NCB API 4xx/5xx | Red toast with status + body; full error to console |
| S3 upload error (CORS, expired URL, network) | Red toast with browser error; full XHR to console |
| Presigned URL expired | 403 from S3 → toast "Upload link expired, refresh and try again" |
| Form validation (missing field, salary not a number) | Inline form errors; submit blocked |
| Image fails to render | Browser default broken-image icon |

Specifically NOT in V0: retry logic, optimistic UI, offline support, custom error boundaries.

---

## Testing — V0 policy

Manual smoke test only. `MANUAL_TEST.md` lists ~9 numbered click-through steps. Run after every meaningful change.

No automated test framework, no Jest/Vitest setup, no Playwright. We add automation when something stabilises enough to be worth regression-protecting.

---

## Deferred (out of V0 scope, with reasons)

| Deferred | Roadmap slot | Reason |
|---|---|---|
| Edit worker | V0.1 | Add immediately after V0 to round out CRUD basics |
| Delete worker | V0.1 | Need to think about S3 cleanup behaviour |
| Real per-user login (NCB Better Auth) | V0.2 | Independent learning milestone; flips RLS to private |
| Greta hosting | V0.3 (after auth works) | Deploy must follow auth, not lead it |
| More tables / FK relationships (Project, Team, etc.) | V1.0 | After V0.1 we'll know how NCB handles relationships |
| PDF generation, email | Probably never | Flatlogic-app concerns; not a learning goal here |
| Tighten AWS IAM (bucket-only, not S3FullAccess) | Before any public URL | Reduce blast radius of leaked keys |
| Orphan-file cleanup | Probably never | Cost is negligible at our scale |
| Automated tests | When the surface stabilises | YAGNI for V0 |
| **RLS switch from `public_readwrite` → `private`/`shared_*`** | **Mandatory before deploy** | **Without this, public internet can read/write worker data** |

---

## Critical reminders (will be replicated in README + code comments + deploy checklist)

🚨 **RLS policy**: `public_readwrite` is for localhost dev ONLY. Change to `private` or `shared_*` before any non-localhost URL exists.

🚨 **Secrets discipline**: NordPass is canonical. `.env.local` is the only runtime copy. Never anywhere else.

🚨 **Next.js env vars**: NCB and AWS keys must NEVER be prefixed `NEXT_PUBLIC_`. That prefix is the framework's signal "expose to browser" — exactly what we don't want.

🚨 **AWS IAM**: current user has `AmazonS3FullAccess` (account-wide). Acceptable for learning; harden before any public URL.

🚨 **NCB native auth at DB creation**: enabled. One-way door. Don't disable.

---

## Open questions (resolve during implementation)

- Does NCB's default schema for an auth-enabled database include any extra columns beyond `user_id`? Confirm by inspecting `get_schema` after creation.
- Does NCB Quick Create accept a `decimal` type, or do we need `string` and parse client-side? Confirm at table-creation time.
- AWS S3 `af-south-1` region: any presigning gotchas (signature v4, virtual-hosted-style URLs)? Check during first upload test.

---

## Next step

Hand off to the `superpowers:writing-plans` skill, which will produce a step-by-step implementation plan from this design.
