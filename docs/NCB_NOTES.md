# NCB Integration — Notes & Plan Amendments

Findings from the actual NCB integration that change the original plan.
Cross-reference with [`docs/plans/2026-05-07-worker-profile-slice-plan.md`](plans/2026-05-07-worker-profile-slice-plan.md) for the original blueprint.

## NCB response shapes (discovered via Task 6 smoke test)

- **List read**: `{ status: "success", data: [...rows], metadata: { page, limit, hasMore, hasPrev } }` — rows live under `body.data`.
- **Create**: `{ status: "success", message: "Record created successfully", id: <new_id> }` with **HTTP 201** (not 200). New row's id is at `body.id`.
- **Error envelope (from our route)**: `{ error: "..." }` with appropriate 4xx status. NCB's own errors may differ — we'll see them as we go.

UI code (Tasks 8 + 10) must handle the `data: [...]` envelope, not assume the JSON is a bare array.

## Single-record endpoint requires auth — workaround uses list filter

NCB's documented single-record endpoint `/read/<table>/<id>` returns **HTTP 500** for anonymous requests even when the table RLS policy is `public_read*` — discovered during Task 10's smoke test on `/read/workers/1`. The list endpoint `/read/<table>` correctly honors public RLS policies AND supports column filtering via query parameters.

**Workaround**: filter the list endpoint by primary key:

```typescript
// instead of:
//   GET /read/workers/<id>?Instance=<inst>           ← 500 anonymous
// use:
//   GET /read/workers?Instance=<inst>&id=<id>         ← works
```

The filter returns either `data: [<row>]` (one match) or `data: []` (no match). `app/workers/[id]/page.tsx` handles both shapes.

If NCB later fixes the single-record endpoint for anonymous requests, we can revert to the simpler URL — the response-shape branch in `fetchWorker` already accepts both `data: <object>` and `data: [<object>]`.

## `DECIMAL` columns store as integer strings

We created `workers.monthly_salary` with type `DECIMAL` via `create_database`. Empirically NCB's `DECIMAL` rounds to the nearest integer AND returns the value as a JSON string, not a number.

Posted `1234.50` → NCB returned `"1235"`.

**Implication for V0**:
- Salary input in Task 9's form should use `step="1"` (whole rands), not `step="0.01"`.
- All numeric fields from NCB need `Number(...)` coercion before arithmetic in TypeScript.

This is acceptable for FoxFitt's actual data (field-worker salaries are whole rand amounts in the existing Flatlogic app). If we later want fractional cents we'd need to investigate NCB's `DECIMAL` precision options or store cents as INT (and divide by 100 in UI).

## Instance name has account-id prefix

NCB prefixed our database with the account ID: the actual instance name is
**`35120_labourpay_ncb_test`** (not `labourpay_ncb_test`). All env vars and
references must use the prefixed name.

## Two proxy routes, not one

The plan described a single `/api/data/[...path]` route. NCB actually expects:

| Route | Purpose | Used in V0? |
|---|---|---|
| `app/api/auth/[...path]/route.ts` | Login flows (Better Auth — sign-in, sign-out, OAuth) | ❌ No (V0.2) |
| `app/api/data/[...path]/route.ts` | Authenticated CRUD — requires session, applies RLS | ❌ No (V0.2) |
| `app/api/public-data/[...path]/route.ts` | Anonymous CRUD — works for tables with `public_*` policy | ✅ **Yes (V0)** |
| `app/api/auth-providers/route.ts` | List enabled auth methods | ❌ No (V0.2) |
| `lib/ncb-utils.ts` | Shared helpers (proxy, cookies, RLS cache) | ✅ Yes (used by public-data route) |

For V0 we'll create `lib/ncb-utils.ts` and `app/api/public-data/[...path]/route.ts`. The other three come with V0.2 when we add login.

## NCB API URL pattern uses verb prefixes

The plan's curl examples assumed REST conventions like `GET /api/data/workers`. NCB actually uses verb-prefixed paths:

| Operation | NCB endpoint (proxied) |
|---|---|
| List all rows | `GET /api/public-data/read/workers` |
| Get one row by id | `GET /api/public-data/read/workers/<id>` (likely — confirm during Task 6 smoke test) |
| Create a row | `POST /api/public-data/create/workers` |
| (Update) | `PUT /api/data/update/workers/<id>` — auth route only |
| (Delete) | `DELETE /api/data/delete/workers/<id>` — auth route only |

Public route only supports GET and POST (create). Updates and deletes need the auth route, so V0 is genuinely Create + Read only — matches the design's V0 scope exactly.

## Use NCB-provided code, don't write custom

The plan's Task 5/6 had me writing a custom `lib/ncb-utils.ts` (~30 lines, just the data fetch). Reality: NCB's `get_integration_prompts` MCP tool returns ready-made TypeScript for both `lib/ncb-utils.ts` (~150 lines, full helper set) and `app/api/public-data/[...path]/route.ts` (~100 lines, RLS-aware). We'll use NCB's code as-is. Saves time and keeps us aligned with NCB's docs for future debugging.

In Task 6 we'll regenerate the integration prompts via MCP (rather than copying from this conversation, which has transport-level escape artifacts on backticks) and write the files clean.

## `created_at` column wasn't auto-added

The original design assumed NCB auto-adds `created_at` to every table. Empirically it does not. For V0 we use `id` (auto-increment integer) as the implicit ordering field. If chronological filtering is needed later, add `created_at` via `mcp__nocodebackend__create_field`.

## NCB's `lib/ncb-utils.ts` does extra work that costs nothing in V0

The provided utilities include:
- `getSessionUser` — reads cookies, calls NCB's `/get-session`. Not used by public route, but exported for future auth route.
- `getRlsPolicies` — caches RLS-policy lookups for 1 minute (used by public-data route to enforce `public_*` policies before forwarding).
- `proxyToNCB` (auth) and `proxyToNCBPublic` (anonymous) — two proxy primitives.

We'll keep the full file even though only `proxyToNCBPublic` and the policy helpers are used in V0. Future-us building the auth route gets it for free.

## Frontend fetches `/api/public-data/`, NOT `/api/data/`

In V0, every browser fetch from a UI page goes to `/api/public-data/...`. Examples (corrected from the plan):

```typescript
// list workers
const res = await fetch("/api/public-data/read/workers");

// create worker
const res = await fetch("/api/public-data/create/workers", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name, monthly_salary, photo_key, id_doc_key }),
});

// get one worker — exact path TBD at Task 6 smoke test
const res = await fetch(`/api/public-data/read/workers/${id}`);
```

No `credentials: "include"` needed for the public route (it's deliberately session-less).

## Don't propagate the secret key

The NCB Secret Key value should appear:
- Once in the `create_database` MCP response (which has happened — and was relayed to user for NordPass paste)
- Once in the user's NordPass entry (canonical store)
- Once in the user's `.env.local` (runtime, gitignored)

It must NEVER appear in:
- Any `.md` doc in this repo (including this one)
- Any file in `.env.local.example`
- Any commit message
- Any TS/JS source file (always `process.env.NCB_SECRET_KEY`)
