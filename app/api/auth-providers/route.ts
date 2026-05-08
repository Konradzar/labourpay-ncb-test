// app/api/auth-providers/route.ts
//
// Exposes the enabled auth providers (email / google / emailOTP) to the
// client so the login UI renders only the buttons that NCB has configured.
// Currently in this database: email = true, google = false, emailOTP = false.

import { NextResponse } from "next/server";
import { CONFIG } from "@/lib/ncb-utils";

export async function GET() {
  const url = `${CONFIG.authApiUrl}/providers?Instance=${CONFIG.instance}`;
  const res = await fetch(url, {
    headers: { "X-Database-Instance": CONFIG.instance },
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data);
}
