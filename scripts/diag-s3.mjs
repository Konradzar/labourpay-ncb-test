// scripts/diag-s3.mjs — one-shot S3 credential check.
// Calls ListObjectsV2 directly (no presigning) to verify creds work.

import { S3Client, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "fs";
import { join } from "path";

// Manual .env.local parse (don't pull in dotenv just for this)
const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const accessKeyId = env.AWS_ACCESS_KEY_ID || "";
const secretAccessKey = env.AWS_SECRET_ACCESS_KEY || "";

// Sanity-check format BEFORE making AWS calls — surfaces typos cheaply.
console.log("AWS_ACCESS_KEY_ID length:", accessKeyId.length, "(expected 20)");
console.log("AWS_ACCESS_KEY_ID prefix:", accessKeyId.slice(0, 4), "(expected AKIA)");
console.log("AWS_SECRET_ACCESS_KEY length:", secretAccessKey.length, "(expected 40)");
console.log("AWS_REGION:", env.AWS_REGION);
console.log("S3_BUCKET_NAME:", env.S3_BUCKET_NAME);
console.log();

if (accessKeyId.length !== 20) {
  console.error("STOP: Access key ID is not 20 characters. Likely a paste error.");
  process.exit(1);
}
if (!accessKeyId.startsWith("AKIA")) {
  console.error("STOP: Access key ID does not start with AKIA. Likely a paste error.");
  process.exit(1);
}
if (secretAccessKey.length !== 40) {
  console.error("STOP: Secret access key is not 40 characters. Likely a paste error or trailing whitespace.");
  process.exit(1);
}

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: { accessKeyId, secretAccessKey },
});

console.log("Calling ListObjectsV2 directly (no presigning)...");
let listOk = false;
try {
  const out = await s3.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET_NAME, MaxKeys: 5 }));
  console.log("OK ListObjectsV2 succeeded. Bucket has", out.Contents?.length || 0, "keys.");
  console.log("   -> Credentials are VALID for non-presigned operations.");
  console.log("   -> If presigning is failing, the issue is presigning-specific.");
  listOk = true;
} catch (err) {
  console.error("FAIL ListObjectsV2 failed:", err.name, "-", err.message);
  console.error("   -> Credentials FAIL even for direct SDK calls.");
  console.error("   -> This strongly suggests the keys in .env.local are wrong or mismatched.");
  console.error("   -> Re-paste from NordPass and ensure both halves are from the same key pair.");
}

// If list works, also try a direct PUT to compare to the failing presigned PUT.
console.log();
console.log("Calling PutObjectCommand directly (no presigning)...");
try {
  await s3.send(new PutObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: `diag/test-${Date.now()}.txt`,
    Body: "diagnostic test",
    ContentType: "text/plain",
  }));
  console.log("OK Direct PUT succeeded. Bucket policy + IAM allow PUT.");
  console.log("   -> If presigned PUT still fails, the issue is in the presigning code path.");
} catch (err) {
  console.error("FAIL Direct PUT failed:", err.name, "-", err.message);
}

if (!listOk) process.exit(2);
