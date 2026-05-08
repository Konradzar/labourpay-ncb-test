// app/(app)/layout.tsx
//
// Gated layout. Runs server-side on every request inside the (app) route
// group. Calls NCB /get-session via getSessionUser; if no session, redirects
// to /login. Also renders the page header with sign-out button + user email.
//
// Auth pages live in (auth)/ and use only the root layout, so they don't
// trigger the redirect loop.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/ncb-utils";
import { signOutAction } from "./sign-out-action";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const user = await getSessionUser(cookieHeader);
  if (!user) redirect("/login");

  return (
    <>
      <header
        style={{
          maxWidth: 720,
          margin: "1rem auto 0",
          padding: "0.5rem 1rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "system-ui, sans-serif",
          fontSize: "0.9rem",
          color: "#555",
        }}
      >
        <span>Signed in as <strong>{user.email ?? user.id}</strong></span>
        <form action={signOutAction} style={{ display: "inline" }}>
          <button
            type="submit"
            style={{
              background: "white",
              color: "#1a73e8",
              border: "1px solid #1a73e8",
              padding: "0.25rem 0.75rem",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Sign out
          </button>
        </form>
      </header>
      {children}
    </>
  );
}
