# PerceptPixel — operating notes

> Field notes from integrating PerceptPixel as a third image source on top of
> S3 + NCB during V0.1.5 of the labourpay-ncb-test project (May 2026).
> Written so the next integration doesn't have to discover any of this from
> scratch.

---

## TL;DR — the rules that aren't obvious from the docs

1. **Auth is `Api-Key`, not `Bearer`.** Header literal: `Authorization: Api-Key <KEY>`.
2. **Foldered files live in a separate uid namespace from root files.** Default uid endpoints (`/v1/media/<uid>`, `/v1/media/<uid>/annotations`, `DELETE /v1/media/<uid>`) return `404 No Media matches the given query` for files inside a folder — even though the file IS in PerceptPixel and the dashboard shows it fine. **The fix:** append `?folder_name=<folder>` to the URL on every uid endpoint. PerceptPixel re-scopes the lookup into the folder namespace and the call works as documented. This query-param form is **undocumented** in PerceptPixel's public docs but verified empirically (V0.3, May 2026, by Konrad in NativeRest). It works on **all** uid endpoints — at least DELETE and annotations have been confirmed.
3. **You can upload directly to a folder** by passing `folder=<name>` as a form-data field on `POST /v1/media`. The response cdn_url already points at `<host>/<org>/<folder>/<filename>` — no separate move call needed. (Earlier V0.1.5 notes prescribed a 3-step "upload to root → tag → move" workaround. That approach was based on incomplete API knowledge; rule #2 makes the direct-to-folder upload safe.)
4. **URL transformations only work for files inside folders** (at least in our `evzmohsl` org). Root-level files return 404 for any transform URL even though the original serves fine — another reason direct-to-folder upload is the right default.
5. **The transformation segment goes immediately after the org-uid**, not before the filename. So `<host>/<org>/<transform>/<folder>/<filename>` — *not* `<host>/<org>/<folder>/<transform>/<filename>`.
6. **uid-based endpoints have an indexing race** — a 404 immediately after upload doesn't mean the uid is wrong, it means PerceptPixel hasn't indexed it yet. Retry with backoff. (Independent of the folder-namespace 404, which is a permanent state until you add `?folder_name=`.)
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
  - `folder` — destination folder name. **Use it.** PerceptPixel auto-creates the folder if it doesn't exist, and the response cdn_url already points at the foldered path. (V0.1.5 had a note saying "DO NOT USE" because the team only knew about the path-only uid endpoints; that workaround was superseded once we discovered `?folder_name=` works on all uid endpoints. See TL;DR rule #2.)

### Response (200 OK)
```json
{
  "uid": "aRjexrkh",                         // 8-10 char alphanumeric, our handle
  "name": "cat.jpg",
  "path": "<project>-<org>/Workers/cat.jpg", // internal storage path (NOT a URL)
  "cdn_url": "https://img.perceptpixel.com/<org>/Workers/cat.jpg",  // public URL — already foldered when folder=Workers was passed
  "thumbnail_url": "https://img.perceptpixel.com/<org>/w_600,h_600,c_pad/Workers/cat.jpg",
  "file_size": 144224,
  "width": 600,
  "height": 800,
  "type": "jpeg",
  "uploaded_by": "user@example.com",
  "tags": [],
  "caption": null,
  "folder": "Workers",
  "saved_images": { ... }                    // pre-computed variant URLs
}
```

### Browser-direct upload?
No — there is **no presigned-URL flow** like S3 has. Browser → Next.js route handler → PerceptPixel is the only safe path because the Api-Key must stay server-side.

### Implementation pattern (V0.3+ direct-to-folder)
```typescript
// Server-side helper (Node 18+)
const form = new FormData();
form.append("file", new Blob([arrayBuffer], { type: contentType }), filename);
form.append("name", filename);
form.append("folder", "Workers"); // V0.3+ — file lands in folder, cdn_url is already foldered

const res = await fetch("https://api.perceptpixel.com/v1/media", {
  method: "POST",
  headers: { Authorization: `Api-Key ${API_KEY}` },
  // DO NOT manually set Content-Type — fetch + FormData → "multipart/...; boundary=..."
  body: form,
});
```

After upload, any subsequent uid-based call (annotations, delete) must include `?folder_name=Workers` as a query parameter — see the relevant sections below.

TS note: pass `ArrayBuffer` to `new Blob([...])`, not `Buffer` or `Uint8Array<ArrayBufferLike>`. Strict `BlobPart` typing in TS 5.x rejects the latter due to the `SharedArrayBuffer` corner case.

---

## Folder gotcha — the original landmine, and the V0.3 fix

### The shape of the problem

Files inside a folder live in a **separate uid namespace** from root files. The default uid endpoints can't see them:

- `GET /v1/media/<uid>` → 404 `{"detail": "No Media matches the given query."}`
- `POST /v1/media/<uid>/annotations` → 404
- `DELETE /v1/media/<uid>` → 404

This is true whether the file got into the folder via direct upload (`folder=` form field on `POST /v1/media`) or via a later move (`PUT /v1/media/<uid>/move`). The file IS visible in the dashboard. The uid IS the one returned by upload. The default endpoints just don't find it.

### The V0.3 fix: `?folder_name=<folder>` query parameter

Append `?folder_name=<folder>` to the URL on every uid endpoint and PerceptPixel re-scopes the lookup into the folder namespace. **All the previously-404 endpoints now work as documented.** Tested against our `evzmohsl` org, May 2026:

| Endpoint shape | Foldered uid result |
|---|---|
| `DELETE /v1/media/<uid>` | 404 (silent fail) |
| `DELETE /v1/media/<uid>?folder_name=Workers` | **204 No Content** ✅ |
| `POST /v1/media/<uid>/annotations` | 404 |
| `POST /v1/media/<uid>/annotations?folder_name=Workers` | **200** ✅ |
| `GET /v1/media/<uid>` | 404 |
| `GET /v1/media/<uid>?folder_name=Workers` | (untested as of V0.3, but plausibly 200 by symmetry) |

The query-param form is **undocumented** in PerceptPixel's public API docs. Konrad discovered it by experimenting in NativeRest while debugging the V0.3 deleteWorker flow. PerceptPixel's docs almost certainly miss it because the docs were written before folders existed; the param is a backward-compatible extension hidden behind their API but not surfaced anywhere.

### List endpoint does NOT respect `?folder=`

- `GET /v1/media?folder=Workers` returns the same root-level items as `GET /v1/media` — the filter is silently ignored. We tested this with multiple folder names; always returned root items only.
- The query-param `?folder_name=` was not tested on the list endpoint. May or may not work — V1.0+ work, not relevant for V0.3.
- For listing folder contents reliably: use the dashboard. Or upload tagged files and filter the root list by tag instead of folder.

### History: the V0.1.5 workaround (now superseded)

V0.1.5 didn't know about `?folder_name=`, so it used a 3-step workaround: upload to root → tag while in root namespace → move to folder. The cdn_url returned by step 1 had to be reconstructed (`relocateCdnUrl` helper in `lib/perceptpixel-url.ts`) because it pointed at the pre-move root path. V0.3 replaced this with a 2-step direct-to-folder flow; the old `relocateCdnUrl` and `moveMediaToFolder` helpers were deleted. See "The recipe that works" below for the current sequence.

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

### Update — `POST /v1/media/<uid>/annotations[?folder_name=<folder>]`
- Body: JSON
- Partial update: omit a field to retain existing, pass `[]` to clear.
- 200 returns the updated annotations object.
- **Foldered uids:** append `?folder_name=<folder>`. Without it the endpoint returns 404 with `"No Media matches the given query."` even though the uid is correct. See "Folder gotcha" above. Example:
  ```bash
  POST https://api.perceptpixel.com/v1/media/MCkCKCLKrI/annotations?folder_name=Workers
  Authorization: Api-Key <KEY>
  Content-Type: application/json
  Body: {"tags":[{"name":"worker","confidence":1.0}]}
  → 200 OK
  ```

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

> **Not used by the V0.3 flow.** The V0.1.5 upload pipeline relied on this to relocate root uploads into the Workers folder; V0.3 dropped that step in favor of direct-to-folder upload + `?folder_name=` on subsequent calls. Documented here for completeness — useful if you ever need to relocate an existing file (e.g. a "Workers/_archive" folder for soft-deleted records).

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

### Empty folder_name is rejected (no "move to root" via this endpoint)
Tested in V0.3:
| folder_name value | Result |
|---|---|
| `""` | 400 "Please specify destination folder name" |
| `"/"` | 400 |
| `"_root"` | 400 (no implicit root concept) |

There is no API path to move a foldered file back to root. If you need to operate on a foldered uid, use `?folder_name=` on the relevant endpoint instead of trying to move it out.

### Auto-creates folders
Pass any folder name; PerceptPixel creates it on first reference. No separate "create folder" call needed.

### Response
- 200: `{"status": "success"}`
- 4xx: docs warn the error format is unfinalized, suggest checking status code only.

### Same indexing race as annotations
Move can also return 404 immediately after upload. Same retry-on-404 with backoff is appropriate.

---

## Delete (`DELETE /v1/media/<uid>`)

### The folder gotcha applies on the way out, too

PerceptPixel's docs show a clean path-only DELETE returning `204 No Content`:
```
DELETE https://api.perceptpixel.com/v1/media/<uid>
```
That works for **root-level** files. For files inside a folder (the only kind we have, since the V0.1.5 upload sequence ends with a move-to-folder), the same call returns:
```
HTTP 404
{"detail":"No Media matches the given query."}
```

The working form scopes the lookup to the folder via a **query parameter**:
```
DELETE https://api.perceptpixel.com/v1/media/<uid>?folder_name=Workers
→ 204 No Content
```

### Symptom of getting this wrong

The bug is invisible from the response alone: a naive client treats `404` as "already gone" and reports success. Meanwhile the file persists in the dashboard's folder view and the cdn_url keeps serving the image. We shipped this bug in V0.3 commit `79ac1f0`; it took two more commits (`dc7302d` for a wrong fix, `f3bdf11` for the right one) to nail.

### Implementation

```typescript
const DELETE_URL = (uid: string) =>
  `https://api.perceptpixel.com/v1/media/${encodeURIComponent(uid)}` +
  `?folder_name=${encodeURIComponent("Workers")}`;

const res = await fetch(DELETE_URL(uid), {
  method: "DELETE",
  headers: { Authorization: `Api-Key ${API_KEY}` },
});

// Treat 200, 204, 404 as success.
// 200/204: actually deleted.
// 404 with the correct folder_name: file is genuinely gone (concurrent delete or
// previously cleaned up). Without folder_name, 404 is a false positive — see above.
if (!res.ok && res.status !== 404) {
  throw new Error(`PerceptPixel DELETE ${uid} failed: ${res.status}`);
}
```

### Other shapes that DON'T work (tested empirically against our `evzmohsl` org, V0.3)

| Attempt | Result |
|---|---|
| `DELETE /v1/media/<uid>` (no folder_name) | 404; file stays in folder |
| `GET /v1/media/<uid>` (no folder_name) on foldered file | 404 (can't even read its metadata) |
| `POST /v1/media/<uid>/annotations` (no folder_name) on foldered file | 404 |
| `PUT /v1/media/<uid>/move` with `folder_name=""` | 400 "Please specify destination folder name" |
| `PUT /v1/media/<uid>/move` with `folder_name="/"` | 400 |
| `PUT /v1/media/<uid>/move` with `folder_name="_root"` | 400 (no implicit root concept) |

The first three rows all share the same root cause: the standard uid endpoints don't see the folder namespace without `?folder_name=<folder>`. Konrad's NativeRest testing confirmed annotations specifically: `POST /v1/media/<uid>/annotations?folder_name=Workers` returns 200 where the path-only form returned 404.

### CDN cache zombie note

If you DELETE a file using the wrong shape (no `folder_name`), PerceptPixel sometimes purges the API-visible metadata anyway. The dashboard's image-details page eventually disappears, but the `https://img.perceptpixel.com/<org>/<folder>/<filename>` URL keeps serving from CDN cache for some unknown TTL. We hit this on uid `LjllKqzpvT` during V0.3 testing: API said "not found" both before and after the fix, dashboard showed it gone, but the cdn_url still returned 200 with the image. Don't rely on cdn_url 200/404 as proof of deletion — check the API endpoint with `?folder_name=` or the dashboard UI.

### Discovery credit

The query-param shape isn't in PerceptPixel's public docs. Konrad found it by experimenting in NativeRest while we were debugging the V0.3 deleteWorker flow. PerceptPixel's path-only docs almost certainly miss it because the docs were written before folders existed; the `?folder_name=` parameter is a backward-compatible extension hidden behind their API but not surfaced in the docs page.

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

## The recipe that works (V0.3 — current)

For "upload an image, tag it, put it in a folder, store the public URL":

```typescript
// SERVER-SIDE — never run this in the browser
async function uploadAndOrganize(arrayBuffer, filename, contentType, folderName, tags) {
  // Step 1: upload directly to the destination folder. The cdn_url returned
  // already includes the folder path. No relocation needed.
  const upload = await uploadToPerceptPixel(
    arrayBuffer, filename, contentType, folderName
  );
  // upload = { uid, cdn_url: "<host>/<org>/<folderName>/<filename>" }

  // Step 2: tag with folder context. Foldered uids return 404 on annotations
  // unless ?folder_name=<folder> scopes the lookup. Fire-and-forget on
  // failure (file is already uploaded and visible in the dashboard).
  try {
    await addAnnotationsToMedia(upload.uid, { tags }, folderName);
  } catch (e) { console.warn("tagging failed", e); }

  return { cdn_url: upload.cdn_url, uid: upload.uid };
}

// And later, on cleanup:
async function deleteMedia(uid, folderName) {
  // Foldered uids ALSO need ?folder_name=<folder> on DELETE.
  await fetch(
    `https://api.perceptpixel.com/v1/media/${uid}?folder_name=${folderName}`,
    { method: "DELETE", headers: { Authorization: `Api-Key ${API_KEY}` } }
  );
  // 200, 204, 404 → success (404 = already gone or wrong folder; treat both as ok)
}
```

Key pattern points:
- Step 2 is **fire-and-forget** — tagging failure shouldn't block the upload. The file is already in the folder and the cdn_url is already valid.
- Retry-on-404 lives inside the helpers, so callers don't worry about indexing race. (Note: indexing-race 404s and folder-namespace 404s look identical from the response. The retry mostly catches the indexing race; the `?folder_name=` query param fixes the namespace one.)
- Always pass `folderName` to subsequent uid-based operations on the same file. There's no API to move it back to root, so once it's foldered, downstream calls must include the folder.

### V0.1.5 reference (the older, more complicated recipe)

For historical context — V0.1.5 didn't know about the `?folder_name=` query parameter, so it used a 3-step root → tag → move sequence with cdn_url reconstruction. That code is gone (deleted in V0.3); this snippet is preserved only so anyone reading old commits can follow what was happening:

```typescript
// V0.1.5 — DO NOT USE. Kept here for historical reference only.
async function uploadAndOrganize_v015(arrayBuffer, filename, contentType, folderName, tags) {
  const upload = await uploadToPerceptPixel(arrayBuffer, filename, contentType); // root
  try { await addAnnotationsToMedia(upload.uid, { tags }); } catch {}            // tag in root
  let cdn_url = upload.cdn_url;
  try {
    await moveMediaToFolder(upload.uid, folderName);                              // relocate
    cdn_url = relocateCdnUrl(upload.cdn_url, folderName);                         // reconstruct URL
  } catch {}
  return { cdn_url, uid: upload.uid };
}
```

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

*Last updated: V0.3 finishing pass, May 2026 — generalised the `?folder_name=` discovery (originally only documented for DELETE) to the cross-cutting "all uid endpoints take folder_name" rule that Konrad established via NativeRest testing. Replaced V0.1.5's 3-step root → tag → move recipe with the V0.3 2-step direct-to-folder + folder-scoped tag flow. Deleted dead helpers `relocateCdnUrl` and `moveMediaToFolder` from the codebase. Cross-reference: `lib/perceptpixel-utils.ts` (server helpers — `uploadToPerceptPixel`, `addAnnotationsToMedia`, `deletePerceptPixelMedia`, plus the `WORKERS_FOLDER` constant), `lib/perceptpixel-url.ts` (pure URL helper `perceptpixelThumbnailUrl`), `app/api/perceptpixel-upload/route.ts` (the V0.3 2-step orchestration), `app/(app)/workers/[id]/actions.ts` (`deleteWorker` calls the delete helper), `docs/NCB_NOTES.md` (the partner doc for NoCodeBackend).*
