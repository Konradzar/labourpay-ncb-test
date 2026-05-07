// lib/s3-utils.ts
//
// Server-side helpers for AWS S3.
// Generates short-lived presigned URLs — AWS keys never leave the server.
// Browser calls /api/upload-url to get a presigned PUT URL, then uploads the
// file directly to S3 using that URL.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const S3_REGION = process.env.AWS_REGION!;
const S3_BUCKET = process.env.S3_BUCKET_NAME!;
const S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID!;
const S3_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY!;

// Single shared S3 client — created at module load.
const s3 = new S3Client({
  region: S3_REGION,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
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

// === UPLOADS ===
// Generates a presigned PUT URL plus the object key.
// Browser PUTs the file directly to the URL, then sends `key` to the data proxy
// when saving the row to NCB.
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
// re-throwing makeUploadUrl's error.
export function isAllowedContentType(contentType: string): boolean {
  return contentType in ALLOWED_TYPES;
}
