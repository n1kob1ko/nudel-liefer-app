# Routenplanner (Nudel Liefer App)

Delivery management for a pasta factory: office enters customer orders, the system builds one optimized tour per delivery date, and drivers use a mobile PWA (German / Chinese) showing stops, quantities, shop and parking photos, and navigation.

Requirements: [`projektbeschreibung.md`](./projektbeschreibung.md), work plan and decisions: [`backlog.md`](./backlog.md), agent conventions: [`AGENTS.md`](./AGENTS.md).

## Run locally

Requires Node 22+ and pnpm (`corepack enable`).

```bash
cp .env.example .env
docker compose up -d            # postgres + minio (or: pnpm db:embedded, no Docker)
pnpm install
pnpm db:migrate && pnpm db:seed          # optional demo data: pnpm db:seed --demo (docs/demo.md)
pnpm dev            # http://localhost:3000
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check
pnpm exec playwright install chromium   # once
pnpm test:e2e       # desktop + mobile projects
```
