// app/(auth)/forgot-password/page.tsx
"use client";

// Stage A of password reset: user enters email; we POST to NCB's
// /request-password-reset which sends a reset email containing a token-
// bearing link. We always show the same confirmation message regardless
// of whether the email is registered (prevents email enumeration).

import { useState, FormEvent } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        }),
      });
      if (!res.ok && res.status !== 200) {
        // Network-level success but app-level failure — still show generic
        // confirmation. NCB returns 200 even for unknown emails by design.
      }
      setSubmitted(true);
    } catch {
      setError("Couldn't reach the server. Try again.");
    }
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
        <h1>Check your email</h1>
        <p>If <strong>{email}</strong> is registered, a reset link has been sent. Check your inbox (and spam folder).</p>
        <p>If you don't receive an email within 5 minutes, contact support.</p>
        <p><Link href="/login" style={{ color: "#1a73e8" }}>Back to sign in</Link></p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Forgot password</h1>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={{ display: "block", width: "100%", padding: "0.5rem", marginTop: "0.25rem", fontSize: "1rem", boxSizing: "border-box" }}
          />
        </label>
        {error && <p style={{ color: "#d63031", margin: 0 }}>{error}</p>}
        <button type="submit" disabled={submitting} style={{ padding: "0.6rem", background: "#1a73e8", color: "white", border: "none", borderRadius: 4, fontSize: "1rem", cursor: submitting ? "wait" : "pointer" }}>
          {submitting ? "Sending…" : "Send reset link"}
        </button>
        <p style={{ margin: 0, fontSize: "0.85rem" }}>
          <Link href="/login" style={{ color: "#1a73e8" }}>Back to sign in</Link>
        </p>
      </form>
    </main>
  );
}
