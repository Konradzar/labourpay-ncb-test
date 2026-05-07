// app/api/perceptpixel-upload/route.ts
//
// Server-side proxy for PerceptPixel image uploads.
//
// Browser POSTs multipart/form-data with a single 'file' field. We extract
// the file, forward to PerceptPixel's media API server-side (so the API key
// stays out of the browser bundle), and return { cdn_url, uid } to the client.
//
// On success the client stores cdn_url in form state and includes it as
// `perceptpixel_url` in the /api/public-data/create/workers POST body.
//
// This route exists ONLY because PerceptPixel's auth (Api-Key header) cannot
// be safely used from browser JavaScript. Compare with /api/upload-url which
// returns a presigned S3 URL the browser uses to PUT directly to S3 — that
// pattern would have been preferable here too, but PerceptPixel doesn't
// support it.

import { NextRequest, NextResponse } from "next/server";
import {
  uploadToPerceptPixel,
  addAnnotationsToMedia,
  moveMediaToFolder,
  PP_MAX_BYTES,
} from "@/lib/perceptpixel-utils";
import { relocateCdnUrl } from "@/lib/perceptpixel-url";

// Workers-specific post-upload metadata: tag + destination folder. Each new
// per-table upload route (projects, teams, etc.) gets its own constants.
// Hard-coded here, not passed from the client, so the client can't lie about
// which table the upload belongs to.
//
// SEQUENCE MATTERS: upload to root → tag → move. We can't upload directly
// into the folder because folder-scoped media is not addressable by
// /v1/media/<uid>, which blocks the annotation call. See the comment in
// lib/perceptpixel-utils.ts uploadToPerceptPixel for the gory detail.
const WORKERS_TAG: { name: string; confidence: number } = {
  name: "worker",
  confidence: 1.0,
};
const WORKERS_FOLDER = "Workers";

export async function POST(req: NextRequest) {
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
    // Step 1 — upload to root (no folder). Folder-scoped uploads are not
    // queryable by uid, which would break the next two steps.
    const result = await uploadToPerceptPixel(arrayBuffer, filename, contentType);

    // Step 2 — tag with "worker". Fire-and-forget: if tagging fails,
    // the image is already uploaded and usable; failing the whole request
    // would be the wrong tradeoff. The retry-on-404 inside the helper
    // already handles indexing-race transients.
    try {
      await addAnnotationsToMedia(result.uid, { tags: [WORKERS_TAG] });
    } catch (tagErr) {
      console.warn(
        `[perceptpixel-upload] auto-tag failed for uid=${result.uid}:`,
        tagErr instanceof Error ? tagErr.message : tagErr
      );
    }

    // Step 3 — move into the Workers folder. Same fire-and-forget posture:
    // if move fails, the image is uploaded + tagged but sits in the root.
    // User can manually relocate via the dashboard if it matters.
    //
    // Crucially: when move SUCCEEDS, the file is now at <org>/Workers/<filename>
    // but `result.cdn_url` from step 1 still points at <org>/<filename>. We
    // construct the post-move URL and return THAT to the browser, so the
    // value stored in NCB matches the file's actual location.
    let cdn_url = result.cdn_url;
    try {
      await moveMediaToFolder(result.uid, WORKERS_FOLDER);
      cdn_url = relocateCdnUrl(result.cdn_url, WORKERS_FOLDER);
    } catch (moveErr) {
      console.warn(
        `[perceptpixel-upload] move-to-folder failed for uid=${result.uid}:`,
        moveErr instanceof Error ? moveErr.message : moveErr
      );
      // cdn_url stays as the root-level URL — file is at root, URL matches.
    }

    return NextResponse.json({ cdn_url, uid: result.uid });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // 502 = upstream (PerceptPixel) gave us something we couldn't translate.
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
