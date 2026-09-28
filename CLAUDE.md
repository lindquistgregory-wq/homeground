# Homeground — instructions for Claude sessions

Read `docs/PLAN.md` (phases and architecture) and `docs/PHASE1_REPORT.md` (current state and known gaps) before changing anything.

## Non-negotiables (from the owner's build prompt)
- **Zero running cost.** Use only services and libraries that are free for commercial use. No paid, metered or trial-then-bill services, and no developer server. If a requirement can't be met for free, stop and ask. Don't add a paid service quietly.
- New npm dependency → add it to `licenses.json`. New network host → add it to `packages/data/src/sources.ts` and `DATA_SOURCES.md`. `pnpm check:licenses` enforces both.
- No shared API keys. A key that's needed has to be the user's own, stored in the keychain.
- Privacy: never request or store parcel owner names or mailing addresses. Parcel queries use the id/acreage allowlist (`sanitizeAttributes`).
- Every derived number carries attribution: `Sourced<T>` or `Unavailable` from `@homeground/core/provenance`.
- Work in phases. At the end of each phase, run tests, summarize, confirm no paid dependency was added, list limitations, and ask before starting the next phase.

## Conventions
- Domain logic goes in `packages/core` (pure, no I/O). Network code goes in `packages/providers` behind the injected `HttpClient`. React Native code goes only in `apps/mobile`.
- Don't use `URL` or `URLSearchParams` in shared code (React Native polyfills are incomplete). Use `qs()` and `hostname()` from `providers/src/qs.ts`.
- Tests use `node:test` via `tsx --test`. Provider tests use `testClient()` with fixtures. Mark synthetic fixtures as such in `__fixtures__/README.md`.
- Commands: `pnpm check` (typecheck + tests + zero-cost gate).
