## What changed

-

## How to try it

1. `pnpm install && pnpm db:start && pnpm db:env`
2. `pnpm dev` and open http://localhost:3000

## Checks

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm check:logical`
- [ ] `pnpm db:test`
- [ ] `pnpm --filter web build && pnpm --filter web test:e2e`
- [ ] `cd engine && uv run pytest`
