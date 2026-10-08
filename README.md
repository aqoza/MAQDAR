# MAQDAR

Multi-tenant cloud SaaS for service parts planning, built for OEMs, distributors and multi-brand dealer groups in the Middle East (KSA, UAE, Qatar, Kuwait, Oman, Bahrain, Egypt, Jordan).

Read `CLAUDE.md` for the engineering rules and `docs/PLAN.md` for the roadmap and build steps.

## Prerequisites

- Node.js 24 and pnpm 12 (`npm install -g pnpm@12`)
- Docker Desktop (for the local Supabase stack)
- uv (Python 3.12 is installed by uv)

## Quick start

```bash
pnpm install
pnpm db:start          # local Supabase (Postgres, Auth, Mailpit)
pnpm db:env            # writes apps/web/.env.local from the local stack
pnpm dev               # http://localhost:3000
```

Magic-link emails sent by the local stack appear in Mailpit at http://127.0.0.1:54324.

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm check:logical
pnpm db:test                       # pgTAP
pnpm --filter web test:e2e         # Playwright smoke
cd engine && uv run pytest
```
