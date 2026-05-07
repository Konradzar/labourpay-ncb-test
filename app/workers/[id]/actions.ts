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

// Delete a worker row by id. S3 photo + ID-doc files are deliberately NOT
// removed — orphan-cleanup policy per V0 design doc line 246.
//
// On success: revalidates the list page cache + redirects to /.
// On NCB error: throws — Next.js error boundary surfaces the message.
export async function deleteWorker(id: number): Promise<void> {
  const res = await ncbAuthFetch(`/delete/workers/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(
      `NCB delete worker failed: ${res.status} ${await res.text()}`
    );
  }

  revalidatePath("/");
  redirect("/");
}
