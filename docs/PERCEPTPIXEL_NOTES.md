# PerceptPixel — operating notes

> Field notes from integrating PerceptPixel as a third image source on top of
> S3 + NCB during V0.1.5 of the labourpay-ncb-test project (May 2026).
> Written so the next integration doesn't have to discover any of this from
> scratch.

---

## TL;DR — the rules that aren't obvious from the docs

1. **Auth is `Api-Key`, not `Bearer`.** Header literal: `Authorization: Api-Key <KEY>`.
2. **Folders are *organizational metadata*, not paths in storage.** Files uploaded with `folder=X` go into a *folder-scoped namespace* that is **NOT addressable by `/v1/media/<uid>`** for tags, view, or annotations. Workaround: upload to root, operate on the uid, then **move** to the folder.
3. **URL transformations only work for files inside folders** (at least in our `evzmohsl` org). Root-level files return 404 for any transform URL even though the original serves fine.
4. **The transformation segment goes immediately after the org-uid**, not before the filename. So `<host>/<org>/<transform>/<folder>/<filename>` — *not* `<host>/<org>/<folder>/<transform>/<filename>`.
5. **The `cdn_url` returned by upload doesn't auto-update after a move.** You have to reconstruct it server-side.
6. **uid-based endpoints have an indexing race** — a 404 immediately after upload doesn't mean the uid is wrong, it means PerceptPixel hasn't indexed it yet. Retry with backoff.
7. **The Api-Key cannot be exposed to the browser.** All uploads must go via a server-side proxy. There is no presigned-URL or browser-direct equivalent (unlike S3).

---

## Authentication

### Header format
```
Authorization: Api-Key pxl_8c350936.16216f6c97fe1bfce08af35cbf68af88
```

The literal prefix is `Api-Key` — **not** `Bearer`, **not** `Token`. Easy to misread the docs and assume Bearer.

### Key format
```
pxl_XXXX.YYYY{...}
```
Total 41 characters: 8-char prefix + period + 32-char secret.

### Where to get one
PerceptPixel Dashboard → Settings → API Keys → "Create Token". Single-name flat list. No documented per-token scopes.

### Where to put it
- **Server-side only**, e.g. `.env.local` as `PERCEPTPIXEL_API_KEY`.
- Never `NEXT_PUBLIC_*` — that prefix is the framework's signal "expose to browser".
- Never in client code, however indirectly.

---

## API surface map

### Base URLs
- API: `https://api.perceptpixel.com/v1/...`
- CDN: `https://img.perceptpixel.com/<org-uid>/...`
- The `/api/v1/...` path on `api.perceptpixel.com` redirects (301) to `/v1/...`. Use `/v1/...` directly.

### Endpoints used in V0.1.5

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/media` | Upload a file |
| GET | `/v1/media` | List + paginated search |
| GET | `/v1/media/<uid>` | Read one file's metadata |
| POST | `/v1/media/<uid>/annotations` | Set tags + captions |
| POST | `/v1/media/<uid>/annotations/generate` | AI-suggest tags + captions |
| PUT | `/v1/media/<uid>/move` | Relocate file to a folder |
| DELETE | `/v1/media/<uid>` | Permanent delete |

---

## Upload (`POST /v1/media`)

### Request
- Content-Type: `multipart/form-data`
- Required fields:
  - `file` — binary
  - `name` — filename string
- Optional fields:
  - `folder` — **DO NOT USE.** See "Folder gotcha" below.

### Response (200 OK)
```json
{
  "uid": "aRjexrkh",                         // 8-10 char alphanumeric, our handle
  "name": "cat.jpg",
  "path": "<project>-<org>/cat.jpg",         // internal storage path (NOT a URL)
  "cdn_url": "https://img.perceptpixel.com/<org>/cat.jpg",  // public URL
  "thumbnail_url": "https://img.perceptpixel.com/<org>/w_600,h_600,c_pad/cat.jpg",
  "file_size": 144224,
  "width": 600,
  "height": 800,
  "type": "jpeg",
  "uploaded_by": "user@example.com",
  "tags": [],
  "caption": null,
  "folder": null,
  "saved_images": { ... }                    // pre-computed variant URLs
}
```

### Browser-direct upload?
No — there is **no presigned-URL flow** like S3 has. Browser → Next.js route handler → PerceptPixel is the only safe path because the Api-Key must stay server-side.

### Implementation pattern
```typescript
// Server-side helper (Node 18+)
const form = new FormData();
form.append("file", new Blob([arrayBuffer], { type: contentType }), filename);
form.append("name", filename);

const res = await fetch("https://api.perceptpixel.com/v1/media", {
  method: "POST",
  headers: { Authorization: `Api-Key ${API_KEY}` },
  // DO NOT manually set Content-Type — fetch + FormData → "multipart/...; boundary=..."
  body: form,
});
```

TS note: pass `ArrayBuffer` to `new Blob([...])`, not `Buffer` or `Uint8Array<ArrayBufferLike>`. Strict `BlobPart` typing in TS 5.x rejects the latter due to the `SharedArrayBuffer` corner case.

---

## Folder gotcha — the biggest landmine

### What appears to work
The `folder` parameter on `POST /v1/media` is documented and accepted:
```
form.append("folder", "Workers");
```
HTTP 201, you get back a uid + cdn_url like `https://img.perceptpixel.com/<org>/Workers/<filename>`. The file appears in the dashboard inside the "Workers" folder. Looks great.

### Where it breaks (silent, downstream)
Files uploaded this way are in a **folder-scoped namespace** that is not addressable via the standard uid endpoints:
- `GET /v1/media/<uid>` → 404 `{"detail": "No Media matches the given query."}`
- `POST /v1/media/<uid>/annotations` → 404
- The file IS visible in the dashboard. The uid IS the one returned by upload. Both views and tags fail.

So you upload, get a uid, the file looks fine, then any subsequent API call fails as if the file doesn't exist. *Insidious because it appears to work on the way in.*

### List endpoint also can't see folder contents
- `GET /v1/media?folder=Workers` returns the same root-level items as `GET /v1/media` — the filter is silently ignored. We tested this with multiple folder names; always returned root items only.
- Empirically: in our account, folders are a *dashboard organization* concept, not a queryable scope.

### The fix that does work (verified empirically)
Upload to root, perform any uid-based operations, *then* move:
```
1. POST /v1/media                       → uid in root
2. POST /v1/media/<uid>/annotations     → tags applied (file is queryable)
3. PUT  /v1/media/<uid>/move            → file lands in target folder
```
This sequence is reliable. The user verified manually that **tags survive folder moves** — so step 2 doesn't get undone by step 3.

### Reconstruct the post-move cdn_url server-side
When you move from root to a folder, the `cdn_url` from step 1 is now stale (points at the file's old root location). Move endpoint doesn't return the new URL. Reconstruct it:
```typescript
// in:  https://img.perceptpixel.com/<org>/<filename>
// out: https://img.perceptpixel.com/<org>/<folder>/<filename>
function relocateCdnUrl(cdnUrl, folderName) {
  const url = new URL(cdnUrl);
  const segments = url.pathname.split("/").filter(s => s);
  if (segments.length !== 2) return cdnUrl;
  const [orgUid, filename] = segments;
  return `${url.origin}/${orgUid}/${encodeURIComponent(folderName)}/${filename}`;
}
```
Persist *that* URL, not the upload's original cdn_url. (We didn't do this initially and ended up with stale URLs in NCB pointing at non-existent root paths.)

---

## Annotations (tags + captions)

### Vocabulary
PerceptPixel calls tags+captions together "annotations". Tags are **objects**, not strings:
```json
{
  "tags": [
    { "name": "worker", "confidence": 1.0 }
  ],
  "captions": [
    { "text": "...", "confidence": 0.85 }
  ]
}
```
- `confidence`: 1.0 for human-set; <1.0 for AI-generated suggestions.

### Update — `POST /v1/media/<uid>/annotations`
- Body: JSON
- Partial update: omit a field to retain existing, pass `[]` to clear.
- 200 returns the updated annotations object.

### AI auto-tag — `POST /v1/media/<uid>/annotations/generate`
- No body required.
- Returns suggested `{tags, captions}` with confidence scores.
- **Doesn't auto-save** — you have to POST the results back via the update endpoint to persist.
- Counts against the "image analysis reports" quota in your license tier (we didn't actually exercise this).

### Indexing race — retry on 404
Immediately after upload, the annotations endpoint can return:
```
HTTP 404
{"detail": "No Media matches the given query."}
```
…even when the uid is correct and the file exists. PerceptPixel needs a few hundred ms to index newly-uploaded media so it's findable by uid. Retry with backoff:
```typescript
const BACKOFF_MS = [0, 500, 1000];
for (let attempt = 1; attempt <= 3; attempt++) {
  if (BACKOFF_MS[attempt-1] > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt-1]));
  const res = await fetch(...);
  if (res.ok) return;
  if (res.status !== 404) break;  // non-404 won't improve with retry
}
```
3 attempts with 0/500/1000ms backoff worked reliably for us. **Retry only on 404** — other status codes (401 auth, 400 bad request, 500 server) won't improve and would hide real bugs.

---

## Move (`PUT /v1/media/<uid>/move`)

### Surprise: form-urlencoded body, not JSON
Per the curl example in their docs:
```bash
curl -X PUT "https://api.perceptpixel.com/v1/media/<uid>/move" \
     -H "Authorization: Api-Key <KEY>" \
     -d 'folder_name=Workers'
```
The `-d 'foo=bar'` form sets `Content-Type: application/x-www-form-urlencoded`. Sending JSON here returns 400.

In fetch:
```typescript
fetch(`https://api.perceptpixel.com/v1/media/${uid}/move`, {
  method: "PUT",
  headers: { Authorization: `Api-Key ${API_KEY}` },
  body: new URLSearchParams({ folder_name: "Workers" }),  // auto-sets Content-Type
});
```
Don't manually set Content-Type — `URLSearchParams` as body does it for you.

### Auto-creates folders
Pass any folder name; PerceptPixel creates it on first reference. No separate "create folder" call needed.

### Response
- 200: `{"status": "success"}`
- 4xx: docs warn the error format is unfinalized, suggest checking status code only.

### Same indexing race as annotations
Move can also return 404 immediately after upload. Same retry-on-404 with backoff is appropriate.

---

## URL transformations — `https://img.perceptpixel.com/<org>/<TRANSFORM>/<rest>`

### Syntax
Comma-separated underscore-delimited parameters as a **single path segment**, placed immediately after the org-uid:
```
https://img.perceptpixel.com/<org>/w_400,h_300,c_pad,q_auto/Workers/photo.jpg
```

### Documented operations
- `w_<int>` — width
- `h_<int>` — height
- `c_pad` — pad to maintain aspect ratio (only crop mode docs explicitly mention)
- `q_<int|string>` — quality (`q_auto` works)
- `f_<format>` — format conversion (e.g. `f_png`, `f_jpg`)

### Empirical findings the docs don't mention
- **Other crop modes (c_fill, c_crop, c_scale) aren't documented** — we didn't test them, but if you need them you'll have to probe.
- **Transformations FAIL with 404 for root-level files in our account.** Same file in a folder works perfectly. Verified by trying `w_40` alone, `w_40,h_40,c_pad`, and `f_jpg` against a known-good root-level file — all 404. Move the file into a folder, the same transforms work.
  - This may be a tier-specific limitation. Worth checking whether higher tiers enable root-level transforms.
- **Transform segment placement matters.** It MUST be the second segment (right after org-uid). If the file is in a folder, the URL is `<host>/<org>/<transform>/<folder>/<filename>` — *not* `<host>/<org>/<folder>/<transform>/<filename>` (the latter returns 400). Easy to get wrong if you do naive `lastIndexOf("/")` insertion.

### Pure-URL helper (no API call)
The CDN serves transformations on demand — you don't need to "register" a thumbnail variant. Just construct the URL. Worth keeping the helper in its own module that *doesn't* depend on the API key, so it's safe to import from Client Components or anywhere else.

---

## List + search — `GET /v1/media`

### Pagination
- `?page=N&limit=N`
- Default `limit` matters (we didn't pin down exact default for PP, but assume 10-25 like NCB).
- Pagination links in the response use `/api/v1/media?...` paths — these 301 to `/v1/media?...`.

### Filtering
- `?folder=X` — does **not** filter (returned all root items in our test). Possibly an account/tier limit, possibly a documented-but-not-shipped feature. Don't trust it.
- `?type=image/jpeg` etc. should work per docs (we didn't test).

---

## Common error shapes

| Symptom | Likely cause | Fix |
|---|---|---|
| 401 on every call | Api-Key missing/wrong header format ("Bearer" vs "Api-Key") | Set `Authorization: Api-Key <key>` literally |
| 400 on multipart upload | Manually set Content-Type clobbered the boundary | Let fetch set Content-Type when body is FormData |
| 400 on move | JSON body where form-urlencoded was expected | Use `URLSearchParams` body |
| 404 immediately after upload | Indexing race — file not yet queryable | Retry on 404 with backoff |
| 404 long after upload | File is in a folder-scoped namespace | Don't use upload `folder` param; upload to root and move |
| 404 on transform URL but original works | Account doesn't allow root-level transforms | Move file into a folder, retry |
| 400 on transform URL with folder | Transform segment in wrong position | Place transform immediately after org-uid |

---

## The recipe that works (V0.1.5 reference)

For "upload an image, tag it, put it in a folder, store the public URL":

```typescript
// SERVER-SIDE — never run this in the browser
async function uploadAndOrganize(arrayBuffer, filename, contentType, folderName, tags) {
  // Step 1: upload to root (no folder param)
  const upload = await uploadToPerceptPixel(arrayBuffer, filename, contentType);
  // upload = { uid, cdn_url: "<host>/<org>/<filename>" }

  // Step 2: tag (retry-on-404 inside the helper)
  try {
    await addAnnotationsToMedia(upload.uid, { tags });
  } catch (e) { console.warn("tagging failed", e); /* fire-and-forget */ }

  // Step 3: move to folder (retry-on-404 inside the helper)
  let cdn_url = upload.cdn_url;
  try {
    await moveMediaToFolder(upload.uid, folderName);
    cdn_url = relocateCdnUrl(upload.cdn_url, folderName);  // <-- KEY
  } catch (e) { console.warn("move failed", e); /* file stays in root */ }

  return { cdn_url, uid: upload.uid };
}
```

Key pattern points:
- Each downstream step is **fire-and-forget** — failure shouldn't block the upload, and the response should be the uploaded URL regardless. Tag/move are enhancements, not critical-path.
- Retry-on-404 lives inside the helpers, so callers don't worry about indexing race.
- The cdn_url returned reflects the file's **actual final location** after all steps.

---

## V0 design decisions worth knowing

These choices made our integration easier; future projects might keep or revisit them.

1. **Server-side proxy for uploads.** No client-side API key. Browser POSTs multipart to a Next.js route handler; the handler does PerceptPixel work and returns just `{cdn_url, uid}` to the client.
2. **Pure-URL helper in its own module** (no env var dependencies) — safe to import from anywhere, doesn't trip "is this server-side?" Next.js bundler issues.
3. **Hard-coded folder/tag in the route handler**, not passed from the client. Means a workers route always tags "worker" + folders "Workers"; a hypothetical projects route would have its own constants. Client can't lie about what category an upload belongs to.
4. **Store the post-move cdn_url** in the database, not the original. Otherwise you end up with stale URLs after the file moves, and the only way to recover is a manual SQL update.
5. **Skip browser-side validation for tags/folders** — those are server-side decisions. Browser only validates file size/type for friendly UX.

---

## Things we deliberately didn't test

- **AI annotation generation** (the `/annotations/generate` endpoint). Available in our license per the dashboard; we just didn't invoke it. Easy to bolt on later.
- **Custom domains** (license includes 10). We used the default `img.perceptpixel.com`. Custom domain config is a dashboard setting; URL transformations should work the same way once configured.
- **Multiple remote origins** (license includes 10). We used PerceptPixel's native storage (the "α" mode). Remote origins (PerceptPixel as a CDN front of S3) is a different architecture — different upload flow, different URL shape.
- **Background removal transformations** (unlimited per license). Probably a transformation parameter we didn't probe; check `/docs/Transformations` for relevant params.
- **Chrome / WordPress plugin features.** Not relevant to a Next.js integration.

---

## Things to verify in your own account before relying on this doc

Account/tier-specific behavior we observed but can't generalize:

- Whether root-level files support URL transformations in your tier (ours: no).
- Whether folder filtering on `/v1/media` actually filters in your tier (ours: no).
- Whether `confidence` defaults to 1.0 are enforced (we passed 1.0 explicitly to be safe).
- Default `limit` on the list endpoint.
- Rate limits, file size limits (we capped at 5 MB to mirror our S3 limit; PerceptPixel didn't push back).

---

## Diagnostic checklist for new integrations

When something's not working, run these in order:

1. **Is the API key right?** `curl -H "Authorization: Api-Key $KEY" https://api.perceptpixel.com/v1/media?limit=1` — should 200 with a list. 401 = key wrong or wrong header.
2. **Is the file actually in PerceptPixel?** Visible in dashboard? Look at the URL bar — what folder is the file in?
3. **Is the uid one PerceptPixel can resolve?** `curl -H "Authorization: Api-Key $KEY" https://api.perceptpixel.com/v1/media/<uid>` — 200 = good, 404 = file is folder-scoped or never indexed.
4. **Has indexing caught up?** Wait 1-2 seconds and retry. If still 404, the file is in a folder namespace (problem 3).
5. **Is your transform URL shape right?** `<host>/<org>/<transform>/<rest>` — never insert the transform between folder and filename.
6. **Does the original (no transform) URL work?** `curl -I https://img.perceptpixel.com/<org>/...` — 200 = file exists at that URL, transformation issue. 404 = stale URL or file moved.

---

*Last updated: V0.1.5, May 2026. Cross-reference: `lib/perceptpixel-utils.ts` (server helpers), `lib/perceptpixel-url.ts` (pure URL helpers), `app/api/perceptpixel-upload/route.ts` (route orchestration), `docs/NCB_NOTES.md` (the partner doc for NoCodeBackend).*
