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
