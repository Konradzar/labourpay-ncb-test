// app/page.tsx
//
// Workers list — Server Component (no "use client"). Fetches the workers
// list directly from NCB at request time and renders as a simple table.
//
// Why direct NCB fetch (not /api/public-data/ proxy): Server Components
// run server-side and can't use relative URLs. Calling NCB directly is
// straightforward and avoids a self-fetch detour. NCB's server-side
// policy check enforces RLS regardless. The /api/public-data/ proxy is
// for browser code (Task 9's form).

import Link from "next/link";
import { CONFIG } from "@/lib/ncb-utils";
import type { Worker, NCBListResponse } from "@/lib/types";

async function fetchWorkers(): Promise<Worker[]> {
  // CONFIG is validated at module load in lib/ncb-utils.ts — if any required
  // env var is missing, that import would already have thrown at startup.
  //
  // `limit=200` because NCB's list endpoint defaults to `limit=10` when no
  // limit is given — the 11th-onward workers get silently dropped. 200 is a
  // generous cap for V0 scale (you, in dev, with tens of workers); when the
  // list ever grows toward 200 we'll want real pagination + search anyway.
  const url = `${CONFIG.dataApiUrl}/read/workers?Instance=${CONFIG.instance}&limit=200`;
  const res = await fetch(url, { cache: "no-store" });
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
                  <Link href={`/workers/${w.id}`} style={{ color: "#1a73e8", textDecoration: "none" }}>
                    {w.name}
                  </Link>
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
