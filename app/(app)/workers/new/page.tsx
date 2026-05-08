// app/workers/new/page.tsx
//
// Server Component shell for the "Add Worker" page. Hosts the actual form
// (which is a Client Component because it has state + file uploads).

import AddWorkerForm from "./AddWorkerForm";
import Link from "next/link";

export default function NewWorkerPage() {
  return (
    <main
      style={{
        maxWidth: 480,
        margin: "2rem auto",
        padding: "0 1rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/" style={{ color: "#1a73e8", textDecoration: "none" }}>
          ← All workers
        </Link>
      </p>
      <h1>Add Worker</h1>
      <AddWorkerForm />
    </main>
  );
}
