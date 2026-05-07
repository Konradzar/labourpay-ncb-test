// lib/types.ts
//
// Shared TypeScript types used by Server Components, Client Components,
// and API routes. Centralised here so a schema change touches one place.

// === Worker — matches the NCB `workers` table ===
//
// IMPORTANT: NCB returns numeric columns (DECIMAL, INT, etc.) as JSON STRINGS,
// not numbers. So `monthly_salary` is typed as `string` here. Consumers must
// `Number(value)` before doing arithmetic. See docs/NCB_NOTES.md for context.
//
// Also note: `monthly_salary` was created as DECIMAL via mcp create_database,
// but NCB stored it as a column that rounds fractional values (we tested
// 1234.50 → "1235"). Treat values as whole rands. See docs/NCB_NOTES.md.
export type Worker = {
  id: number;
  name: string;
  monthly_salary: string;
  photo_key: string | null;
  id_doc_key: string | null;
};

// === NCB envelope types ===

// List endpoint response. Generic over the row type.
export type NCBListResponse<T> = {
  status?: string;
  data?: T[];
  metadata?: {
    page: number;
    limit: number;
    hasMore: boolean;
    hasPrev: boolean;
  };
};

// Single-record read endpoint response. NCB wraps the row in a `data` field
// (we observed this on Task 6 smoke tests). May also support a bare row —
// consumers should accept either shape.
export type NCBSingleResponse<T> = {
  status?: string;
  data?: T;
};

// Create endpoint response (HTTP 201 from NCB).
export type NCBCreateResponse = {
  status?: string;
  message?: string;
  id?: number;
};

// Input shape for the updateWorker Server Action. Mirrors the writable subset
// of Worker (omits id, which is path-bound, and user_id, which V0.1 doesn't
// modify — set at creation only). monthly_salary is `number` here because
// the form sends a JS number; NCB returns it as a string on read.
export type WorkerUpdateInput = {
  name: string;
  monthly_salary: number;
  photo_key: string;
  id_doc_key: string;
};
