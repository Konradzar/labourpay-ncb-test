// lib/s3-utils.ts
//
// Server-side helpers for AWS S3.
// Generates short-lived presigned URLs — AWS keys never leave the server.
// Browser calls /api/upload-url to get a presigned PUT URL, then uploads the
// file directly to S3 using that URL.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

// V0.3 — env var names use the APP_AWS_ prefix instead of the standard
// AWS_ prefix because Netlify *reserves* AWS_REGION/AWS_ACCESS_KEY_ID/
// AWS_SECRET_ACCESS_KEY for its own Lambda runtime integration and refuses
// to let you set them at the project level. Keeping the prefix consistent
// across local dev and prod avoids a Netlify-only branch in the code.
//
// Side benefit: the AWS SDK's default credential chain WILL NOT pick these
// up automatically (it looks for AWS_*), so we have to pass them explicitly
// to the S3Client constructor below — which is good, because it makes it
// clear these are app-specific S3 credentials, not whatever ambient AWS
// identity might be available in the runtime environment.
const S3_REGION = process.env.APP_AWS_REGION!;
const S3_BUCKET = process.env.S3_BUCKET_NAME!;
const S3_ACCESS_KEY = process.env.APP_AWS_ACCESS_KEY_ID!;
const S3_SECRET_KEY = process.env.APP_AWS_SECRET_ACCESS_KEY!;

// Fail loudly at module load if any S3 env var is missing. Without this, the
// first S3 SDK call would throw a confusing "credential object is not valid"
// error; with this, `next dev` startup fails immediately with a clear message
// pointing at .env.local.
if (!S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  throw new Error(
    "Missing S3 env vars. Required: APP_AWS_REGION, S3_BUCKET_NAME, " +
      "APP_AWS_ACCESS_KEY_ID, APP_AWS_SECRET_ACCESS_KEY. " +
      "Check .env.local against .env.local.example."
  );
}

// Single shared S3 client — created at module load.
const s3 = new S3Client({
  region: S3_REGION,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  // Restore pre-SDK-3.729 behaviour: don't bake CRC32 of empty content into
  // presigned URLs. Without this, presigned PUTs fail with
  // SignatureDoesNotMatch because the signed URL embeds an empty-body
  // checksum but the actual upload has bytes. See aws/aws-sdk-js-v3 issues
  // tracker for the megathread.
  requestChecksumCalculation: "WHEN_REQUIRED",
});

// File-type allowlist. Maps MIME type → file extension we use for the S3 key.
// Both photo and ID-doc fields accept the same three formats.
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

// 5 MB upload size limit (matches the existing Flatlogic app's WorkerForm).
export const MAX_BYTES = 5 * 1024 * 1024;

// Normalise a Content-Type header for allowlist lookup: lowercase + strip
// any RFC-6838 parameters (e.g. "image/jpeg; charset=binary"). Browsers
// generally send bare "image/jpeg" via <input type="file">, but non-browser
// clients (curl, etc.) sometimes attach parameters. Normalising once keeps
// the signed URL's Content-Type identical to what S3 will see at PUT time.
function normalizeContentType(contentType: string): string {
  return contentType.toLowerCase().split(";")[0].trim();
}

// === UPLOADS ===
// Generates a presigned PUT URL plus the object key.
// Browser PUTs the file directly to the URL, then sends `key` to the data proxy
// when saving the row to NCB.
export async function makeUploadUrl(opts: {
  contentType: string;
}): Promise<{ url: string; key: string }> {
  const normalized = normalizeContentType(opts.contentType);
  const ext = ALLOWED_TYPES[normalized];
  if (!ext) {
    throw new Error(`Unsupported content type: ${opts.contentType}`);
  }

  const key = `workers/${randomUUID()}.${ext}`;
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: normalized, // sign with the normalised value so PUT matches
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 minutes
  return { url, key };
}

// === DOWNLOADS ===
// Generates a presigned GET URL for an object key. Used by detail pages
// to render <img src=...> and <a href=...> for stored files.
export async function makeDownloadUrl(key: string): Promise<string> {
  if (!key) return "";
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 minutes
}

// Exposed for the API route to do its own type check before calling
// makeUploadUrl. Keeps the route's error message richer than just
// re-throwing makeUploadUrl's error. Normalises the input the same way
// makeUploadUrl does, so the two stay in lockstep.
export function isAllowedContentType(contentType: string): boolean {
  return normalizeContentType(contentType) in ALLOWED_TYPES;
}
