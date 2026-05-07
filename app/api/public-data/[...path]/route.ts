// app/api/public-data/[...path]/route.ts
//
// Anonymous proxy to NCB's data API. The browser calls /api/public-data/...
// (no session required); we forward to NCB's data API after checking the
// table's RLS policy permits public access. NCB also enforces this at its
// end — our local check is a fast-fail before the network round-trip.
//
// Supported operations:
//   GET    /api/public-data/read/<table>          — list rows
//   GET    /api/public-data/read/<table>/<id>     — get one row
//   POST   /api/public-data/create/<table>        — create a row
// PUT and DELETE are NOT supported on the public route (security).

import { NextRequest, NextResponse } from "next/server";
import {
  proxyToNCBPublic,
  getRlsPolicies,
  extractTableFromPath,
  allowsPublicRead,
  allowsPublicWrite,
  requiresOwnerScope,
} from "@/lib/ncb-utils";

const json = (body: object, status = 200) =>
  new NextResponse(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Top-level try/catch: turns any upstream/network failure into a clean 502
  // instead of leaking a Node stack trace to the browser via Next.js's default
  // 500 response.
  try {
    const { path } = await params;
    const pathStr = path.join("/");
    const table = extractTableFromPath(pathStr);
    if (!table) return json({ error: "Invalid path" }, 400);

    const policies = await getRlsPolicies();
    const policy = policies[table];
    if (!allowsPublicRead(policy)) {
      return json(
        { error: "This table does not allow public read access" },
        403
      );
    }

    if (requiresOwnerScope(policy)) {
      const ownerId = req.nextUrl.searchParams.get("owner_id");
      if (!ownerId) {
        return json(
          { error: "owner_id query parameter is required for this table" },
          400
        );
      }
    }

    return proxyToNCBPublic(req, pathStr);
  } catch {
    return json({ error: "Upstream unavailable" }, 502);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Top-level try/catch: turns any upstream/network failure into a clean 502
  // instead of leaking a Node stack trace to the browser via Next.js's default
  // 500 response.
  try {
    const { path } = await params;
    const pathStr = path.join("/");
    const table = extractTableFromPath(pathStr);
    const body = await req.text();

    if (!table) return json({ error: "Invalid path" }, 400);
    if (!pathStr.startsWith("create/")) {
      return json(
        { error: "Public route only allows create operations" },
        403
      );
    }

    const policies = await getRlsPolicies();
    const policy = policies[table];
    if (!allowsPublicWrite(policy)) {
      return json(
        { error: "This table does not allow public write access" },
        403
      );
    }

    // Scoped writes: owner_id must come from the body and gets re-mapped to user_id.
    // This branch is the FIRST gate when requiresOwnerScope is true — it must reject
    // an empty body (otherwise an empty-body POST would fall through to the unscoped
    // branch and bypass the owner_id requirement).
    if (requiresOwnerScope(policy)) {
      if (!body) {
        return json(
          { error: "owner_id is required in the body for this table" },
          400
        );
      }
      try {
        const parsed = JSON.parse(body);
        const ownerId = parsed.owner_id;
        if (!ownerId) {
          return json(
            { error: "owner_id is required in the body for this table" },
            400
          );
        }
        delete parsed.owner_id;
        delete parsed.user_id;
        parsed.user_id = ownerId;
        return proxyToNCBPublic(req, pathStr, JSON.stringify(parsed));
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }
    }

    // Unscoped writes: strip user_id and owner_id from client payload (defense
    // in depth — client must not control these).
    if (body) {
      try {
        const parsed = JSON.parse(body);
        delete parsed.user_id;
        delete parsed.owner_id;
        return proxyToNCBPublic(req, pathStr, JSON.stringify(parsed));
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }
    }

    return proxyToNCBPublic(req, pathStr, body);
  } catch {
    return json({ error: "Upstream unavailable" }, 502);
  }
}

// Public route deliberately does NOT export PUT or DELETE.
