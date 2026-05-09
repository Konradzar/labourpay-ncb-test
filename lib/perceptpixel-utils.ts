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

// V0.3 — the single PerceptPixel folder this app uses for worker images.
// Exported so the upload route, the delete helper, and any future caller
// agree on the same string. If you ever add a second folder (e.g. a
// "Projects" folder), parameterise the call sites instead of duplicating
// this constant.
export const WORKERS_FOLDER = "Workers";

export type PerceptPixelUploadResult = {
  cdn_url: string;
  uid: string;
  width?: number;
  height?: number;
};

export async function uploadToPerceptPixel(
  fileData: ArrayBuffer,
  filename: string,
  contentType: string,
  folderName?: string
): Promise<PerceptPixelUploadResult> {
  if (!(ALLOWED_TYPES as readonly string[]).includes(contentType)) {
    throw new Error(`Unsupported type: ${contentType}. Use JPEG, PNG, or PDF.`);
  }
  if (fileData.byteLength > PP_MAX_BYTES) {
    throw new Error(`File too large (max ${PP_MAX_BYTES / 1024 / 1024} MB).`);
  }

  // V0.3 update — passing `folder` IS safe, despite what V0.1.5 tried to do.
  // The V0.1.5 notes said "uid 404s after folder upload" because we tried
  // standard `/v1/media/<uid>` calls. Konrad's NativeRest testing established
  // that all uid endpoints accept `?folder_name=<folder>` to re-scope into
  // the folder namespace. So uploading directly to the destination folder is
  // fine, as long as subsequent annotation/delete calls pass `?folder_name=`.
  // See docs/PERCEPTPIXEL_NOTES.md for the full story.
  //
  // Node 18+ FormData accepts Blob. Pass the ArrayBuffer directly — it's
  // unambiguously a BlobPart in TS's BlobPart union (ArrayBuffer is one of
  // the valid options). Going via Uint8Array<ArrayBufferLike> trips strict
  // typing because of the SharedArrayBuffer corner case in the generic
  // default.
  const form = new FormData();
  form.append("file", new Blob([fileData], { type: contentType }), filename);
  form.append("name", filename);
  if (folderName) {
    form.append("folder", folderName);
  }

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
// API: POST https://api.perceptpixel.com/v1/media/<uid>/annotations[?folder_name=<folder>]
//   Body (all fields optional — partial update):
//     { tags?: [{name, confidence}, ...], captions?: [{text, confidence}, ...] }
//   Omitted fields → existing values retained.
//   Empty array → field cleared.
//
// Folder rule (V0.3, undocumented in PP's public docs but verified): if the
// uid lives inside a folder, you MUST append `?folder_name=<folder>` to the
// URL or the call returns 404. Pass `folderName` here for foldered uids;
// omit it for root-level files.
//
// Source: https://perceptpixel.com/docs/api/media/update-annotations

const ANNOTATIONS_URL = (uid: string, folderName?: string) => {
  const base = `https://api.perceptpixel.com/v1/media/${encodeURIComponent(uid)}/annotations`;
  return folderName
    ? `${base}?folder_name=${encodeURIComponent(folderName)}`
    : base;
};

export type PerceptPixelTag = { name: string; confidence: number };
export type PerceptPixelCaption = { text: string; confidence: number };
export type PerceptPixelAnnotations = {
  tags?: PerceptPixelTag[];
  captions?: PerceptPixelCaption[];
};

export async function addAnnotationsToMedia(
  uid: string,
  annotations: PerceptPixelAnnotations,
  folderName?: string
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

    const res = await fetch(ANNOTATIONS_URL(uid, folderName), {
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

// === Delete ===
//
// API: DELETE https://api.perceptpixel.com/v1/media/<uid>?folder_name=<folder>
//
// Used by deleteWorker (V0.3 mid-flight) to clean up the PerceptPixel file
// when its owning worker row is removed from NCB. Best-effort: callers
// catch and log on failure rather than blocking the local delete.
//
// FOLDER GOTCHA (V0.3 mid-flight, undocumented in PerceptPixel's public
// docs): foldered files live in a separate uid namespace. Without
// `?folder_name=<folder>` the DELETE returns 404 (and our catch silently
// treats 404 as "already gone" → file lingers in PP). Passing the folder
// name as a QUERY PARAMETER scopes the lookup correctly. PerceptPixel
// returns 204 No Content on success.
//
// Folder is hardcoded to WORKERS_FOLDER because that's the only folder
// this app uploads to. If we ever add a second folder, parameterise
// this helper (or read the folder from the cdn_url path).
//
// Status semantics:
//   200, 204 → success (DELETE actually removed the file)
//   404      → success (file already gone, e.g. concurrent delete)
//   anything else → throw so the caller can log + continue

const DELETE_URL = (uid: string) =>
  `https://api.perceptpixel.com/v1/media/${encodeURIComponent(uid)}?folder_name=${encodeURIComponent(WORKERS_FOLDER)}`;

export async function deletePerceptPixelMedia(uid: string): Promise<void> {
  const apiKey = process.env.PERCEPTPIXEL_API_KEY;
  if (!apiKey) {
    throw new Error("PERCEPTPIXEL_API_KEY missing");
  }

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
