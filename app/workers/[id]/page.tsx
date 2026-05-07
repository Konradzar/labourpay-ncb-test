// app/workers/[id]/page.tsx
//
// Worker detail — Server Component. Fetches the worker by id from NCB,
// generates presigned download URLs for the photo + ID doc, and renders.
// 404 if NCB doesn't return a row for the id.
//
// Why direct NCB fetch (not /api/public-data/ proxy): same reason as the
// list page — Server Components can't use relative URLs cleanly. NCB enforces
// RLS server-side regardless. The public-data proxy is for browser code.

import Link from "next/link";
import { notFound } from "next/navigation";
import { CONFIG } from "@/lib/ncb-utils";
import { makeDownloadUrl } from "@/lib/s3-utils";
import type { Worker, NCBSingleResponse } from "@/lib/types";

async function fetchWorker(id: string): Promise<Worker | null> {
  // We use NCB's single-record endpoint /read/workers/<id> with the
  // NCB_SECRET_KEY as a Bearer token (server-side only — never sent to the
  // browser). The previous "list with ?id=<id> filter" workaround returned
  // 500 because NCB's list endpoint only accepts filters on the columns
  // {name, monthly_salary, photo_key, id_doc_key, user_id} — the `id`
  // primary key is NOT a filterable query param. With auth, the
  // single-record endpoint works correctly.
  const secret = process.env.NCB_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "NCB_SECRET_KEY missing — required for server-side single-record reads. " +
        "Check .env.local."
    );
  }

  const url = `${CONFIG.dataApiUrl}/read/workers/${encodeURIComponent(id)}?Instance=${CONFIG.instance}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "Authorization": `Bearer ${secret}`,
      "Content-Type": "application/json",
      "X-Database-Instance": CONFIG.instance,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `NCB get worker failed: ${res.status} ${await res.text()}`
    );
  }
  const json = (await res.json()) as NCBSingleResponse<Worker> | { data?: Worker[] };

  // NCB may return the row as `data: <object>` or `data: [<object>]`.
  // Handle both shapes defensively.
  const data = (json as { data?: unknown }).data;
  if (!data) return null;
  if (Array.isArray(data)) {
    return (data[0] as Worker) ?? null;
  }
  return data as Worker;
}

function formatRand(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "R —";
  return `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

// Treat empty string and the literal "placeholder"-looking strings the same
// as null — early test rows used placeholders before file uploads were wired.
function isUsableKey(key: string | null): key is string {
  if (!key) return false;
  if (key === "placeholder") return false;
  if (key.startsWith("placeholder.")) return false;
  return true;
}

export default async function WorkerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const worker = await fetchWorker(id);
  if (!worker) notFound();

  const photoUrl = isUsableKey(worker.photo_key) ? await makeDownloadUrl(worker.photo_key) : "";
  const idDocUrl = isUsableKey(worker.id_doc_key) ? await makeDownloadUrl(worker.id_doc_key) : "";

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "2rem auto",
        padding: "0 1rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/" style={{ color: "#1a73e8", textDecoration: "none" }}>
          ← All workers
        </Link>
      </p>

      <h1 style={{ marginBottom: "0.5rem" }}>{worker.name}</h1>
      <p style={{ color: "#444", marginTop: 0, fontSize: "1.1rem" }}>
        Monthly salary: <strong>{formatRand(worker.monthly_salary)}</strong>
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ borderBottom: "1px solid #ddd", paddingBottom: "0.25rem" }}>Photo</h2>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={`Photo of ${worker.name}`}
            style={{ maxWidth: 320, height: "auto", borderRadius: 4, border: "1px solid #ddd" }}
          />
        ) : (
          <p style={{ color: "#888", fontStyle: "italic" }}>No photo uploaded.</p>
        )}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ borderBottom: "1px solid #ddd", paddingBottom: "0.25rem" }}>ID Document</h2>
        {idDocUrl ? (
          <p>
            <a
              href={idDocUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#1a73e8" }}
            >
              View document ↗
            </a>
            {" "}
            <span style={{ color: "#888", fontSize: "0.85rem" }}>
              (link valid for 5 minutes)
            </span>
          </p>
        ) : (
          <p style={{ color: "#888", fontStyle: "italic" }}>No ID document uploaded.</p>
        )}
      </section>

      <footer style={{ marginTop: "3rem", fontSize: "0.85rem", color: "#aaa" }}>
        Worker id: {worker.id}
      </footer>
    </main>
  );
}
