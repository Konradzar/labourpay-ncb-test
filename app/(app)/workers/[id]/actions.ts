"use server";

// app/workers/[id]/actions.ts
//
// Server Actions for the worker detail/edit pages. These run server-side ONLY
// — the "use server" directive means they're invoked via Next.js's RSC wire
// format, not exposed as JSON HTTP routes. The NCB_SECRET_KEY stays inside
// this module's process.env access; no path leads it to the browser bundle.
//
// updateWorker — added in V0.1 plan task 7.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ncbAuthFetch } from "@/lib/ncb-utils";
import { deletePerceptPixelMedia } from "@/lib/perceptpixel-utils";
import type { Worker, NCBSingleResponse } from "@/lib/types";

// Delete a worker row by id. S3 photo + ID-doc files are deliberately NOT
// removed (orphan-cleanup policy per V0 design doc line 246). PerceptPixel
// IS cleaned up though — V0.3 mid-flight added that contract because PP
// quota is metered, unlike S3 where orphan cost is negligible.
//
// Order of operations:
//   1. Read the worker to capture `perceptpixel_uid` (NCB row has the link;
//      once we delete the row we lose it).
//   2. Best-effort DELETE on PerceptPixel — if it fails, we log and proceed.
//      Reasons: PP outage shouldn't block local cleanup; rows pre-V0.3 don't
//      have a uid, so this branch is naturally a no-op for them.
//   3. DELETE on NCB.
//   4. revalidatePath + redirect.
//
// On NCB error: throws — Next.js error boundary surfaces the message.
export async function deleteWorker(id: number): Promise<void> {
  // Step 1: read worker (best-effort — if read fails, fall through to delete
  // anyway. The read is for cleanup metadata, not authorization, which NCB
  // already enforces via RLS.)
  let perceptpixelUid: string | null = null;
  try {
    const readRes = await ncbAuthFetch(`/read/workers/${id}`);
    if (readRes.ok) {
      const json = (await readRes.json()) as NCBSingleResponse<Worker> | { data?: Worker[] };
      const data = (json as { data?: unknown }).data;
      const worker: Worker | null = Array.isArray(data)
        ? ((data[0] as Worker) ?? null)
        : ((data as Worker) ?? null);
      perceptpixelUid = worker?.perceptpixel_uid ?? null;
    }
  } catch (err) {
    console.error(`[deleteWorker ${id}] read for PP cleanup failed (continuing):`, err);
  }

  // Step 2: best-effort PerceptPixel delete.
  if (perceptpixelUid) {
    try {
      await deletePerceptPixelMedia(perceptpixelUid);
    } catch (err) {
      console.error(
        `[deleteWorker ${id}] PerceptPixel delete failed for uid=${perceptpixelUid} (continuing):`,
        err
      );
    }
  }

  // Step 3: NCB delete (the actual work — failures here propagate).
  const res = await ncbAuthFetch(`/delete/workers/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(
      `NCB delete worker failed: ${res.status} ${await res.text()}`
    );
  }

  revalidatePath("/");
  redirect("/");
}
