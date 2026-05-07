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
