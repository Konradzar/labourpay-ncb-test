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
  PP_MAX_BYTES,
} from "@/lib/perceptpixel-utils";

// Tag every image uploaded via this workers-specific route with "worker"
// AND store it in the "Workers" folder on PerceptPixel. If/when we add other
// table-specific upload routes (projects, etc.), each route applies its own
// tag and folder. Hard-coded here rather than passed from the client so the
// client can't lie about which table the upload belongs to.
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
    const result = await uploadToPerceptPixel(
      arrayBuffer,
      filename,
      contentType,
      WORKERS_FOLDER
    );

    // Auto-tag the uploaded media with "worker". This is fire-and-forget by
    // design: if tagging fails (transient network blip, PerceptPixel hiccup),
    // the image is already up and usable — failing the whole request would
    // be the wrong tradeoff. Log so trends are visible in the dev server log.
    try {
      await addAnnotationsToMedia(result.uid, { tags: [WORKERS_TAG] });
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
