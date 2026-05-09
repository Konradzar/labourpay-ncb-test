"use client";

// Client component that owns the reset-password form state. Split out from
// page.tsx so the page itself can be a Server Component that wraps this in
// a <Suspense> boundary — Next.js 15+ requires the boundary at build time
// when useSearchParams() is used in a Client Component.

import { useEffect, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function ResetPasswordForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(sp.get("token"));
  }, [sp]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) {
      setError("Missing token. Use the link from your email.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        setError("This link has expired or is invalid. Request a new one.");
        setSubmitting(false);
        return;
      }
      router.push("/login");
    } catch {
      setError("Couldn't reach the server. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
      <label>
        New password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          style={{ display: "block", width: "100%", padding: "0.5rem", marginTop: "0.25rem", fontSize: "1rem", boxSizing: "border-box" }}
        />
      </label>
      {error && (
        <p style={{ color: "#d63031", margin: 0, fontSize: "0.9rem" }}>
          {error}{" "}
          {error.includes("expired") && <Link href="/forgot-password" style={{ color: "#1a73e8" }}>Request a new link.</Link>}
        </p>
      )}
      <button type="submit" disabled={submitting} style={{ padding: "0.6rem", background: "#1a73e8", color: "white", border: "none", borderRadius: 4, fontSize: "1rem", cursor: submitting ? "wait" : "pointer" }}>
        {submitting ? "Resetting…" : "Set new password"}
      </button>
      <p style={{ margin: 0, fontSize: "0.85rem" }}>
        <Link href="/login" style={{ color: "#1a73e8" }}>Back to sign in</Link>
      </p>
    </form>
  );
}
