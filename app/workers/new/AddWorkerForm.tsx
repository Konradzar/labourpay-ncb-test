"use client";

// app/workers/new/AddWorkerForm.tsx
//
// Client component. Two file inputs use upload-on-pick — files are uploaded
// to S3 via presigned URL the moment they're selected. The form's hidden
// state stores the returned keys. On submit, only the keys are sent to NCB
// (no file bytes pass through our server).

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
const MAX_BYTES = 5 * 1024 * 1024;

type UploadState = {
  key: string | null;
  uploading: boolean;
  error: string | null;
};

const INITIAL_UPLOAD: UploadState = { key: null, uploading: false, error: null };

// Upload a single file: POST /api/upload-url, then PUT to S3.
// Returns the S3 key on success; throws on failure.
async function uploadFile(file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type as typeof ALLOWED_TYPES[number])) {
    throw new Error(
      `Unsupported type: ${file.type || "(unknown)"}. Use JPEG, PNG, or PDF.`
    );
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`File too large (max ${MAX_BYTES / 1024 / 1024} MB).`);
  }

  // Step 1: ask our server for a presigned URL.
  const presignRes = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type }),
  });
  if (!presignRes.ok) {
    throw new Error(`Presign failed: ${presignRes.status} ${await presignRes.text()}`);
  }
  const { url, key } = (await presignRes.json()) as { url: string; key: string };

  // Step 2: PUT the file directly to S3 using the presigned URL.
  // Browser → S3 directly. Our server is bypassed for the file bytes.
  const putRes = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`S3 upload failed: ${putRes.status} ${putRes.statusText}`);
  }

  return key;
}

export default function AddWorkerForm() {
  const router = useRouter();
  const [photo, setPhoto] = useState<UploadState>(INITIAL_UPLOAD);
  const [idDoc, setIdDoc] = useState<UploadState>(INITIAL_UPLOAD);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generic file-picker change handler. Sets state to "uploading", performs
  // the upload, then sets state to either "success with key" or "error".
  const handleFileChange = (
    setState: (state: UploadState) => void
  ) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setState({ key: null, uploading: true, error: null });
    try {
      const key = await uploadFile(file);
      setState({ key, uploading: false, error: null });
    } catch (err) {
      setState({
        key: null,
        uploading: false,
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (photo.uploading || idDoc.uploading) {
      setError("Wait for both files to finish uploading before saving.");
      return;
    }
    if (!photo.key || !idDoc.key) {
      setError("Both a photo and an ID document are required.");
      return;
    }

    const formData = new FormData(e.currentTarget);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      monthly_salary: Number(formData.get("monthly_salary")),
      photo_key: photo.key,
      id_doc_key: idDoc.key,
    };

    if (!payload.name) {
      setError("Name is required.");
      return;
    }
    if (!Number.isFinite(payload.monthly_salary) || payload.monthly_salary < 0) {
      setError("Monthly salary must be a non-negative number.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/public-data/create/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Save failed: ${res.status} ${await res.text()}`);
      }
      // Success — go back to the list and refresh so the new row appears.
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Inline styles kept minimal. CSS module / design pass deferred.
  const inputStyle = { width: "100%", padding: "0.5rem", boxSizing: "border-box" as const, fontSize: "1rem" };
  const labelStyle = { display: "block", fontWeight: 500, marginBottom: "0.25rem" };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1.25rem" }}>
      <div>
        <label htmlFor="name" style={labelStyle}>Name</label>
        <input id="name" name="name" required type="text" style={inputStyle} />
      </div>

      <div>
        <label htmlFor="monthly_salary" style={labelStyle}>Monthly salary (R, whole rands)</label>
        <input
          id="monthly_salary"
          name="monthly_salary"
          required
          type="number"
          min="0"
          step="1"
          style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>Photo (JPEG / PNG / PDF, max 5 MB)</label>
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={handleFileChange(setPhoto)}
          disabled={photo.uploading}
        />
        <UploadStatus state={photo} />
      </div>

      <div>
        <label style={labelStyle}>ID Document (JPEG / PNG / PDF, max 5 MB)</label>
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={handleFileChange(setIdDoc)}
          disabled={idDoc.uploading}
        />
        <UploadStatus state={idDoc} />
      </div>

      {error && (
        <div style={{ color: "#c00", padding: "0.5rem", background: "#fee", borderRadius: 4 }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || photo.uploading || idDoc.uploading}
        style={{
          padding: "0.6rem 1rem",
          fontSize: "1rem",
          background: submitting ? "#888" : "#1a73e8",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        {submitting ? "Saving…" : "Save Worker"}
      </button>
    </form>
  );
}

// Small per-file status indicator. Pure render, no state.
function UploadStatus({ state }: { state: UploadState }) {
  if (state.uploading) return <span style={{ color: "#888", marginLeft: "0.5rem" }}>uploading…</span>;
  if (state.key) return <span style={{ color: "green", marginLeft: "0.5rem" }}>✓ uploaded</span>;
  if (state.error) return <span style={{ color: "#c00", marginLeft: "0.5rem" }}>{state.error}</span>;
  return null;
}
