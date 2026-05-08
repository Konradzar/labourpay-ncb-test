"use client";

// app/workers/[id]/DeleteWorkerButton.tsx
//
// Tiny Client Component that wraps the deleteWorker Server Action with a
// native browser confirm() guard. Used on the worker detail page.
//
// Pattern: <form action={deleteWorker.bind(null, id)}> — Next.js dispatches
// the bound action when the form submits. The onClick handler runs FIRST
// (synchronous browser behaviour) and can call e.preventDefault() to abort
// the submit if the user clicks Cancel in the confirm dialog.

import { deleteWorker } from "./actions";

export function DeleteWorkerButton({
  id,
  name,
}: {
  id: number;
  name: string;
}) {
  return (
    <form action={deleteWorker.bind(null, id)} style={{ display: "inline" }}>
      <button
        type="submit"
        onClick={(e) => {
          if (
            !confirm(`Delete worker ${name}? This cannot be undone.`)
          ) {
            e.preventDefault();
          }
        }}
        style={{
          background: "white",
          color: "#d63031",
          border: "1px solid #d63031",
          padding: "0.5rem 1rem",
          borderRadius: 4,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: "0.95rem",
        }}
      >
        Delete worker
      </button>
    </form>
  );
}
