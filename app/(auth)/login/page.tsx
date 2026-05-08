"use client";

// Email + password sign-in. Posts to /api/auth/sign-in/email which proxies
// to NCB. On success, NCB sets the session cookies; we navigate to /.

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!res.ok) {
        // Don't echo NCB error verbatim — keep messaging consistent.
        setError("Invalid email or password.");
        setPassword("");
        setSubmitting(false);
        return;
      }
      router.refresh();
      router.push("/");
    } catch {
      setError("Couldn't reach the server. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <main
      style={{
        maxWidth: 360,
        margin: "4rem auto",
        padding: "0 1rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ marginBottom: "1.5rem" }}>Sign in</h1>
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
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{ display: "block", width: "100%", padding: "0.5rem", marginTop: "0.25rem", fontSize: "1rem", boxSizing: "border-box" }}
          />
        </label>
        {error && <p style={{ color: "#d63031", margin: 0 }}>{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "0.6rem", background: submitting ? "#888" : "#1a73e8",
            color: "white", border: "none", borderRadius: 4, fontSize: "1rem",
            cursor: submitting ? "wait" : "pointer",
          }}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <p style={{ margin: 0, fontSize: "0.85rem" }}>
          <Link href="/forgot-password" style={{ color: "#1a73e8" }}>
            Forgot password?
          </Link>
        </p>
      </form>
    </main>
  );
}
