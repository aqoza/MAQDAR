# Database resource identifiers

PostgreSQL stores UUID values without requiring a particular RFC version or variant.
Imported and deterministic identifiers can therefore be valid database references while
failing Zod's stricter `z.uuid()` validator. This caused saved forecast-quality rows and
nested stock/purchasing evidence to throw during rendering, resource links to return 404,
and master-data selects to reject their own existing values.

Use `z.guid()` for canonical database resource identifiers in session routes, form references,
and saved evidence. It still requires the complete hexadecimal `8-4-4-4-12` shape, consistent
with the existing master-data `isUuid` check. Keep `z.uuid()` for client-generated retry/event
tokens and the separately versioned API path contract. Authorization remains a separate check:
active organization, membership/role guards, organization predicates, and database RLS.

This compatibility repair requires no schema migration, ID rewrite, relationship change,
or export-version change. The generated OpenAPI patterns for saved evidence describe the
broader identifier domain; serializers and immutable data remain unchanged.

`src/lib/postgres-identifiers.test.ts` reproduces the failures using synthetic saved records.
Their tenant UUID is replaced with a fixture value; non-RFC resource IDs and exact decimal
strings are retained. The tests also cover malformed identifiers and strict retry tokens.

The audit screen separately uses its own entity labels. Its rows include planning and access
records beyond the CSV import contract. Unknown future tables receive a translated fallback
instead of displaying a missing translation key. See `src/lib/audit.test.ts`.

References: [PostgreSQL UUID type](https://www.postgresql.org/docs/current/datatype-uuid.html),
[Zod UUID and GUID validation](https://zod.dev/api#uuids).
