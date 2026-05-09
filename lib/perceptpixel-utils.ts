// lib/perceptpixel-utils.ts
//
// Server-side helper for uploading to PerceptPixel's media API.
// API key is server-only — NEVER exposed to the browser.
//
// Pattern: browser → /api/perceptpixel-upload (Next.js route) → PerceptPixel API
// Different from S3 (which uses presigned URLs for browser-direct upload)
// because PerceptPixel's auth is via a long-lived Api-Key header that would
// be unsafe to expose to client-side JavaScript.
//
// Auth header format note: PerceptPixel uses
//   Authorization: Api-Key <API_KEY>
// which is NOT the more common "Bearer" scheme. The literal prefix is "Api-Key".
//
// Source: https://perceptpixel.com/docs/api/api-keys (fetched 2026-05-07)

const API_KEY = process.env.PERCEPTPIXEL_API_KEY;
const UPLOAD_URL = "https://api.perceptpixel.com/v1/media";

// Fail loudly at module load if the env var is missing. Without this, the
// first upload would fail with a 401 from PerceptPixel and a confusing
// "missing API key" error from inside JSON parsing. With this, the route
// handler throws a clear setup-pointing error the moment it's hit.
//
// Note: this throw fires only when the module is imported. Since the only
// consumer is app/api/perceptpixel-upload/route.ts (a route handler that
// Next.js evaluates lazily on first request), the rest of the app keeps
// running fine until someone actually tries to upload.
if (!API_KEY) {
  throw new Error(
    "PERCEPTPIXEL_API_KEY missing. Add it to .env.local (format: " +
      "pxl_XXXX.YYYY{...}) and restart `npm run dev` — env vars are read " +
      "at module load, hot reload won't pick this up."
  );
}

const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export const PP_MAX_BYTES = 5 * 1024 * 1024; // mirror existing S3 limit (lib/s3-utils.ts)

export type PerceptPixelUploadResult = {
  cdn_url: string;
  uid: string;
  width?: number;
  height?: number;
};

export async function uploadToPerceptPixel(
  fileData: ArrayBuffer,
  filename: string,
  contentType: string
): Promise<PerceptPixelUploadResult> {
  if (!(ALLOWED_TYPES as readonly string[]).includes(contentType)) {
    throw new Error(`Unsupported type: ${contentType}. Use JPEG, PNG, or PDF.`);
  }
  if (fileData.byteLength > PP_MAX_BYTES) {
    throw new Error(`File too large (max ${PP_MAX_BYTES / 1024 / 1024} MB).`);
  }

  // IMPORTANT: do NOT pass a `folder` field here. We tested it; PerceptPixel
  // accepts the parameter happily but routes the resulting media into a
  // folder-scoped namespace that is NOT addressable by /v1/media/<uid>.
  // Both GET (view) and POST (annotations) return 404 for those uids.
  // Solution: upload to root (file becomes queryable), tag, THEN call
  // moveMediaToFolder() to relocate. See route.ts for the orchestration.
  //
  // Node 18+ FormData accepts Blob. Pass the ArrayBuffer directly — it's
  // unambiguously a BlobPart in TS's BlobPart union (ArrayBuffer is one of
  // the valid options). Going via Uint8Array<ArrayBufferLike> trips strict
  // typing because of the SharedArrayBuffer corner case in the generic
  // default.
  const form = new FormData();
  form.append("file", new Blob([fileData], { type: contentType }), filename);
  form.append("name", filename);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    // Don't set Content-Type manually here — fetch will set the correct
    // multipart/form-data; boundary=... header automatically when body is
    // a FormData. Setting it manually clobbers the boundary and breaks parsing.
    headers: { Authorization: `Api-Key ${API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(
      `PerceptPixel upload failed: ${res.status} ${await res.text()}`
    );
  }

  const json = (await res.json()) as Record<string, unknown>;
  // Defensive: response shape per docs has cdn_url + uid; check both exist.
  if (typeof json?.cdn_url !== "string" || typeof json?.uid !== "string") {
    throw new Error(
      `PerceptPixel response missing cdn_url or uid: ${JSON.stringify(json).slice(0, 200)}`
    );
  }

  return {
    cdn_url: json.cdn_url,
    uid: json.uid,
    width: typeof json.width === "number" ? json.width : undefined,
    height: typeof json.height === "number" ? json.height : undefined,
  };
}

// === Annotations (tags + captions) ===
//
// PerceptPixel calls them "annotations" — tags AND captions in one schema.
// Tags are NOT plain strings; they're `{name: string, confidence: number}`
// objects. Confidence is 1.0 for human-set tags, < 1.0 for AI-suggested ones.
//
// API: POST https://api.perceptpixel.com/v1/media/<uid>/annotations
//   Body (all fields optional — partial update):
//     { tags?: [{name, confidence}, ...], captions?: [{text, confidence}, ...] }
//   Omitted fields → existing values retained.
//   Empty array → field cleared.
//
// Source: https://perceptpixel.com/docs/api/media/update-annotations

const ANNOTATIONS_URL = (uid: string) =>
  `https://api.perceptpixel.com/v1/media/${encodeURIComponent(uid)}/annotations`;

export type PerceptPixelTag = { name: string; confidence: number };
export type PerceptPixelCaption = { text: string; confidence: number };
export type PerceptPixelAnnotations = {
  tags?: PerceptPixelTag[];
  captions?: PerceptPixelCaption[];
};

export async function addAnnotationsToMedia(
  uid: string,
  annotations: PerceptPixelAnnotations
): Promise<void> {
  // Retry on 404. PerceptPixel returns "No Media matches the given query"
  // immediately after an upload while the media is still being indexed by
  // their backend — especially noticeable when files land in a folder
  // (folder assignment adds a step before the uid becomes queryable).
  // Other status codes (401, 400, 500, etc.) won't improve with retry, so
  // we break out on those.
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [0, 500, 1000]; // before attempts 1, 2, 3

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt - 1] > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]));
    }

    const res = await fetch(ANNOTATIONS_URL(uid), {
      method: "POST",
      headers: {
        Authorization: `Api-Key ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(annotations),
    });

    if (res.ok) return; // success; response body is the updated annotations,
                        // not needed for fire-and-forget tagging.

    const status = res.status;
    const body = await res.text();
    lastError = new Error(
      `PerceptPixel annotations update failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${status} ${body}`
    );
    if (status !== 404) break; // permanent failure, no point retrying
  }

  throw lastError ?? new Error("PerceptPixel annotations update failed: unknown");
}

// === Move (relocate to a folder) ===
//
// API: PUT https://api.perceptpixel.com/v1/media/<uid>/move
//   Body: form-urlencoded `folder_name=<name>` (NOT JSON — see curl in docs)
//   Auto-creates the folder if it doesn't exist.
//   200 → {"status": "success"}
//
// Used after upload + tagging to relocate the file into its destination
// folder. Done in this order because folder-scoped media isn't addressable
// by /v1/media/<uid> for tagging — see the comment in uploadToPerceptPixel.
//
// Source: https://perceptpixel.com/docs/api/media/move-files

const MOVE_URL = (uid: string) =>
  `https://api.perceptpixel.com/v1/media/${encodeURIComponent(uid)}/move`;

export async function moveMediaToFolder(
  uid: string,
  folderName: string
): Promise<void> {
  // Same retry-on-404 indexing-race pattern as addAnnotationsToMedia. The
  // move endpoint also looks up media by uid, so it can race the same way.
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [0, 500, 1000];

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt - 1] > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]));
    }

    const res = await fetch(MOVE_URL(uid), {
      method: "PUT",
      headers: {
        Authorization: `Api-Key ${API_KEY}`,
        // Don't set Content-Type explicitly — URLSearchParams as body
        // auto-sets application/x-www-form-urlencoded which is what
        // PerceptPixel expects (per the curl example in their docs).
      },
      body: new URLSearchParams({ folder_name: folderName }),
    });

    if (res.ok) return;

    const status = res.status;
    const body = await res.text();
    lastError = new Error(
      `PerceptPixel move failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${status} ${body}`
    );
    if (status !== 404) break;
  }

  throw lastError ?? new Error("PerceptPixel move failed: unknown");
}

// === Delete ===
//
// API: DELETE https://api.perceptpixel.com/v1/media/<uid>
//
// Used by deleteWorker (V0.3 mid-flight) to clean up the PerceptPixel file
// when its owning worker row is removed from NCB. Best-effort: callers
// catch and log on failure rather than blocking the local delete.
//
// FOLDER GOTCHA (discovered V0.3 mid-flight, mirror of the upload-side
// folder gotcha documented in PERCEPTPIXEL_NOTES.md): PerceptPixel's
// DELETE endpoint returns 200 on foldered files but only removes the
// metadata link — the underlying file stays in the dashboard's folder
// view. The fix is symmetric with the upload sequence: move-to-root
// FIRST so the file is back in the standard uid namespace, THEN DELETE.
//
// Why move-to-root before delete:
//   upload  : root → tag → move-to-folder      (uid addressable in root for tag)
//   delete  : move-to-root → DELETE            (uid addressable in root for delete)
//
// The move call is best-effort. If it fails (network blip, rate limit),
// we still attempt DELETE — worst case the file stays as an orphan and
// the logs surface the cause. 200 and 404 on DELETE are both success;
// anything else throws so the caller can decide.

const DELETE_URL = (uid: string) =>
  `https://api.perceptpixel.com/v1/media/${encodeURIComponent(uid)}`;

export async function deletePerceptPixelMedia(uid: string): Promise<void> {
  const apiKey = process.env.PERCEPTPIXEL_API_KEY;
  if (!apiKey) {
    throw new Error("PERCEPTPIXEL_API_KEY missing");
  }

  // Step 1: move-to-root (best-effort). folder_name="" is the empirically
  // observed convention; if PerceptPixel rejects it the DELETE attempt below
  // still runs.
  try {
    const moveRes = await fetch(MOVE_URL(uid), {
      method: "PUT",
      headers: { Authorization: `Api-Key ${apiKey}` },
      body: new URLSearchParams({ folder_name: "" }),
    });
    if (!moveRes.ok) {
      const body = await moveRes.text();
      console.warn(
        `[deletePerceptPixelMedia ${uid}] move-to-root non-ok ${moveRes.status}: ${body.slice(0, 200)} (continuing to DELETE anyway)`
      );
    }
  } catch (err) {
    console.warn(
      `[deletePerceptPixelMedia ${uid}] move-to-root threw (continuing to DELETE anyway):`,
      err
    );
  }

  // Step 2: DELETE.
  const res = await fetch(DELETE_URL(uid), {
    method: "DELETE",
    headers: { Authorization: `Api-Key ${apiKey}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `PerceptPixel DELETE /v1/media/${uid} failed: ${res.status} ${await res.text()}`
    );
  }
}
