// app/(auth)/reset-password/page.tsx
//
// Server Component shell. The actual reset form lives in ResetPasswordForm
// (a Client Component) and reads ?token= via useSearchParams(). Next.js 15+
// requires that hook to live below a <Suspense> boundary at build time so
// the prerender step has a deferred-render anchor; without it `next build`
// fails with "useSearchParams() should be wrapped in a suspense boundary."
//
// This split was forced by Netlify's prod build but is the canonical
// Next.js pattern — keep page.tsx light, move client state down a level.

import { Suspense } from "react";
import ResetPasswordForm from "./ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Reset password</h1>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
