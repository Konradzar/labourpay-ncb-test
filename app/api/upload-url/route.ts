// app/api/upload-url/route.ts
//
// Browser POSTs { contentType: "image/jpeg" | "image/png" | "application/pdf" }
// and gets back { url, key }. Browser then PUTs the file directly to `url`.
// AWS keys never leave the server — they're used only inside lib/s3-utils.ts.

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { makeUploadUrl, isAllowedContentType } from "@/lib/s3-utils";
import { getSessionUser } from "@/lib/ncb-utils";

export async function POST(req: NextRequest) {
  // V0.3 — gate on session. Anonymous callers get 401 so the public URL
  // can't be used as a free S3-key minter.
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const user = await getSessionUser(cookieHeader);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { contentType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.contentType) {
    return NextResponse.json({ error: "contentType required" }, { status: 400 });
  }

  if (!isAllowedContentType(body.contentType)) {
    return NextResponse.json(
      { error: `Unsupported content type. Allowed: image/jpeg, image/png, application/pdf` },
      { status: 400 }
    );
  }

  try {
    const { url, key } = await makeUploadUrl({ contentType: body.contentType });
    return NextResponse.json({ url, key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `S3 presign failed: ${msg}` }, { status: 502 });
  }
}
