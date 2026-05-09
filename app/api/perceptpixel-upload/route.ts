// app/api/perceptpixel-upload/route.ts
//
// Server-side proxy for PerceptPixel image uploads.
//
// Browser POSTs multipart/form-data with a single 'file' field. We extract
// the file, forward to PerceptPixel's media API server-side (so the API key
// stays out of the browser bundle), and return { cdn_url, uid } to the client.
//
// On success the client stores cdn_url in form state and includes it as
// `perceptpixel_url` when invoking the createWorker Server Action.
//
// This route exists ONLY because PerceptPixel's auth (Api-Key header) cannot
// be safely used from browser JavaScript. Compare with /api/upload-url which
// returns a presigned S3 URL the browser uses to PUT directly to S3 — that
// pattern would have been preferable here too, but PerceptPixel doesn't
// support it.

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/ncb-utils";
import {
  uploadToPerceptPixel,
  addAnnotationsToMedia,
  PP_MAX_BYTES,
  WORKERS_FOLDER,
} from "@/lib/perceptpixel-utils";

// The "worker" tag applied to every PP upload from this route. Each new
// per-table upload route (projects, teams, etc.) would get its own tag
// constant. Hard-coded here, not passed from the client, so the client
// can't lie about which table the upload belongs to.
//
// V0.3 sequence: upload-directly-to-folder → tag-with-folder-context.
// (V0.1.5 had a 3-step root → tag → move sequence; we collapsed it after
// discovering PerceptPixel's `?folder_name=` query param works on all uid
// endpoints. See docs/PERCEPTPIXEL_NOTES.md.)
const WORKERS_TAG: { name: string; confidence: number } = {
  name: "worker",
  confidence: 1.0,
};

export async function POST(req: NextRequest) {
  // V0.3 — gate on session. Anonymous callers get 401 so the public URL
  // can't burn PerceptPixel quota.
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const user = await getSessionUser(cookieHeader);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart body" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      { error: "'file' field is required and must be a file" },
      { status: 400 }
    );
  }
  // Pre-check size before reading the whole body into a Buffer — saves memory
  // on the rare oversized upload.
  if (file.size > PP_MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${PP_MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    );
  }

  // Pass ArrayBuffer end-to-end (skip Buffer + Uint8Array indirection) so the
  // strict BlobPart typing inside uploadToPerceptPixel is satisfied without
  // generic-parameter narrowing tricks.
  const arrayBuffer = await file.arrayBuffer();
  // file.name is browser-supplied; default if absent. PerceptPixel uses this
  // as the filename component of the resulting cdn_url.
  const filename = (file as File).name || "upload";
  const contentType = file.type || "application/octet-stream";

  try {
    // Step 1 — upload directly into the Workers folder. PerceptPixel's
    // upload endpoint accepts a `folder` form field; the response cdn_url
    // already points at <org>/Workers/<filename>, no relocation needed.
    const result = await uploadToPerceptPixel(
      arrayBuffer,
      filename,
      contentType,
      WORKERS_FOLDER
    );

    // Step 2 — tag with "worker". Pass WORKERS_FOLDER so the annotations
    // endpoint can resolve the foldered uid (it 404s without the query
    // parameter; see docs/PERCEPTPIXEL_NOTES.md). Fire-and-forget: if
    // tagging fails, the image is already uploaded and visible in the
    // dashboard. The helper's retry-on-404 handles PP's indexing race.
    try {
      await addAnnotationsToMedia(
        result.uid,
        { tags: [WORKERS_TAG] },
        WORKERS_FOLDER
      );
    } catch (tagErr) {
      console.warn(
        `[perceptpixel-upload] auto-tag failed for uid=${result.uid}:`,
        tagErr instanceof Error ? tagErr.message : tagErr
      );
    }

    return NextResponse.json({ cdn_url: result.cdn_url, uid: result.uid });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // 502 = upstream (PerceptPixel) gave us something we couldn't translate.
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
