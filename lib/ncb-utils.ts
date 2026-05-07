// lib/ncb-utils.ts
//
// Server-side helpers for talking to NoCodeBackend (NCB).
// Source: NCB's `get_integration_prompts` MCP tool — kept as-is so future
// upgrades can be done by re-fetching from NCB.
//
// IMPORTANT: All env vars referenced here are server-only. NEVER prefix any
// of these with NEXT_PUBLIC_ — that would expose them to the browser bundle.

import { NextRequest, NextResponse } from "next/server";

// === Configuration loaded from env vars ===
// Server-only. Read from process.env at module load.
export const CONFIG = {
  instance: process.env.NCB_INSTANCE!,
  dataApiUrl: process.env.NCB_DATA_API_URL!,
  authApiUrl: process.env.NCB_AUTH_API_URL!,
  appUrl: process.env.NCB_APP_URL || "https://app.nocodebackend.com",
};

// Fail loudly at module load if any required NCB env var is missing. Without
// this, calls to NCB silently produce URLs containing literal "undefined" and
// fail with confusing 4xx errors at request time. With this, `next dev`
// startup throws a clear message pointing at .env.local.
if (!CONFIG.instance || !CONFIG.dataApiUrl || !CONFIG.authApiUrl) {
  throw new Error(
    "Missing required NCB env vars. Required: NCB_INSTANCE, NCB_DATA_API_URL, " +
      "NCB_AUTH_API_URL. Check .env.local against .env.local.example."
  );
}

// === Cookie helpers ===
// NCB uses Better Auth, which stores session info in cookies named
// "better-auth.session_token" and "better-auth.session_data".
// extractAuthCookies pulls JUST those two from a full Cookie header,
// so we don't accidentally forward unrelated cookies to NCB.
export function extractAuthCookies(cookieHeader: string): string {
  if (!cookieHeader) return "";
  const cookies = cookieHeader.split(";");
  const authCookies: string[] = [];
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (
      trimmed.startsWith("better-auth.session_token=") ||
      trimmed.startsWith("better-auth.session_data=")
    ) {
      authCookies.push(trimmed);
    }
  }
  return authCookies.join("; ");
}

// === Session lookup ===
// Calls NCB's /get-session with the user's auth cookies. Returns the user
// object if a valid session exists, otherwise null. Used by the AUTHENTICATED
// data proxy (not by the public route, which is anonymous).
export async function getSessionUser(
  cookieHeader: string
): Promise<{ id: string } | null> {
  const authCookies = extractAuthCookies(cookieHeader);
  if (!authCookies) return null;

  const url = `${CONFIG.authApiUrl}/get-session?Instance=${CONFIG.instance}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Database-Instance": CONFIG.instance,
      "Cookie": authCookies,
    },
  });

  if (res.ok) {
    const data = await res.json();
    return data.user || null;
  }
  return null;
}

// === Authenticated proxy ===
// Forwards a request to NCB's data API WITH auth cookies. Used by the
// session-required /api/data/[...path] route (not used in V0).
export async function proxyToNCB(
  req: NextRequest,
  path: string,
  body?: string
) {
  const searchParams = new URLSearchParams();
  searchParams.set("Instance", CONFIG.instance);
  // Pass through any other query params from the original request
  req.nextUrl.searchParams.forEach((val, key) => {
    if (key !== "Instance") searchParams.append(key, val);
  });

  const url = `${CONFIG.dataApiUrl}/${path}?${searchParams.toString()}`;
  const origin = req.headers.get("origin") || req.nextUrl.origin;
  const cookieHeader = req.headers.get("cookie") || "";
  const authCookies = extractAuthCookies(cookieHeader);

  const res = await fetch(url, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      "X-Database-Instance": CONFIG.instance,
      "Cookie": authCookies,
      "Origin": origin,
    },
    body: body || undefined,
  });

  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

// === Public proxy ===
// Forwards a request to NCB's data API WITHOUT auth cookies. Used by the
// anonymous /api/public-data/[...path] route. NCB enforces public-policy
// access at its end via ncba_rls_config.
export async function proxyToNCBPublic(
  req: NextRequest,
  path: string,
  body?: string
) {
  const searchParams = new URLSearchParams();
  searchParams.set("Instance", CONFIG.instance);
  req.nextUrl.searchParams.forEach((val, key) => {
    if (key !== "Instance") searchParams.append(key, val);
  });

  const url = `${CONFIG.dataApiUrl}/${path}?${searchParams.toString()}`;
  const origin = req.headers.get("origin") || req.nextUrl.origin;

  const res = await fetch(url, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      "X-Database-Instance": CONFIG.instance,
      "Origin": origin,
      // NO cookies forwarded — anonymous request
    },
    body: body || undefined,
  });

  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

// === RLS policy cache ===
// The public route checks each table's RLS policy before serving data.
// Policies are stored in NCB's ncba_rls_config table and exposed via
// /api/public/rls-policies. We cache for 60 seconds to avoid hammering
// that endpoint on every request.
type RlsPolicies = Record<string, string>;
let cachedPolicies: RlsPolicies | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 60_000; // 1 minute

export async function getRlsPolicies(): Promise<RlsPolicies> {
  const now = Date.now();
  if (cachedPolicies && now < cacheExpiry) return cachedPolicies;

  try {
    const url = `${CONFIG.appUrl}/api/public/rls-policies?instance=${CONFIG.instance}`;
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      cachedPolicies = (data.policies || {}) as RlsPolicies;
      cacheExpiry = now + CACHE_TTL;
      return cachedPolicies;
    }
  } catch {
    // Network error — fall through to whatever we have cached, or {} if nothing
  }
  return cachedPolicies || {};
}

// === Path parsing ===
// NCB's URL pattern is /<verb>/<table>[/<id>], e.g. /read/workers, /create/workers.
// segments[0] is the verb (read/create/update/delete), segments[1] is the table.
export function extractTableFromPath(pathStr: string): string {
  const segments = pathStr.split("/");
  return segments[1] || "";
}

// === Policy parsing ===
// Policies can be combined as comma-separated values, e.g.
// "shared_read,public_scoped_read". This splits and trims them.
function parsePolicies(policy?: string): string[] {
  if (!policy) return [];
  return policy
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

// Does this policy allow anonymous reads?
export function allowsPublicRead(policy?: string): boolean {
  const parts = parsePolicies(policy);
  return parts.some((p) =>
    [
      "public_read",
      "public_readwrite",
      "public_scoped_read",
      "public_scoped_readwrite",
    ].includes(p)
  );
}

// Does this policy allow anonymous writes (creates)?
export function allowsPublicWrite(policy?: string): boolean {
  const parts = parsePolicies(policy);
  return parts.some((p) =>
    [
      "public_write",
      "public_readwrite",
      "public_scoped_write",
      "public_scoped_readwrite",
    ].includes(p)
  );
}

// Does this policy require an owner_id (scoped public access)?
export function requiresOwnerScope(policy?: string): boolean {
  const parts = parsePolicies(policy);
  return parts.some((p) =>
    ["public_scoped_read", "public_scoped_write", "public_scoped_readwrite"].includes(p)
  );
}
