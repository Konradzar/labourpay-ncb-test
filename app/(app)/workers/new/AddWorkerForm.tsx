"use client";

// app/workers/new/AddWorkerForm.tsx
//
// Client component. THREE file inputs, all upload-on-pick:
//   - Photo + ID Document → S3 via presigned URL (browser → S3 directly)
//   - PerceptPixel image  → POST /api/perceptpixel-upload (server proxy,
//     because PerceptPixel's Api-Key auth can't be used safely in browser JS)
// Form state stores the resulting key (S3) or cdn_url (PerceptPixel).
// On submit, only the keys/URLs are sent to NCB — no file bytes ever pass
// through our server for the S3 case.

import { useState, useRef, FormEvent } from "react";
import type { MutableRefObject } from "react";
import { createWorker } from "./actions";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
const MAX_BYTES = 5 * 1024 * 1024;

type UploadState = {
  // Holds whichever stable identifier the upload returned: an S3 key like
  // `workers/<uuid>.png`, or a PerceptPixel cdn_url like
  // `https://img.perceptpixel.com/<org-uid>/<filename>`. The handler is
  // generic over which.
  key: string | null;
  uploading: boolean;
  error: string | null;
};

const INITIAL_UPLOAD: UploadState = { key: null, uploading: false, error: null };

// Shared client-side validation. Throws with a user-readable message if the
// file is the wrong type or too large. Both uploaders use this — no point
// duplicating the same checks.
function validateFile(file: File): void {
  if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    throw new Error(
      `Unsupported type: ${file.type || "(unknown)"}. Use JPEG, PNG, or PDF.`
    );
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`File too large (max ${MAX_BYTES / 1024 / 1024} MB).`);
  }
}

// Upload a single file to S3: POST /api/upload-url, then PUT to S3.
// Returns the S3 key on success; throws on failure.
async function uploadFileToS3(file: File): Promise<string> {
  validateFile(file);

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

// Upload a single file to PerceptPixel: POST multipart to our own server
// proxy (which forwards to PerceptPixel with the Api-Key header). Returns
// the cdn_url on success.
async function uploadFileToPerceptPixel(file: File): Promise<string> {
  validateFile(file);

  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch("/api/perceptpixel-upload", {
    method: "POST",
    body: fd,
    // Don't set Content-Type — browser sets multipart/form-data; boundary=...
  });
  if (!res.ok) {
    throw new Error(
      `PerceptPixel upload failed: ${res.status} ${await res.text()}`
    );
  }
  const { cdn_url } = (await res.json()) as { cdn_url: string };
  return cdn_url;
}

export default function AddWorkerForm() {
  const [photo, setPhoto] = useState<UploadState>(INITIAL_UPLOAD);
  const [idDoc, setIdDoc] = useState<UploadState>(INITIAL_UPLOAD);
  // V0.1.5 — third image source. Optional. If user doesn't pick a file,
  // perceptpixel.key stays null and we send perceptpixel_url: null on submit.
  const [perceptpixel, setPerceptpixel] = useState<UploadState>(INITIAL_UPLOAD);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-field "request id" counter. Each upload captures the id at start; on
  // resolution, only commit state if the id is still current. Prevents the
  // race where the user picks file A → picks file B before A finishes →
  // A's resolution overwrites B's state.
  const photoReqId = useRef(0);
  const idDocReqId = useRef(0);
  const perceptpixelReqId = useRef(0);

  // Generic file-picker change handler. Sets state to "uploading", performs
  // the upload via the supplied uploader function, then sets state to either
  // "success with key" or "error".
  // Using a ref for request id means we don't re-render on each pick — the
  // counter increments synchronously and the closure captures the value.
  const handleFileChange = (
    setState: (state: UploadState) => void,
    reqIdRef: MutableRefObject<number>,
    uploader: (file: File) => Promise<string>
  ) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input value so picking the SAME file twice (e.g. retry after
    // an upload error) still fires `change`. Without this, HTML file inputs
    // suppress the event when the selected file is identical.
    e.target.value = "";
    if (!file) return;

    const myReqId = ++reqIdRef.current;
    setState({ key: null, uploading: true, error: null });
    try {
      const key = await uploader(file);
      // If the user picked another file in the meantime, our result is stale.
      if (myReqId !== reqIdRef.current) return;
      setState({ key, uploading: false, error: null });
    } catch (err) {
      if (myReqId !== reqIdRef.current) return;
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

    if (photo.uploading || idDoc.uploading || perceptpixel.uploading) {
      setError("Wait for all files to finish uploading before saving.");
      return;
    }
    if (!photo.key || !idDoc.key) {
      setError("Both a photo and an ID document are required.");
      return;
    }

    const formData = new FormData(e.currentTarget);
    const name = String(formData.get("name") || "").trim();
    const monthly_salary = Number(formData.get("monthly_salary"));

    if (!name) {
      setError("Name is required.");
      return;
    }
    if (!Number.isFinite(monthly_salary) || monthly_salary < 0) {
      setError("Monthly salary must be a non-negative number.");
      return;
    }

    setSubmitting(true);
    try {
      await createWorker({
        name,
        monthly_salary,
        photo_key: photo.key,
        id_doc_key: idDoc.key,
        perceptpixel_url: perceptpixel.key ?? null,
      });
      // No fall-through here on success — the Server Action redirects.
    } catch (err) {
      // Next.js framework throws NEXT_REDIRECT internally; it's caught and
      // handled before reaching this catch. Anything we see is a real error.
      setError(err instanceof Error ? err.message : "Save failed");
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
          onChange={handleFileChange(setPhoto, photoReqId, uploadFileToS3)}
          disabled={photo.uploading}
        />
        <UploadStatus state={photo} />
      </div>

      <div>
        <label style={labelStyle}>ID Document (JPEG / PNG / PDF, max 5 MB)</label>
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={handleFileChange(setIdDoc, idDocReqId, uploadFileToS3)}
          disabled={idDoc.uploading}
        />
        <UploadStatus state={idDoc} />
      </div>

      <div>
        <label style={labelStyle}>
          PerceptPixel image (optional, V0.1.5 test) — JPEG / PNG / PDF, max 5 MB
        </label>
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={handleFileChange(setPerceptpixel, perceptpixelReqId, uploadFileToPerceptPixel)}
          disabled={perceptpixel.uploading}
        />
        <UploadStatus state={perceptpixel} />
      </div>

      {error && (
        <div style={{ color: "#c00", padding: "0.5rem", background: "#fee", borderRadius: 4 }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || photo.uploading || idDoc.uploading || perceptpixel.uploading}
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
