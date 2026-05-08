# labourpay-ncb-test

A small Next.js learning project to evaluate **NoCodeBackend (NCB)** + **AWS S3** as a stack for the FoxFitt LabourPay payroll app.

V0 covers a single workflow: **create + view a worker profile** (name, monthly salary, photo, ID document).

🚨 **This is NOT a production app.** It's a learning slice running on localhost only. The Add Worker page is publicly accessible (no auth) — fine on `localhost`, dangerous anywhere else. See "Critical reminders" below.

The real production payroll app is the separate Django app at https://github.com/Konradzar/LabourPay_v5.

## What's in here

```
app/
├── api/
│   └── upload-url/route.ts              ← presigns S3 PUT URLs
├── workers/
│   ├── new/                             ← Add Worker (Client Component form)
│   └── [id]/page.tsx                    ← Worker detail (Server Component)
└── page.tsx                             ← Workers list (Server Component)
lib/
├── ncb-utils.ts                         ← NCB CONFIG + proxy helpers (env-validated)
├── s3-utils.ts                          ← AWS S3 client + presigners
└── types.ts                             ← shared Worker + NCB envelope types
scripts/
└── diag-s3.mjs                          ← S3 credential diagnostic
docs/
├── plans/                               ← design + implementation plan
├── SCHEMA.md                            ← NCB schema reference
├── NCB_NOTES.md                         ← discovered NCB quirks (read this!)
└── HANDOFF.md                           ← state-of-play if work pauses
```

## Stack

- **Next.js 16** (App Router, TypeScript, no Tailwind)
- **NoCodeBackend** — database (`35120_labourpay_ncb_test`) + REST data API
- **AWS S3** — file storage (private bucket `foxfitt-nocodebackend-001`, region `af-south-1`)
- **Better Auth** is enabled at the NCB level but unused in V0 (login UI deferred to V0.2)

## First-time setup (Windows)

```powershell
# 1. Install Node 20 LTS (or newer) if you don't have it
winget install -e --id OpenJS.NodeJS.LTS

# 2. Clone & install
git clone https://github.com/<your-username>/labourpay-ncb-test
cd labourpay-ncb-test
npm install

# 3. Set up secrets (one-time)
copy .env.local.example .env.local
# Then edit .env.local and paste real values from NordPass:
#   NCB_SECRET_KEY (40 chars)
#   AWS_ACCESS_KEY_ID (20 chars, starts AKIA)
#   AWS_SECRET_ACCESS_KEY (40 chars)
# The other 6 env vars are pre-filled correctly.

# 4. (One-time) apply S3 CORS — paste cors.json into AWS Console:
#    bucket → Permissions → Cross-origin resource sharing → Edit → paste → Save changes

# 5. Run dev server
npm run dev
```

Open http://localhost:3000.

## Daily workflow

```powershell
npm run dev
```

That's it. Edit code; Next.js hot-reloads.

## Manual smoke test

See [`MANUAL_TEST.md`](MANUAL_TEST.md). Run after any meaningful change. ~90 seconds end-to-end.

## Important docs to read

- [`docs/plans/2026-05-07-worker-profile-slice-design.md`](docs/plans/2026-05-07-worker-profile-slice-design.md) — original design, signed off, don't change.
- [`docs/plans/2026-05-07-worker-profile-slice-plan.md`](docs/plans/2026-05-07-worker-profile-slice-plan.md) — implementation plan (read alongside NCB_NOTES.md).
- [`docs/NCB_NOTES.md`](docs/NCB_NOTES.md) — **discovered NCB quirks. Read this before building anything new.** Covers: instance-prefix, response shapes, `DECIMAL`-as-INT, single-record endpoint quirk, two-route proxy.
- [`docs/SCHEMA.md`](docs/SCHEMA.md) — current state of the NCB `workers` table.

## 🚨 Critical reminders

### Before any deploy (Greta or otherwise)

🚨 **RLS policy on `workers` is `public_readwrite`**. This means anyone with the URL can read AND create rows without authentication. Fine on localhost (only your laptop can reach it). **CATASTROPHIC** on a public URL — random internet strangers could fill or read your database. Before deploying:

```
mcp__nocodebackend__set_rls_policy(
  database="35120_labourpay_ncb_test",
  table="workers",
  policy="private"   // or "shared_readwrite" for a single-admin setup
)
```

V0.2 shipped the auth UI (login / forgot-password / reset-password). V0.3 (in progress) flips `workers` to `private` and routes all reads/writes through `ncbAuthFetch` (Bearer + session cookies) and Server Actions — the old anonymous `/api/public-data/` proxy has been removed.

### Secrets

- **NordPass is canonical**. `.env.local` is the only runtime copy on your laptop. Never anywhere else.
- Never prefix any of these env vars with `NEXT_PUBLIC_` — that exposes them to the browser bundle. Specifically dangerous for `NCB_SECRET_KEY` and the AWS keys.
- The `nocodebackend_s3_01` IAM user has `AmazonS3FullAccess` (account-wide, not bucket-scoped). Tighten to bucket-only before any public URL.

### What's NOT implemented (deferred)

| Deferred | Roadmap slot |
|---|---|
| Edit / delete worker | V0.1 |
| Real per-user login (NCB Better Auth) | V0.2 |
| Greta hosting | V0.3 |
| More tables (Project, Team, etc.) | V1.0 |
| PDF generation, email | Probably never (Flatlogic-app concerns) |
| Tighten AWS IAM (bucket-only policy) | Before any public URL |
| Orphan-file cleanup | Probably never |
| Automated tests | When the surface stabilises |

## Scripts

- `npm run dev` — Next.js dev server with hot reload
- `npm run build` — production build
- `npm run start` — serves the production build
- `npm run lint` — ESLint
- `node scripts/diag-s3.mjs` — diagnose S3 credentials / list current objects

## License

Private. Not licensed for redistribution.
