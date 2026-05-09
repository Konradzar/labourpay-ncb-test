"use server";

// app/(app)/workers/new/actions.ts
//
// Server Action for creating a worker. Replaces V0.2's
// /api/public-data/create/workers browser POST.
//
// Mirrors V0.1's deleteWorker pattern: ncbAuthFetch forwards Bearer +
// session cookies; NCB sets user_id from the session. revalidatePath
// invalidates the list cache; redirect navigates back.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ncbAuthFetch } from "@/lib/ncb-utils";

export type CreateWorkerInput = {
  name: string;
  monthly_salary: number | null;
  photo_key: string | null;
  id_doc_key: string | null;
  perceptpixel_url: string | null;
  perceptpixel_uid: string | null;
};

export async function createWorker(input: CreateWorkerInput): Promise<void> {
  // Server-side validation. Client also validates, but never trust the client.
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("Name is required.");
  }
  if (
    input.monthly_salary !== null &&
    (!Number.isFinite(input.monthly_salary) || input.monthly_salary < 0)
  ) {
    throw new Error("Monthly salary must be a non-negative number.");
  }

  const payload = {
    name: input.name.trim(),
    monthly_salary: input.monthly_salary,
    photo_key: input.photo_key,
    id_doc_key: input.id_doc_key,
    perceptpixel_url: input.perceptpixel_url,
    perceptpixel_uid: input.perceptpixel_uid,
    // user_id deliberately omitted — NCB sets it from the session on
    // authenticated writes when RLS is `private`.
  };

  const res = await ncbAuthFetch("/create/workers", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(
      `NCB create worker failed: ${res.status} ${await res.text()}`
    );
  }

  revalidatePath("/");
  redirect("/");
}
