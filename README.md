# Blood Operations Platform — OpenCode Rebuild Kit

## Purpose

This package is the **greenfield engineering specification** for rebuilding the supplied Blood Bank Management System as a substantially new product, architecture, implementation, and UI.

It is designed to be placed inside the target project workspace and used by OpenCode.

The supplied repository was analyzed only as a **functional reference baseline**. The target implementation must not copy its source code, component structure, database schema, UI, naming, documentation, or branding.

## What is inside

- `AGENTS.md` — mandatory project-wide OpenCode instructions.
- `MASTER_PROMPT.md` — the main prompt to give OpenCode at the beginning of the rebuild.
- `PROGRESS.md` — phase tracker and definition-of-done ledger.
- `DECISIONS.md` — architecture decision record with initial decisions.
- `docs/` — product, architecture, domain, security, API, UI, testing, and acceptance specifications.
- `.opencode/skills/blood-ops-rebuild/SKILL.md` — reusable project skill OpenCode can load when working on this product.
- `.opencode/agents/` — focused architecture/security/QA review agents.

## How to use

1. Put these files at the root of the new repository/workspace.
2. If you are starting from the old project, keep the old code available as a reference only; do not treat it as the target architecture.
3. Start OpenCode in the target workspace.
4. First provide `MASTER_PROMPT.md` to OpenCode, then let it follow `AGENTS.md` and the referenced project documents.
5. The agent must complete the architecture/repository baseline stage before implementing product features.
6. `PROGRESS.md` is the authoritative implementation status ledger. OpenCode must update it after every completed phase/task.

## Core implementation philosophy

- Greenfield rebuild, not a patchwork refactor.
- Modular monolith first; no premature microservices.
- PostgreSQL + Prisma for transactional consistency.
- TypeScript end-to-end.
- Server-side web sessions by default; never store authentication tokens in browser `localStorage`.
- Unit-level blood inventory with an immutable movement ledger.
- Explicit state machines for donations, inventory units, requests, reservations, and transfers.
- Secure-by-default authorization with least privilege.
- Automated tests are part of the feature, not a later phase.
- Medical compatibility logic is operational decision support only and must never be represented as autonomous clinical authority.
- All core functionality must run with open-source/local tooling and without paid APIs.

## Important

The product name and public branding are intentionally left as a later product decision. Use the internal codename `blood-ops` in architecture/documentation until branding is finalized.
