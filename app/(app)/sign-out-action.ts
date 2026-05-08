// app/(app)/sign-out-action.ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CONFIG, extractAuthCookies } from "@/lib/ncb-utils";

export async function signOutAction() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const sessionCookies = extractAuthCookies(cookieHeader);

  // Best-effort: tell NCB to invalidate the session.
  try {
    await fetch(`${CONFIG.authApiUrl}/sign-out?Instance=${CONFIG.instance}`, {
      method: "POST",
      headers: {
        "X-Database-Instance": CONFIG.instance,
        ...(sessionCookies && { Cookie: sessionCookies }),
      },
    });
  } catch {
    // Ignore — local cookies cleared regardless.
  }

  // Always clear local cookies so the user is signed out client-side
  // regardless of upstream success.
  cookieStore.delete("better-auth.session_token");
  cookieStore.delete("better-auth.session_data");

  redirect("/login");
}
