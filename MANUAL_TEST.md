# Manual Smoke Test — V0 Worker Profile

Run this full sequence after any meaningful change to confirm the slice still works end-to-end.

**Expected total time:** ~90 seconds.

## Setup

1. Have a test JPEG and a test PDF ready (any small files; `C:\Users\konra\Desktop\## Temp\Claude se file sisteem\` is fine).
2. `npm run dev` — wait for "Ready in Xs". Server should bind to http://localhost:3000.

## Test sequence

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Open http://localhost:3000 | "Workers" heading + table of existing workers (or "No workers yet" if NCB is empty) |
| 2 | Click **+ Add Worker** | Navigates to `/workers/new`, form appears |
| 3 | Fill **Name** = "Manual Test" | Field accepts text |
| 4 | Fill **Monthly salary** = `5000` | Field accepts whole-rand number |
| 5 | Pick the test JPEG for **Photo** | Within ~3 seconds, "uploading…" → "✓ uploaded" |
| 6 | Pick the test PDF for **ID Document** | Same behaviour, ends with "✓ uploaded" |
| 7 | Click **Save Worker** | Form submits, page navigates back to `/`, "Manual Test" appears in the list |
| 8 | Click **Manual Test** in the list | Detail page loads, photo renders inline, "View document ↗" link visible |
| 9 | Click **View document ↗** | New tab opens, displays the PDF |
| 10 | Open AWS S3 console → bucket `foxfitt-nocodebackend-001` | Two new objects under `workers/<uuid>.jpg` and `workers/<uuid>.pdf` |
| 11 | Open NCB dashboard → `35120_labourpay_ncb_test` → Records → workers | New row exists with `name=Manual Test`, `monthly_salary=5000`, both `_key` columns populated |

If all 11 steps pass, V0 is in working order.

## What "doesn't pass" looks like

- **Step 5/6 stuck on "uploading…" forever**: check browser console for CORS error or 4xx from `/api/upload-url`.
- **Step 7 errors with red banner "Save failed: ..."**: the body of the banner is the actual error. Common: NCB rejected the row (check field types) or proxy 4xx.
- **Step 8: photo doesn't render** (broken image icon): presigned URL probably expired (>5 min) — refresh the page.
- **Step 8: page 404**: Next.js routing issue, check `app/workers/[id]/page.tsx` exists.
- **Step 11 row missing**: NCB Records page is sometimes slow to refresh — wait 10 seconds and retry.

## Re-running

You can re-run this as many times as you like — each run creates ONE new worker. Old test rows accumulate in NCB. Cleanup script (deletes ALL S3 objects + leaves NCB rows alone for now):

```powershell
node scripts/diag-s3.mjs
# (the diag script lists; cleanup is a manual step from the AWS console)
```

For NCB cleanup, use the NCB dashboard's Records page → select rows → Delete.

---

## V0.2 — NCB Better Auth (added 2026-05-08)

Single-admin scope. Bootstrap creates one account; `/login` form gates all worker pages.

### One-off bootstrap (run once per fresh database)

Pick a strong password, save it (NordPass), then from a terminal in the project directory:

```bash
curl -X POST "https://app.nocodebackend.com/api/user-auth/sign-up/email?Instance=$NCB_INSTANCE" \
  -H "Content-Type: application/json" \
  -H "X-Database-Instance: $NCB_INSTANCE" \
  -d '{"email":"<your-email>","password":"<strong-password>","name":"<your-name>"}'
```

Verify with SQL (NCB MCP `execute_sql`): `SELECT id, email FROM ncba_user;` shows one row.

### Scenario 17 — Anonymous redirect

In incognito: `localhost:3000/` → expected: redirected to `/login`. Same for any gated path (`/workers/4`, `/workers/new`, etc.).

### Scenario 18 — Sign in (happy path)

On `/login`, submit email + password. Expected: redirected to `/`. Header shows "Signed in as <email>" with a Sign out button. Worker list (with thumbnails) visible below.

### Scenario 19 — Sign in (wrong password)

Sign out first. On `/login`, submit your email + a wrong password. Expected: inline red text "Invalid email or password." Email retained; password field cleared. (Note: the same generic error shows for any 4xx from NCB — this is intentional to avoid email-enumeration leaks.)

### Scenario 20 — Sign out

Click "Sign out" in header. Expected: redirected to `/login`. Cookie `better-auth.session_token` cleared (verify in DevTools → Application → Cookies).

### Scenario 21 — Forgot/reset password

On `/login` click "Forgot password?". Submit your email. Check inbox (and spam) for reset email from NCB. Click the link → lands on `/reset-password?token=…&db=…`. Submit a new password. Expected: redirected to `/login`. Sign in with new password works.

**If the email never arrives:** NCB's email delivery may be misconfigured for your domain. Check NCB dashboard → Database settings → SMTP. Until that's resolved, you can also reset by manually updating `ncba_user.password` via SQL, but that requires knowing NCB's password hashing scheme — easier to fix SMTP.

### Scenario 22 — Delete worker (the canary)

While signed in:
1. Navigate to any worker's detail page (e.g. `/workers/<id>`)
2. Click "Delete worker", confirm in the dialog
3. Expected: redirected to `/`. Worker no longer in the list.

**Verify via SQL:** `SELECT * FROM workers WHERE id = <deleted_id>;` → 0 rows.

This single scenario exercises the entire V0.2 stack: login → session check → Server Action → ncbAuthFetch session forwarding → NCB authenticated DELETE → revalidate → list page render. If it passes, V0.2 is functionally complete.

---

## V0.2 RLS adjustment (modifies design doc Q5)

V0.2's design doc (`docs/plans/2026-05-08-v0.2-auth-design.md` Q5) intended to defer ALL RLS changes to V0.3. **In practice, V0.2 required adding `shared_readwrite` to the workers table policy.** Why: NCB's `public_readwrite` policy ONLY applies to anonymous requests. Once auth is in (sessions forwarded via `ncbAuthFetch`), NCB switches to authenticated-path semantics, where `public_*` policies don't cover PUT/DELETE. Without `shared_readwrite` (or per-row `user_id` ownership), authenticated DELETE returns 404 "Record not found or secret_key is incorrect" because NCB's default authenticated semantics filter by `user_id = session_user`.

**Final V0.2 RLS state:**

```
table_name | policy
-----------+-------
workers    | public_readwrite,shared_readwrite
```

- Anonymous (no session): `public_readwrite` applies → GET + POST allowed (browser AddWorkerForm continues to work)
- Authenticated (session): `shared_readwrite` applies → all CRUD allowed for any logged-in user, no `user_id` filtering

**For V0.3 (deploy + private RLS):** plan to remove both policies and set `private`. Backfill all existing workers' `user_id` to a real account first. Switch `AddWorkerForm` to post via authenticated `/api/data/create/workers` so new workers auto-stamp `user_id` from session.

To apply V0.2 RLS state on a fresh database, use NCB MCP:

```
mcp__nocodebackend__set_rls_policy(database, table="workers", policy="public_readwrite,shared_readwrite")
```

---

## V0.3 — Deploy + RLS flip + call-path migration (added 2026-05-09)

V0.3 takes the localhost-only V0.2 app and ships it to a public URL via Greta's GitHub-sync to Netlify, with proper authentication enforcement at every layer.

**State changes vs V0.2:**

- All NCB calls move server-side (Server Components / Server Actions / `ncbAuthFetch`); browser never carries an NCB credential
- `/api/public-data/[...path]/route.ts` and its dependent helpers in `lib/ncb-utils.ts` are deleted
- `/api/upload-url` and `/api/perceptpixel-upload` gain session-check guards (401 to anonymous callers)
- Workers RLS flipped from `public_readwrite,shared_readwrite` → `private`
- Existing 9 worker rows backfilled with `user_id` set to bootstrap user UUID
- Mid-flight: all worker fields except `name` made optional (form, server action, and DB schema all updated)

### Scenario 23 — Backfill verification (DB ground truth)

Via NCB MCP:
```
SELECT id, name, user_id FROM workers ORDER BY id
```

**Expect:** every row's `user_id` equals the bootstrap user UUID (no NULLs). After mid-flight optional-fields change, new rows created via the form auto-stamp `user_id` from session — same expectation.

### Scenario 24 — Local list works after RLS flip to `private`

While signed in: visit `http://localhost:3000/`.
**Expect:** list shows all workers owned by the signed-in user (initially 9, growing as you create). RLS now filters by `user_id = session.user.id` server-side at NCB.

### Scenario 25 — Server Action create persists with correct user_id

`/workers/new` → fill name (and optionally salary, photo, ID doc, PerceptPixel) → submit. After redirect, NCB MCP:
```
SELECT id, name, user_id FROM workers ORDER BY id DESC LIMIT 1
```
**Expect:** new row's `user_id` matches the signed-in user. Note: the form's submit handler does NOT include `user_id` in the payload — NCB sets it from the session because workers RLS is `private`.

### Scenario 26 — Anonymous /api/upload-url returns 401

```bash
curl -i -X POST http://localhost:3000/api/upload-url \
  -H "Content-Type: application/json" \
  -d '{"contentType":"image/jpeg"}'
```
**Expect:** `HTTP/1.1 401 Unauthorized` with body `{"error":"Unauthorized"}`. Same shape for `/api/perceptpixel-upload` with no session.

### Scenario 27 — Create with only a name (post-mid-flight)

`/workers/new` → fill ONLY the Name field → submit.
**Expect:** redirect to `/`, new row visible with the name and "R —" in the salary column. Detail page renders "No photo uploaded.", "No ID document uploaded.", "No PerceptPixel image."

**Verify via SQL:**
```
SELECT id, name, monthly_salary, photo_key, id_doc_key, perceptpixel_url FROM workers ORDER BY id DESC LIMIT 1
```
**Expect:** `monthly_salary`, `photo_key`, `id_doc_key`, `perceptpixel_url` all SQL NULL (not empty strings).

### Scenario 28 — Production: deploy + first sign-in (Greta-Netlify URL)

Visit production URL.
**Expect:** redirect to `/login`. After sign-in, list renders, shows all workers owned by you.

If sign-in fails with NCB Better Auth CSRF / Origin mismatch: NCB allowed-origins for the instance does not include the production hostname. Add it via NCB dashboard.

### Scenario 29 — Production: end-to-end create with all fields

Production URL → `/workers/new` → fill name + salary, attach photo + ID doc + PerceptPixel image → submit.
**Expect:** redirect to `/`; new row in DB; photo retrievable from S3 via signed URL; PerceptPixel thumbnail renders inline on list and detail pages.

If photo upload fails with CORS error in DevTools: AWS S3 bucket CORS does not include the production hostname in `AllowedOrigins`. Add it.

If PerceptPixel upload fails: server-side proxy is consuming the API key — check Netlify env vars include `PERCEPTPIXEL_API_KEY`.

---

## V0.3 schema adjustment (modifies design doc)

V0.3's design intended to keep the workers schema as-is. **Mid-flight, `monthly_salary` was flipped from `INT NOT NULL` → `INT NULL`** to support "make all fields except name optional" UX. Existing 9 rows kept their values; row 13 (first post-change create) confirmed proper SQL NULL persistence.

To replicate the schema state on a fresh database:

```
ALTER TABLE workers MODIFY COLUMN monthly_salary INT NULL
```

(NCB MCP `execute_sql`.)

---

## V0.3 RLS state

```
table_name | policy
-----------+-------
workers    | (absent — NCB models "private" as no row in ncba_rls_config)
```

- Anonymous: NCB rejects authenticated-route reads → list page never reaches it (the `(app)/layout.tsx` session guard redirects to `/login` first)
- Authenticated: NCB filters `WHERE user_id = session.user.id`; reads, creates, updates, deletes all scoped to the signed-in user

To apply V0.3 RLS state:

```
mcp__nocodebackend__set_rls_policy(database, table="workers", policy="private")
```

