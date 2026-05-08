// app/page.tsx
//
// Workers list — Server Component (no "use client"). Fetches the workers
// list from NCB at request time via ncbAuthFetch (Bearer + session cookies)
// and renders as a simple table.

import Link from "next/link";
import { ncbAuthFetch } from "@/lib/ncb-utils";
import { perceptpixelThumbnailUrl } from "@/lib/perceptpixel-url";
import type { Worker, NCBListResponse } from "@/lib/types";

// V0.1.5 — thumbnail size in pixels for the list-row preview. Square. 40px
// reads well in a table row without overwhelming the name column.
const THUMB_PX = 40;

async function fetchWorkers(): Promise<Worker[]> {
  // V0.3 — authenticated server-side fetch. ncbAuthFetch forwards Bearer +
  // session cookies, so this works after workers RLS flips to `private`.
  // Why &limit=200: NCB defaults to limit=10 and silently drops the rest.
  // Real pagination is V1.0.
  const res = await ncbAuthFetch(`/read/workers?limit=200`);
  if (!res.ok) {
    throw new Error(
      `NCB list workers failed: ${res.status} ${await res.text()}`
    );
  }
  const json = (await res.json()) as NCBListResponse<Worker>;
  return json.data ?? [];
}

// Format an integer rand amount as "R 1 234" (South African style — space
// thousand-separator, no decimal). NCB stored monthly_salary as INT despite
// our DECIMAL request, so values are always whole rands. See docs/NCB_NOTES.md.
function formatRand(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "R —";
  return `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

export default async function WorkersPage() {
  const workers = await fetchWorkers();

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "2rem auto",
        padding: "0 1rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Workers</h1>
        <Link
          href="/workers/new"
          style={{
            padding: "0.5rem 0.9rem",
            background: "#1a73e8",
            color: "white",
            textDecoration: "none",
            borderRadius: 6,
            fontSize: "0.95rem",
          }}
        >
          + Add Worker
        </Link>
      </header>

      {workers.length === 0 ? (
        <p style={{ color: "#666" }}>No workers yet. Click <em>+ Add Worker</em> to create one.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #333", textAlign: "left" }}>
              <th style={{ padding: "0.5rem" }}>Name</th>
              <th style={{ padding: "0.5rem", textAlign: "right" }}>Monthly salary</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} style={{ borderBottom: "1px solid #ddd" }}>
                <td style={{ padding: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    {/* Fixed-width slot keeps the Name column aligned whether
                        or not a worker has a perceptpixel_url. Workers without
                        an image render an empty same-size placeholder div. */}
                    {w.perceptpixel_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={perceptpixelThumbnailUrl(w.perceptpixel_url, THUMB_PX)}
                        alt=""
                        width={THUMB_PX}
                        height={THUMB_PX}
                        loading="lazy"
                        style={{
                          width: THUMB_PX,
                          height: THUMB_PX,
                          objectFit: "cover",
                          borderRadius: 4,
                          border: "1px solid #ddd",
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div
                        aria-hidden
                        style={{
                          width: THUMB_PX,
                          height: THUMB_PX,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <Link href={`/workers/${w.id}`} style={{ color: "#1a73e8", textDecoration: "none" }}>
                      {w.name}
                    </Link>
                  </div>
                </td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>
                  {formatRand(w.monthly_salary)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer style={{ marginTop: "2rem", fontSize: "0.85rem", color: "#888" }}>
        {workers.length} worker{workers.length === 1 ? "" : "s"}
      </footer>
    </main>
  );
}
