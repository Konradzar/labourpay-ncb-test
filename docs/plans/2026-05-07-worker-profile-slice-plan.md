# V0 Worker Profile Slice — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a tiny end-to-end Next.js app that creates and views worker profiles (name, salary, photo, ID document), proving NCB + AWS S3 work together.

**Architecture:** Next.js (App Router, TypeScript) acts as both UI and BFF (data proxy). The browser calls Next.js API routes; those routes hold all secrets and forward calls to NCB's REST data API and AWS S3. File uploads go browser→S3 directly via short-lived presigned URLs. Bucket stays fully private.

**Tech Stack:** Next.js 14+ (App Router) · TypeScript · React Server Components · `@aws-sdk/client-s3` · `@aws-sdk/s3-request-presigner` · NoCodeBackend (Quick Create database, native auth ENABLED) · AWS S3 (bucket: `foxfitt-nocodebackend-001`, region `af-south-1`).

**Companion design doc:** [`docs/plans/2026-05-07-worker-profile-slice-design.md`](./2026-05-07-worker-profile-slice-design.md). Read it first.

**User actions in this plan are flagged 🧑 USER ACTION** — those are the bits Konrad does himself (NordPass paste, GitHub repo creation, etc.). Everything else Claude can drive.

---

## Phase A — Bootstrap

### Task 1: Scaffold the Next.js project

**Files:**
- Create: `C:\Users\konra\Documents\GitHub\labourpay-ncb-test\` (entire folder)
- Create: `.gitignore` (Next.js default, plus `.env.local`)
- Create: `.env.local.example`
- Move: existing design doc into `docs/plans/` of the new repo (already there ✓)

**Step 1: Run `create-next-app`**

🧑 USER ACTION (or Claude via Bash if approved):

```powershell
cd C:\Users\konra\Documents\GitHub
npx create-next-app@latest labourpay-ncb-test --typescript --eslint --app --no-src-dir --import-alias "@/*" --no-tailwind --use-npm
```

Expected: scaffold runs, `labourpay-ncb-test/` populated with Next.js skeleton, ~30 seconds.

**Step 2: Verify Next.js dev server starts**

```powershell
cd labourpay-ncb-test
npm run dev
```

Expected: `http://localhost:3000` shows the default Next.js welcome page. Press Ctrl+C to stop.

**Step 3: Add `.env.local.example`**

Write `C:\Users\konra\Documents\GitHub\labourpay-ncb-test\.env.local.example`:

```env
# Copy this file to .env.local and paste real values from NordPass.
# .env.local is gitignored — it must NEVER be committed.

# === NCB ===
NCB_INSTANCE=labourpay_ncb_test
NCB_SECRET_KEY=
NCB_AUTH_API_URL=https://app.nocodebackend.com/api/user-auth
NCB_DATA_API_URL=https://app.nocodebackend.com/api/data
NCB_APP_URL=https://app.nocodebackend.com

# === AWS S3 ===
AWS_REGION=af-south-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=foxfitt-nocodebackend-001
```

**Step 4: Verify `.gitignore` includes `.env.local`**

`create-next-app` already adds it. Open `.gitignore` and confirm the line `.env*.local` (or `.env.local`) is present. If not, add it.

**Step 5: Initial commit**

```powershell
cd C:\Users\konra\Documents\GitHub\labourpay-ncb-test
git add .
git status
```

Expected: design doc, plan doc, scaffold files staged. `.env.local` MUST NOT appear (verify by inspecting `git status` output).

```powershell
git commit -m "feat: initial Next.js scaffold + design doc"
```

---

### Task 2: Create the NCB database

**Files:** none in repo (NCB resource creation)

**Step 1: Call `create_database` MCP tool**

Inputs (verify exact parameter names via ToolSearch first):
- `name`: `labourpay_ncb_test`
- `native_user_auth`: `true` (ONE-WAY DOOR — must be true)
- Anything else (description, plan): leave default

**Step 2: Verify with `list_databases`**

Expected: `databases[]` now contains one entry with name `labourpay_ncb_test`, plan `Starter`, and an associated Secret Key.

**Step 3: Capture the Secret Key**

🧑 USER ACTION: NCB returns the secret key once on creation (or via the dashboard's Secret Key reveal). Konrad copies it into NordPass under entry `NCB labourpay_ncb_test secret key`.

**Step 4: Call `get_integration_prompts`**

Inputs:
- `database`: `labourpay_ncb_test`

Expected: returns markdown content for `auth_proxy_setup.md` and `data_proxy_setup.md`.

**Step 5: Save the integration prompts**

Write the returned content to:
- `C:\Users\konra\Documents\GitHub\labourpay-ncb-test\docs\auth_proxy_setup.md`
- `C:\Users\konra\Documents\GitHub\labourpay-ncb-test\docs\data_proxy_setup.md`

These are reference docs — we'll consult them in Tasks 6 and 7.

**Step 6: Commit the docs**

```powershell
git add docs/
git commit -m "docs: NCB integration prompts for labourpay_ncb_test"
```

---

### Task 3: Create the `workers` table in NCB and set RLS

**Files:** none in repo (NCB schema changes)

**Step 1: Call `create_table` MCP tool**

Inputs:
- `database`: `labourpay_ncb_test`
- `table`: `workers`
- columns: see table below

| Column | NCB type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | |
| `monthly_salary` | decimal (or number if decimal unavailable) | yes | |
| `photo_key` | string | no | filled by app, not user |
| `id_doc_key` | string | no | |

NCB auto-adds: `id`, `created_at`, `user_id` (because native auth is on).

**Step 2: Verify the schema**

```
mcp__nocodebackend__get_schema(database="labourpay_ncb_test")
```

Expected: `workers` table appears with our 4 columns + the 3 NCB-auto columns (id, created_at, user_id).

**Step 3: Set RLS policy on `workers`**

```
mcp__nocodebackend__set_rls_policy(
    database="labourpay_ncb_test",
    table="workers",
    policy="public_readwrite"
)
```

Expected: success. This means the public data proxy (`/api/public-data/`) can read/write without a session.

🚨 **WRITE THIS REMINDER IN README LATER**: this policy is for localhost dev only. Change to `private` or `shared_readwrite` before any deploy.

**Step 4: Document the schema in repo**

Write `docs/SCHEMA.md`:

```markdown
# NCB Schema — labourpay_ncb_test

## `workers` table

| Column | Type | Source | Notes |
|---|---|---|---|
| `id` | int | NCB auto | Primary key |
| `name` | string | app | Worker's full name |
| `monthly_salary` | decimal | app | ZAR per month |
| `photo_key` | string | app | S3 object key, e.g. `workers/<uuid>.jpg` |
| `id_doc_key` | string | app | S3 object key |
| `created_at` | datetime | NCB auto | Row creation |
| `user_id` | int | NCB auto | Unused in V0 (auth not implemented) |

**RLS policy**: `public_readwrite` — V0 ONLY (localhost dev). Switch to `private`/`shared_*` before any deploy.
```

**Step 5: Commit**

```powershell
git add docs/SCHEMA.md
git commit -m "docs: NCB workers table schema + RLS policy note"
```

---

### Task 4: Configure CORS on the S3 bucket

**Files:**
- Create: `cors.json` (repo root)

**Step 1: Write `cors.json`**

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

**Step 2: Apply CORS to the bucket**

🧑 USER ACTION (requires AWS CLI + valid AWS keys configured locally):

```powershell
aws s3api put-bucket-cors --bucket foxfitt-nocodebackend-001 --cors-configuration file://cors.json
```

Expected: silent success (no output) if it works. Errors mean check `aws configure` keys.

**Step 3: Verify CORS was applied**

```powershell
aws s3api get-bucket-cors --bucket foxfitt-nocodebackend-001
```

Expected: returns the JSON we just applied.

**Step 4: Commit**

```powershell
git add cors.json
git commit -m "feat: S3 CORS config for localhost dev"
```

---

## Phase B — Server-side plumbing

### Task 5: Add real secrets locally + scaffold `lib/ncb-utils.ts`

**Files:**
- Create: `.env.local` (NOT committed)
- Create: `lib/ncb-utils.ts`

**Step 1: Create `.env.local` from the example**

🧑 USER ACTION:

```powershell
copy .env.local.example .env.local
```

Then open `.env.local` in an editor and paste from NordPass:
- `NCB_SECRET_KEY=<from NordPass entry "NCB labourpay_ncb_test secret key">`
- `AWS_ACCESS_KEY_ID=<from NordPass entry "AWS nocodebackend-s3_01 access key">`
- `AWS_SECRET_ACCESS_KEY=<from NordPass entry "AWS nocodebackend-s3_01 secret">`

The other values are already correct from the example file.

**Step 2: Verify `.env.local` is gitignored**

```powershell
git status
```

Expected: `.env.local` should NOT appear in the output. If it does, STOP and fix `.gitignore`.

**Step 3: Scaffold `lib/ncb-utils.ts`**

Write:

```typescript
// lib/ncb-utils.ts
//
// Server-side helpers for talking to the NCB data API.
// Holds NCB_SECRET_KEY in process.env — never leaks to the browser.

const NCB_DATA_API_URL = process.env.NCB_DATA_API_URL!;
const NCB_INSTANCE = process.env.NCB_INSTANCE!;
const NCB_SECRET_KEY = process.env.NCB_SECRET_KEY!;

if (!NCB_DATA_API_URL || !NCB_INSTANCE || !NCB_SECRET_KEY) {
  throw new Error(
    "Missing required NCB env vars. Check .env.local against .env.local.example."
  );
}

// Generic fetch wrapper for NCB data API.
// All calls send the secret key as Bearer token (server-side ONLY).
export async function ncbFetch(
  pathSuffix: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${NCB_DATA_API_URL}${pathSuffix}?Instance=${NCB_INSTANCE}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${NCB_SECRET_KEY}`);
  headers.set("X-Database-Instance", NCB_INSTANCE);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}
```

**Step 4: Sanity check — start dev server, ensure it boots without env errors**

```powershell
npm run dev
```

Expected: dev server starts at `localhost:3000`, no error in console about missing env vars. Stop with Ctrl+C.

**Step 5: Commit**

```powershell
git add lib/ncb-utils.ts
git commit -m "feat: NCB fetch helper (server-side only)"
```

---

### Task 6: Build the NCB data proxy route

**Files:**
- Create: `app/api/data/[...path]/route.ts`

**Step 1: Write the data proxy**

Write `app/api/data/[...path]/route.ts`:

```typescript
// app/api/data/[...path]/route.ts
//
// Forwards browser requests to NCB's data API, attaching the server-only
// Bearer token. The browser never sees the secret key.
//
// Pattern: GET    /api/data/workers           -> NCB list workers
//          POST   /api/data/workers           -> NCB create worker
//          GET    /api/data/workers/123       -> NCB get worker by id
//          PATCH  /api/data/workers/123       -> NCB update worker
//          DELETE /api/data/workers/123       -> NCB delete worker

import { NextRequest, NextResponse } from "next/server";
import { ncbFetch } from "@/lib/ncb-utils";

async function proxy(req: NextRequest, params: { path: string[] }) {
  const pathSuffix = "/" + params.path.join("/");
  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await req.text();

  const ncbResponse = await ncbFetch(pathSuffix, {
    method: req.method,
    body,
  });

  const text = await ncbResponse.text();
  return new NextResponse(text, {
    status: ncbResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxy(req, params);
}
export async function POST(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxy(req, params);
}
export async function PATCH(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxy(req, params);
}
export async function DELETE(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxy(req, params);
}
```

**Step 2: Manual smoke test — list (empty) workers**

Start dev server: `npm run dev`. In a second terminal:

```powershell
curl http://localhost:3000/api/data/workers
```

Expected: HTTP 200, body is `[]` or `{ "data": [] }` (depends on NCB's exact shape — note the actual response for the next steps).

**Step 3: Manual smoke test — create a worker (without files)**

```powershell
curl -X POST http://localhost:3000/api/data/workers `
  -H "Content-Type: application/json" `
  -d '{"name":"Test","monthly_salary":5000,"photo_key":"placeholder","id_doc_key":"placeholder"}'
```

Expected: HTTP 200/201, response body includes the new row with an `id`.

**Step 4: Verify in NCB Records UI**

🧑 USER ACTION: Open NCB dashboard → My Databases → labourpay_ncb_test → Records → workers. Should see the test row.

**Step 5: Commit**

```powershell
git add app/api/data/
git commit -m "feat: NCB data proxy route"
```

---

### Task 7: Build the S3 upload-URL endpoint + `lib/s3-utils.ts`

**Files:**
- Create: `lib/s3-utils.ts`
- Create: `app/api/upload-url/route.ts`

**Step 1: Install AWS SDK packages**

```powershell
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

**Step 2: Write `lib/s3-utils.ts`**

```typescript
// lib/s3-utils.ts
//
// Server-side helpers for AWS S3.
// Generates short-lived presigned URLs — AWS keys never leave the server.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const S3_REGION = process.env.AWS_REGION!;
const S3_BUCKET = process.env.S3_BUCKET_NAME!;
const S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID!;
const S3_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY!;

if (!S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  throw new Error("Missing required AWS env vars. Check .env.local.");
}

const s3 = new S3Client({
  region: S3_REGION,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// === UPLOADS ===
// Generates a presigned PUT URL plus the object key. Browser PUTs the file
// directly to S3 using the URL, then sends `key` to the data proxy.
export async function makeUploadUrl(opts: {
  contentType: string;
}): Promise<{ url: string; key: string }> {
  const ext = ALLOWED_TYPES[opts.contentType];
  if (!ext) {
    throw new Error(`Unsupported content type: ${opts.contentType}`);
  }

  const key = `workers/${randomUUID()}.${ext}`;
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: opts.contentType,
    ContentLength: undefined, // optional — could enforce MAX_BYTES via signed policy if needed
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 300 });
  return { url, key };
}

// === DOWNLOADS ===
// Generates a presigned GET URL for a key. Used by detail pages.
export async function makeDownloadUrl(key: string): Promise<string> {
  if (!key) return "";
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return await getSignedUrl(s3, command, { expiresIn: 300 });
}

export { MAX_BYTES };
```

**Step 3: Write `app/api/upload-url/route.ts`**

```typescript
// app/api/upload-url/route.ts
//
// Browser POSTs { contentType: "image/jpeg" } and gets back
// { url, key }. Browser then PUTs the file directly to `url`.

import { NextRequest, NextResponse } from "next/server";
import { makeUploadUrl } from "@/lib/s3-utils";

export async function POST(req: NextRequest) {
  let body: { contentType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.contentType) {
    return NextResponse.json({ error: "contentType required" }, { status: 400 });
  }

  try {
    const { url, key } = await makeUploadUrl({ contentType: body.contentType });
    return NextResponse.json({ url, key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
```

**Step 4: Manual smoke test — generate an upload URL**

Start dev server: `npm run dev`. In a second terminal:

```powershell
curl -X POST http://localhost:3000/api/upload-url `
  -H "Content-Type: application/json" `
  -d '{"contentType":"image/jpeg"}'
```

Expected: HTTP 200, body like `{"url":"https://foxfitt-...amazonaws.com/...?...&Signature=...","key":"workers/<uuid>.jpg"}`.

**Step 5: Manual smoke test — actually upload a file using the presigned URL**

🧑 USER ACTION:

1. Copy the `url` from the response above.
2. Pick a test JPEG (e.g. one from `C:\Users\konra\Desktop\## Temp\Claude se file sisteem\`).
3. Upload it:

```powershell
curl -X PUT "<paste-url-here>" -H "Content-Type: image/jpeg" --data-binary "@C:\path\to\test.jpg"
```

Expected: HTTP 200, no body. Then verify in AWS S3 console — the new object should appear at `workers/<uuid>.jpg`.

**Step 6: Commit**

```powershell
git add lib/s3-utils.ts app/api/upload-url/ package.json package-lock.json
git commit -m "feat: S3 presigned upload URL endpoint"
```

---

## Phase C — UI

### Task 8: Build the Workers list page

**Files:**
- Replace: `app/page.tsx`
- Create: `app/globals.css` adjustments (light styling)

**Step 1: Replace `app/page.tsx`**

```typescript
// app/page.tsx
// Workers list — Server Component. Fetches via the data proxy and renders.

import Link from "next/link";

type Worker = {
  id: number;
  name: string;
  monthly_salary: number;
  photo_key: string;
  id_doc_key: string;
  created_at?: string;
};

async function fetchWorkers(): Promise<Worker[]> {
  const res = await fetch(`${process.env.NCB_DATA_API_URL?.replace("/api/data", "") ?? "http://localhost:3000"}/api/data/workers`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`NCB list workers failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  // NCB may return either an array or { data: [...] }. Handle both.
  return Array.isArray(json) ? json : (json.data ?? []);
}

export default async function WorkersPage() {
  const workers = await fetchWorkers();
  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Workers</h1>
      <p><Link href="/workers/new">+ Add Worker</Link></p>
      {workers.length === 0 ? (
        <p style={{ color: "#666" }}>No workers yet.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #333" }}>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Name</th>
              <th style={{ textAlign: "right", padding: "0.5rem" }}>Monthly salary</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} style={{ borderBottom: "1px solid #ddd" }}>
                <td style={{ padding: "0.5rem" }}>
                  <Link href={`/workers/${w.id}`}>{w.name}</Link>
                </td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>
                  R {Number(w.monthly_salary).toLocaleString("en-ZA")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

**Note on the fetch URL**: Server Components fetching `/api/data/...` need an absolute URL. The line above derives one from env vars. There are cleaner ways (`internal-fetch` helpers, Next 14's `dynamic = 'force-dynamic'` etc.); we accept the simple version for V0.

**Step 2: Manual smoke test**

```powershell
npm run dev
```

Open `http://localhost:3000`. Expected: shows the Test worker created in Task 6 (or "No workers yet" if you've cleared NCB).

**Step 3: Commit**

```powershell
git add app/page.tsx
git commit -m "feat: workers list page"
```

---

### Task 9: Build the Add Worker page + form

**Files:**
- Create: `app/workers/new/page.tsx` (Server Component shell)
- Create: `app/workers/new/AddWorkerForm.tsx` (Client Component — form)

**Step 1: Write `app/workers/new/page.tsx`**

```typescript
// app/workers/new/page.tsx
import AddWorkerForm from "./AddWorkerForm";

export default function NewWorkerPage() {
  return (
    <main style={{ maxWidth: 480, margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Add Worker</h1>
      <AddWorkerForm />
    </main>
  );
}
```

**Step 2: Write `app/workers/new/AddWorkerForm.tsx`**

```typescript
"use client";

// app/workers/new/AddWorkerForm.tsx
//
// Client component. Two file inputs use upload-on-pick — files are uploaded
// to S3 via presigned URL the moment they're selected. The form's hidden
// state stores the returned keys. On submit, only the keys are sent to NCB.

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

type UploadState = { key: string | null; uploading: boolean; error: string | null };

const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_BYTES = 5 * 1024 * 1024;

async function uploadFile(file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Unsupported type: ${file.type}. Use JPEG, PNG or PDF.`);
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`File too large (max ${MAX_BYTES / 1024 / 1024} MB).`);
  }

  const presignRes = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type }),
  });
  if (!presignRes.ok) throw new Error(`Presign failed: ${await presignRes.text()}`);
  const { url, key } = await presignRes.json();

  const putRes = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);

  return key;
}

export default function AddWorkerForm() {
  const router = useRouter();
  const [photo, setPhoto] = useState<UploadState>({ key: null, uploading: false, error: null });
  const [idDoc, setIdDoc] = useState<UploadState>({ key: null, uploading: false, error: null });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto({ key: null, uploading: true, error: null });
    try {
      const key = await uploadFile(file);
      setPhoto({ key, uploading: false, error: null });
    } catch (err) {
      setPhoto({ key: null, uploading: false, error: err instanceof Error ? err.message : "Upload failed" });
    }
  };

  const handleIdDocChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIdDoc({ key: null, uploading: true, error: null });
    try {
      const key = await uploadFile(file);
      setIdDoc({ key, uploading: false, error: null });
    } catch (err) {
      setIdDoc({ key: null, uploading: false, error: err instanceof Error ? err.message : "Upload failed" });
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!photo.key || !idDoc.key) {
      setError("Wait for both files to finish uploading before saving.");
      return;
    }
    const formData = new FormData(e.currentTarget);
    const payload = {
      name: formData.get("name"),
      monthly_salary: Number(formData.get("monthly_salary")),
      photo_key: photo.key,
      id_doc_key: idDoc.key,
    };
    setSubmitting(true);
    try {
      const res = await fetch("/api/data/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status} ${await res.text()}`);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
      <label>
        Name
        <input name="name" required type="text" style={{ width: "100%", padding: "0.4rem" }} />
      </label>
      <label>
        Monthly salary (R)
        <input name="monthly_salary" required type="number" min="0" step="0.01" style={{ width: "100%", padding: "0.4rem" }} />
      </label>
      <label>
        Photo (JPEG / PNG / PDF, max 5 MB)
        <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={handlePhotoChange} />
        {photo.uploading && <span> uploading…</span>}
        {photo.key && <span style={{ color: "green" }}> ✓ uploaded</span>}
        {photo.error && <span style={{ color: "red" }}> {photo.error}</span>}
      </label>
      <label>
        ID Document (JPEG / PNG / PDF, max 5 MB)
        <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={handleIdDocChange} />
        {idDoc.uploading && <span> uploading…</span>}
        {idDoc.key && <span style={{ color: "green" }}> ✓ uploaded</span>}
        {idDoc.error && <span style={{ color: "red" }}> {idDoc.error}</span>}
      </label>
      {error && <div style={{ color: "red" }}>{error}</div>}
      <button type="submit" disabled={submitting || photo.uploading || idDoc.uploading} style={{ padding: "0.5rem 1rem" }}>
        {submitting ? "Saving…" : "Save Worker"}
      </button>
    </form>
  );
}
```

**Step 3: Manual smoke test**

```powershell
npm run dev
```

Open `http://localhost:3000/workers/new`. Fill name + salary, pick a JPEG, pick a PDF. Both should show "✓ uploaded" within seconds. Click Save Worker. Should redirect to `/` and the new worker appears in the list.

**Step 4: Verify in S3 console + NCB Records**

🧑 USER ACTION:
- AWS S3 console: 2 new objects under `workers/`.
- NCB Records: 1 new row with both `_key` columns populated.

**Step 5: Commit**

```powershell
git add app/workers/new/
git commit -m "feat: add worker form with S3 upload-on-pick"
```

---

### Task 10: Build the Worker detail page

**Files:**
- Create: `app/workers/[id]/page.tsx`

**Step 1: Write `app/workers/[id]/page.tsx`**

```typescript
// app/workers/[id]/page.tsx
// Server Component. Fetches the worker, generates presigned download URLs
// for the photo and ID doc, and renders.

import { notFound } from "next/navigation";
import Link from "next/link";
import { makeDownloadUrl } from "@/lib/s3-utils";

type Worker = {
  id: number;
  name: string;
  monthly_salary: number;
  photo_key: string;
  id_doc_key: string;
};

async function fetchWorker(id: string): Promise<Worker | null> {
  const baseUrl = `${process.env.NCB_DATA_API_URL?.replace("/api/data", "") ?? "http://localhost:3000"}`;
  const res = await fetch(`${baseUrl}/api/data/workers/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`NCB get worker failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  // NCB may return the row directly or wrapped in { data: ... }
  return json.data ?? json;
}

export default async function WorkerDetailPage({ params }: { params: { id: string } }) {
  const worker = await fetchWorker(params.id);
  if (!worker) notFound();

  const photoUrl = await makeDownloadUrl(worker.photo_key);
  const idDocUrl = await makeDownloadUrl(worker.id_doc_key);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
      <p><Link href="/">← All workers</Link></p>
      <h1>{worker.name}</h1>
      <p>Monthly salary: R {Number(worker.monthly_salary).toLocaleString("en-ZA")}</p>
      <h2>Photo</h2>
      {photoUrl ? (
        <img src={photoUrl} alt={`Photo of ${worker.name}`} style={{ maxWidth: 320, height: "auto" }} />
      ) : (
        <p style={{ color: "#666" }}>No photo</p>
      )}
      <h2>ID Document</h2>
      {idDocUrl ? <a href={idDocUrl} target="_blank" rel="noopener noreferrer">View document</a> : <p style={{ color: "#666" }}>No document</p>}
    </main>
  );
}
```

**Step 2: Manual smoke test**

```powershell
npm run dev
```

Click a worker on the list page. Expected: detail page loads, photo renders, "View document" link opens the PDF/image.

**Step 3: Commit**

```powershell
git add app/workers/[id]/
git commit -m "feat: worker detail page with presigned download URLs"
```

---

## Phase D — Wrap-up

### Task 11: Write `MANUAL_TEST.md` and `README.md`

**Files:**
- Create: `MANUAL_TEST.md`
- Create or update: `README.md`

**Step 1: Write `MANUAL_TEST.md`**

```markdown
# Manual Smoke Test — V0 Worker Profile

Run this full sequence after any meaningful change. Expected total time: ~90 seconds.

## Setup

1. `npm run dev` — dev server running at http://localhost:3000.
2. Have a test JPEG and a test PDF ready (e.g. in `C:\Users\konra\Desktop\## Temp\Claude se file sisteem\`).

## Test sequence

1. Open http://localhost:3000 — should show "Workers" heading + (possibly empty) list.
2. Click "+ Add Worker" — form appears.
3. Fill: name = "Test Worker", monthly salary = 5000.
4. Pick the test JPEG for Photo — should show "uploading…" then "✓ uploaded" within ~3 seconds.
5. Pick the test PDF for ID Document — same behaviour.
6. Click Save Worker — should redirect to "/" and "Test Worker" appears in the list.
7. Click "Test Worker" in the list — detail page loads.
8. The photo should render. The "View document" link should open the PDF in a new tab.
9. Open the AWS S3 console (af-south-1 / foxfitt-nocodebackend-001) — 2 new objects under `workers/<uuid>.jpg` and `workers/<uuid>.pdf`.
10. Open NCB dashboard → labourpay_ncb_test → Records → workers — 1 new row, all 4 app-set columns populated.

If any step fails, do NOT mark V0 as done. Diagnose and fix.
```

**Step 2: Write `README.md`**

```markdown
# labourpay-ncb-test

A small Next.js learning project to evaluate NoCodeBackend (NCB) + AWS S3.

V0 covers a single workflow: create + view a worker profile (name, salary, photo, ID doc).

**This is NOT a production app.** See [`docs/plans/2026-05-07-worker-profile-slice-design.md`](docs/plans/2026-05-07-worker-profile-slice-design.md) for the full design.

## Stack

- Next.js 14 (App Router) + TypeScript
- NoCodeBackend (database + REST data API)
- AWS S3 (private bucket, presigned URLs)

## First-time setup (Windows)

```powershell
# 1. Install tooling (skip what you already have)
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Amazon.AWSCLI

# 2. Clone & install
git clone <this repo> labourpay-ncb-test
cd labourpay-ncb-test
npm install

# 3. Set up secrets
copy .env.local.example .env.local
# Then edit .env.local and paste real values from NordPass.

# 4. Apply S3 CORS (one-time)
aws s3api put-bucket-cors --bucket foxfitt-nocodebackend-001 --cors-configuration file://cors.json

# 5. Run dev server
npm run dev
```

Open http://localhost:3000.

## Daily workflow

```powershell
npm run dev
```

## Manual smoke test

See [`MANUAL_TEST.md`](MANUAL_TEST.md). Run after any meaningful change.

## 🚨 Critical reminders

- **RLS policy is `public_readwrite`** for V0 — localhost dev only. Change to `private` or `shared_readwrite` before any deploy. See `docs/SCHEMA.md`.
- **Secrets** live in `.env.local` (gitignored) and NordPass (canonical). Never commit, screenshot, or paste elsewhere.
- **AWS keys**: never prefix env vars with `NEXT_PUBLIC_` — that exposes them to the browser bundle.
- **AWS IAM**: `nocodebackend-s3_01` user has `AmazonS3FullAccess` (account-wide). Acceptable for learning. Tighten to bucket-only before any public URL.

## What's NOT implemented (deferred)

See the design doc's "Deferred" table. Highlights: edit/delete worker, real per-user login, Greta deploy, more tables, automated tests.
```

**Step 3: Commit**

```powershell
git add MANUAL_TEST.md README.md
git commit -m "docs: manual smoke test + README"
```

---

### Task 12: Push to GitHub

**Files:** none

**Step 1: Create the GitHub repo**

🧑 USER ACTION: Konrad creates a new private GitHub repo named `labourpay-ncb-test` at https://github.com/new. Do NOT add a README, .gitignore, or license — the local repo already has those.

**Step 2: Add remote + push**

```powershell
cd C:\Users\konra\Documents\GitHub\labourpay-ncb-test
git remote add origin https://github.com/Konradzar/labourpay-ncb-test.git
git branch -M main
git push -u origin main
```

Expected: all commits pushed. Repo visible on GitHub.

**Step 3: Final manual smoke test**

🧑 USER ACTION: Run the full `MANUAL_TEST.md` end-to-end one more time. If it passes, V0 is done.

---

## Verification matrix — when V0 is "done"

| Check | How to verify | Pass criterion |
|---|---|---|
| Add Worker page accepts files | Open `/workers/new`, pick JPEG + PDF | Both show "✓ uploaded" |
| Worker row in NCB | NCB Records → workers | Row exists with all 4 app columns filled |
| Files in S3 | AWS Console → bucket → workers/ | 2 new objects with UUID names |
| List page renders worker | Open `/` | Worker appears with name + salary |
| Detail page renders photo | Open `/workers/<id>` | `<img>` shows the uploaded image |
| Detail page renders ID doc link | Same page | Link opens the PDF/image |
| Manual test sequence | Run `MANUAL_TEST.md` | All 10 steps pass |
| No secrets in git | `git log -p \| Select-String "NCB_SECRET\|AKIA"` | No matches |

When all 8 rows pass, V0 is done. Stop here, take a breath, decide V0.1 priorities (probably: edit, delete, then auth).

---

## Open issues to watch for during execution

These are predictable trip-ups; flag them if hit.

1. **NCB response shape unknowns**: I've written defensive code for both `Array.isArray()` and `{ data: [...] }`, but if NCB's actual shape differs (e.g. `{ records: [...] }`), the list page will break. Adjust based on what `curl /api/data/workers` actually returns in Task 6.

2. **S3 region quirk**: `af-south-1` requires AWS Signature v4. The AWS SDK v3 uses v4 by default, so this should "just work", but if presigned uploads fail with "InvalidArgument" check the region mismatch first.

3. **CORS preflight on PUT**: Browsers send a `OPTIONS` preflight before the `PUT`. If `OPTIONS` isn't allowed in our `cors.json`, uploads fail mysteriously. We've allowed `*` headers and `GET/PUT/HEAD` methods — preflight should pass. If not, add `"POST"` and `"OPTIONS"` to `AllowedMethods`.

4. **NCB native auth column requirements**: NCB might insist on a non-null `user_id` for `public_readwrite` writes, even though we don't use auth. If creates fail with a `user_id` constraint error, two options: (a) make `user_id` nullable in the schema, or (b) inject a fixed dummy user_id in the data proxy. Decide at the time.

5. **Server Component fetch URL**: The list and detail pages assemble their own `http://localhost:3000` URL — fragile. If you later deploy and the host changes, this breaks. Replace with a `process.env.NEXT_PUBLIC_APP_URL` or use a relative-path fetch helper before V0.1.
