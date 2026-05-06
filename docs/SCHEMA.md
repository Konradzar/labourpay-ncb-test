# NCB Schema — `35120_labourpay_ncb_test`

Generated 2026-05-07. Verify with `mcp__nocodebackend__get_schema(database="35120_labourpay_ncb_test")`.

## Application table: `workers`

| Column | NCB type | Nullable | Source | Notes |
|---|---|---|---|---|
| `id` | integer (auto-increment) | NO | NCB auto | Primary key |
| `name` | string | NO | app | Worker's full name |
| `monthly_salary` | number | NO | app | ZAR per month (NCB stored as `number`, not strict `decimal`) |
| `photo_key` | string | YES | app | S3 object key, e.g. `workers/<uuid>.jpg`. Nullable so writes don't fail when file is omitted |
| `id_doc_key` | string | YES | app | S3 object key for ID document |
| `user_id` | string | YES | NCB auto | FK to `ncba_user.id`. Auto-added because native auth enabled. Unused in V0 (we don't authenticate). |

**Note vs original design**: the design assumed NCB would auto-add a `created_at` column. It did NOT. Row-creation order is available via `id` (auto-increment) for V0. If chronological filtering becomes important, add `created_at` later via `mcp__nocodebackend__create_field` with default `current_timestamp()`.

**RLS policy**: `public_readwrite` — accessible via `/api/public-data/` route without authentication. 🚨 **Localhost-dev only. Change to `private` or `shared_readwrite` before any deploy.**

## NCB-managed tables (Better Auth scaffolding — do not edit)

These are created automatically by NCB when `enableAuth=true`:

| Table | Purpose |
|---|---|
| `ncba_user` | User accounts (id, name, email, emailverified, image) |
| `ncba_account` | OAuth/provider linkage per user |
| `ncba_session` | Active login sessions (token, expiresat, useragent) |
| `ncba_verification` | Email-verification + password-reset codes |
| `ncba_config` | Auth-provider on/off flags + OAuth credentials |
| `ncba_rls_config` | Per-table RLS policy storage (key-value, table_name → policy) |

These will be referenced by NCB's auth proxy (`app/api/auth/[...path]`) when we wire up real login in V0.2.

## Auth providers (current state)

Fetched via `mcp__nocodebackend__setup_auth_providers`. None of these are used in V0 (no auth UI rendered).

| Provider | Enabled | Notes |
|---|---|---|
| `email` | ✅ true | Default — email + password sign-in/sign-up |
| `google` | ❌ false | OAuth — would need Google Cloud Console credentials |
| `emailOTP` | ❌ false | Passwordless — magic-code via email |
