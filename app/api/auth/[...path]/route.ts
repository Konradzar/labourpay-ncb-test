// app/api/auth/[...path]/route.ts
//
// Catch-all auth proxy. Forwards every /api/auth/<sub-path> request to
// NCB's user-auth API at ${NCB_AUTH_API_URL}/<sub-path> with cookie
// transformation:
//   - Receiving (Set-Cookie from NCB): strip `__Secure-` and `__Host-`
//     prefixes (browsers reject them on localhost), strip Domain attribute
//     and Secure flag, set SameSite=Lax.
//   - Forwarding (Cookie to NCB): extract just the better-auth.session_token
//     and better-auth.session_data cookies; send them as-is (NCB accepts
//     both prefixed and unprefixed forms).
//
// All HTTP methods are forwarded unchanged. Body is forwarded as raw text
// (so JSON, form-urlencoded, etc. all work).

import { NextRequest, NextResponse } from "next/server";
import { CONFIG, extractAuthCookies } from "@/lib/ncb-utils";

async function proxy(req: NextRequest, params: { path: string[] }) {
  const pathSuffix = "/" + params.path.join("/");
  const url = `${CONFIG.authApiUrl}${pathSuffix}?Instance=${CONFIG.instance}`;

  const cookieHeader = req.headers.get("cookie") ?? "";
  const sessionCookies = extractAuthCookies(cookieHeader);

  const init: RequestInit = {
    method: req.method,
    headers: {
      "Content-Type": req.headers.get("content-type") ?? "application/json",
      "X-Database-Instance": CONFIG.instance,
      ...(sessionCookies && { Cookie: sessionCookies }),
    },
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  const ncbRes = await fetch(url, init);

  // Forward response, transforming Set-Cookie headers for localhost compat.
  const response = new NextResponse(await ncbRes.text(), {
    status: ncbRes.status,
    headers: {
      "Content-Type": ncbRes.headers.get("content-type") ?? "application/json",
    },
  });

  const setCookieHeaders = ncbRes.headers.getSetCookie?.() ?? [];
  for (const raw of setCookieHeaders) {
    const transformed = raw
      .replace(/^__Secure-/, "")
      .replace(/^__Host-/, "")
      .replace(/;\s*Domain=[^;]*/i, "")
      .replace(/;\s*Secure(?=[;\s]|$)/i, "")
      .replace(/;\s*SameSite=[^;]*/i, "; SameSite=Lax");
    response.headers.append("Set-Cookie", transformed);
  }

  return response;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) { return proxy(req, await params); }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) { return proxy(req, await params); }

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) { return proxy(req, await params); }

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) { return proxy(req, await params); }
