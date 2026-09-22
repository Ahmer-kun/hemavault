# MASTER PROMPT — Blood Operations Platform Greenfield Rebuild

You are the principal engineer responsible for rebuilding a blood-bank operations platform from scratch.

Treat the current workspace and every document in this kit as an engineering project, not a one-shot coding request.

## Your first job: understand the system before writing product code

Read, in order:

- `AGENTS.md`
- `PROGRESS.md`
- `docs/PROJECT_CHARTER.md`
- `docs/ARCHITECTURE.md`
- `docs/PRODUCT_REQUIREMENTS.md`
- `docs/DOMAIN_MODEL.md`
- `docs/STATE_MACHINES.md`
- `docs/SECURITY_THREAT_MODEL.md`
- `docs/RBAC_MATRIX.md`
- `docs/API_CONTRACT.md`
- `docs/UI_UX_SPEC.md`
- `docs/TESTING_STRATEGY.md`
- `docs/ACCEPTANCE_CRITERIA.md`
- `DECISIONS.md`
- `docs/REFERENCE_BASELINE.md`

Then inspect the actual workspace.

If an old implementation exists, analyze it only to understand what behavior has already been attempted and what must be deliberately replaced. Do not copy its implementation.

## Non-negotiable mission

Build an independent, secure, maintainable blood operations platform with:

- donor management;
- donation lifecycle management;
- blood/component inventory at unit level;
- screening/quarantine/release states;
- hospital/facility management;
- request and emergency workflows;
- compatibility-assisted matching using configurable approved rules;
- reservations with concurrency protection;
- issue/dispatch tracking;
- inter-facility transfers;
- blood drives and donor appointments;
- notifications;
- audit trails;
- analytics/reporting;
- role/permission-based access control;
- responsive accessible web UX;
- complete test coverage of critical business rules;
- OpenAPI documentation;
- Docker-based local reproducibility.

## Architectural target

Use a modular monolith first.

### Backend

- TypeScript.
- NestJS-style modules and dependency boundaries.
- PostgreSQL.
- Prisma.
- REST API under `/api/v1`.
- OpenAPI/Swagger.
- Secure server-side browser sessions.
- WebSockets only where justified.

### Frontend

- React.
- TypeScript.
- Vite.
- Tailwind CSS.
- Accessible component primitives.
- TanStack Query for server state.
- React Hook Form + Zod for forms/validation.
- TanStack Table where data-grid behavior is needed.
- Recharts or another lightweight charting library for analytics.
- Lucide icons or equivalent.

### Infrastructure

- Docker and Docker Compose for local development.
- PostgreSQL container for local development.
- Optional Redis/worker infrastructure only after an ADR demonstrates the need.
- No paid API is required for the core product.

## Critical domain rule

Do not build a naive `bloodGroup -> quantity` CRUD table.

The system must treat inventory as discrete blood/component units with a lifecycle and immutable movement history.

Example lifecycle:

`COLLECTED -> SCREENING -> QUARANTINED -> RELEASED -> AVAILABLE -> RESERVED -> ISSUED -> RECEIVED/USED`

with terminal or exception states such as:

`EXPIRED`, `DISCARDED`, `RECALLED`, `TRANSFER_PENDING`, `IN_TRANSIT`.

Every transition must be valid, auditable, and transactionally safe.

## Critical security rule

Never implement browser auth with a token stored in `localStorage`.

Use secure, HTTP-only, SameSite cookies for browser sessions. Rotate/revoke sessions correctly. Do not expose secrets to the frontend.

All authorization must be server-side and permission-based.

## Critical medical-safety rule

This platform provides operational assistance, not autonomous clinical decisions.

Do not invent or silently assume medical eligibility/deferral/shelf-life/compatibility rules. Make relevant reference rules configurable, documented, and traceable to approved sources. Human authorized staff remain responsible for final validation.

## Critical originality rule

The supplied application is a functional reference only.

Do not copy:

- code;
- JSX/component structure;
- CSS/layouts;
- route naming solely because the old app used it;
- model definitions;
- controller implementation;
- screenshots;
- branding;
- README prose;
- comments;
- duplicated/legacy architecture.

Reimplement the product independently from this specification.

## Build sequence

Follow the phases in `PROGRESS.md` exactly unless an ADR explicitly changes the sequencing.

### Phase 0 — Repository and architecture baseline

- Establish the new repository structure.
- Establish package/workspace conventions.
- Create TypeScript configurations.
- Create environment configuration conventions.
- Create Docker Compose for local development.
- Create quality scripts.
- Create initial Prisma project.
- Create initial health checks.
- Confirm the architecture compiles.
- Do not build domain features yet.

### Phase 1 — Security foundation

- Session model.
- Password hashing.
- Login/logout.
- Session rotation/revocation.
- Password reset flow design.
- Email verification flow design.
- Rate limiting.
- Security headers.
- CSRF strategy for cookie-authenticated state-changing requests.
- Request IDs.
- Structured error responses.
- Audit event foundation.

### Phase 2 — Identity, organizations, facilities, RBAC

Implement the user/organization/facility model and permission system.

Do not scatter checks like `if role === 'admin'` throughout the application. Use centralized authorization guards/policies.

### Phase 3 — Donors and donation operations

Implement donor profile, appointments, blood drives, check-in, donation collection, screening, quarantine, and release/rejection states.

### Phase 4 — Inventory engine

Implement unit-level component inventory, storage location, movements, expiration, reservation mechanics, and reconciliation.

This phase is the core domain-engineering challenge.

### Phase 5 — Hospital requests, matching, reservation, issuance

Implement normal/urgent/emergency requests, request lifecycle, approved rule-based matching, reservation, issue, and fulfillment tracking.

### Phase 6 — Transfers and notifications

Implement inter-facility transfers, dispatch/receipt states, in-app notifications, and real-time events where justified.

### Phase 7 — Analytics and reporting

Build operational dashboards and exports without duplicating business rules in the UI.

### Phase 8 — UX, accessibility, responsive workflows

Build the production-quality interface described in `docs/UI_UX_SPEC.md`.

### Phase 9 — Hardening and verification

Run the full testing matrix, security review, accessibility checks, migration validation, concurrency tests, and build verification.

### Phase 10 — Release readiness

Finalize docs, seed data, environment examples, Docker usage, health endpoints, backup/restore guidance, acceptance checklist, and release notes.

## Implementation rules

- Build the domain model before building complex screens.
- Build critical business rules as testable services/functions, not UI logic.
- Use transactions for multi-step inventory operations.
- Prefer idempotent command handlers where retries are possible.
- Use unique constraints for business invariants whenever possible.
- Avoid mutable denormalized counters unless their consistency strategy is explicit.
- Never hide backend failures behind fake zero/empty counts.
- Never ship placeholder analytics values.
- Never mark an operation successful before persistence succeeds.
- Never return password hashes or session secrets.
- Never log secrets.
- Do not use patient names by default; use a hospital-controlled reference code unless a future requirement explicitly proves another data field is necessary.

## Required developer experience

A new developer must be able to:

1. clone the repository;
2. copy the environment example;
3. start Docker Compose;
4. run migrations/seed;
5. start the web/API projects;
6. log into a demo environment;
7. run tests;
8. inspect OpenAPI docs;
9. understand the architecture from repository documentation.

## Required verification after every substantial implementation increment

Run the narrowest useful checks first, then the wider suite.

Example:

1. formatter/linter on changed files;
2. unit tests for changed domain behavior;
3. API/integration tests for changed workflows;
4. typecheck;
5. frontend build/backend build;
6. full test suite at phase boundaries.

Never claim a check passed unless it was actually run.

## Handling ambiguity

Do not stop for routine clarification requests.

Use this priority order:

1. Safety and data integrity.
2. Security and privacy.
3. Explicit product requirements.
4. Architecture decisions.
5. Consistency with adjacent domain behavior.
6. Simplest maintainable implementation.

Record non-trivial assumptions in `DECISIONS.md`.

## Final requirement

The final result must feel like a new product, not a cleaned-up student CRUD application.

Before declaring the rebuild complete, verify every item in `docs/ACCEPTANCE_CRITERIA.md` and update `PROGRESS.md` with evidence.
