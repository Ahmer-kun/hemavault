# Implementation Progress

**Authority:** This file is the single source of truth for implementation status.

## Status vocabulary

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete and verified
- `[!]` Blocked / needs decision

A task is not complete merely because code exists. It is complete only when its verification evidence is recorded.

## Review 0 — Architecture and Readiness Review

**Status:** Complete (review only; no application code written).

Verified findings (2026-09-21):

- Workspace contains only the specification kit: `AGENTS.md`, `MASTER_PROMPT.md`, `DECISIONS.md`, `PROGRESS.md`, `README.md`, `MANIFEST.sha256`, `docs/` (16 docs), and `.opencode/` (skill + `agents/architect.md`, `agents/qa-reviewer.md`, `agents/security-reviewer.md`). No application source exists yet.
- The workspace is not a git repository.
- Toolchain verified: Node v20.19.0, npm 10.8.2, Docker 29.2.1, Docker Compose v5.1.0.
- Document set is internally consistent after the new ADRs (ADR-015 through ADR-022) reconciled unit/donation release semantics, `RECALLED`, expiry, reference rules, email adapters, reservation concurrency, emergency semantics, and multi-facility authorization.
- No fundamental architectural defect found. Modular monolith, unit-level inventory, immutable movement ledger, permission-based server-side authorization, secure cookie sessions are coherent and sufficient.
- No Phase 0-10 checklist item is marked complete. Phase 0 is the first implementation phase per `MASTER_PROMPT.md`.

## Phase 0 — Repository + Architecture Baseline

- [x] New repository/workspace structure established.
- [x] `AGENTS.md` loaded and obeyed.
- [x] Backend TypeScript strict configuration established.
- [x] Frontend TypeScript strict configuration established.
- [x] Package manager/workspace convention established.
- [x] Environment configuration strategy established.
- [x] Docker Compose local environment works.
- [x] PostgreSQL starts and is reachable.
- [x] Prisma connects and migration workflow works.
- [x] `/health/live` works.
- [x] `/health/ready` checks dependencies.
- [x] Lint/typecheck/build scripts exist.
- [x] Initial architecture verified against `docs/ARCHITECTURE.md`.

## Phase 1 — Security + Authentication Foundation

- [x] User/session persistence implemented.
- [x] Password hashing implemented with approved modern password hashing.
- [x] Secure cookie session implemented.
- [x] Login/logout implemented.
- [x] Session rotation/revocation implemented.
- [x] Password reset workflow implemented.
- [x] Email verification workflow implemented or intentionally stubbed behind a clear adapter.
- [x] Authentication rate limiting implemented.
- [x] CSRF protection strategy implemented/tested.
- [x] Security headers configured.
- [x] Request IDs/structured errors implemented.
- [x] Audit event foundation implemented.
- [x] Auth integration tests pass.

## Phase 2 — Organizations + Facilities + RBAC

- [ ] Organization entity implemented.
- [ ] Facility entity implemented.
- [ ] User identity/role model implemented.
- [ ] Permission catalogue implemented.
- [ ] Role/permission assignment implemented.
- [ ] Facility scoping enforced.
- [ ] Admin management flows implemented.
- [ ] Authorization integration tests pass.

## Phase 3 — Donors + Donation Operations

- [ ] Donor profile implemented with data minimization.
- [ ] Donation appointment implemented.
- [ ] Blood drive/campaign implemented.
- [ ] Donor check-in implemented.
- [ ] Donation collection record implemented.
- [ ] Screening/quarantine workflow implemented.
- [ ] Release/rejection workflow implemented.
- [ ] Donation history implemented.
- [ ] Donor self-service views implemented.
- [ ] Operational donor-management views implemented.
- [ ] Domain tests pass.

## Phase 4 — Inventory Engine

- [ ] Component types/reference data implemented.
- [ ] Blood/component unit model implemented.
- [ ] Storage location implemented.
- [ ] Inventory movement ledger implemented.
- [ ] Unit state machine implemented.
- [ ] Expiration handling implemented.
- [ ] Reservation locking strategy implemented.
- [ ] Reconciliation strategy implemented.
- [ ] Inventory audit history implemented.
- [ ] Concurrency tests pass.
- [ ] No negative/duplicate available inventory invariant passes.

## Phase 5 — Requests + Matching + Reservation + Issuance

- [ ] Hospital request implemented.
- [ ] Request priority/urgency implemented.
- [ ] Request lifecycle implemented.
- [ ] Configurable compatibility matrix implemented.
- [ ] Inventory matching service implemented.
- [ ] FEFO-style allocation implemented where policy permits.
- [ ] Reservation command implemented transactionally.
- [ ] Partial fulfillment implemented.
- [ ] Issuance implemented.
- [ ] Fulfillment tracking implemented.
- [ ] Emergency workflow implemented.
- [ ] Critical request tests pass.

## Phase 6 — Transfers + Notifications + Real-Time

- [ ] Facility transfer request implemented.
- [ ] Transfer packing/dispatch implemented.
- [ ] In-transit state implemented.
- [ ] Receipt confirmation implemented.
- [ ] Transfer inventory reconciliation implemented.
- [ ] Notification model/service implemented.
- [ ] In-app notification center implemented.
- [ ] Real-time events implemented only where justified.
- [ ] Delivery/retry behavior tested.

## Phase 7 — Analytics + Reporting

- [ ] Inventory dashboard implemented.
- [ ] Donation metrics implemented.
- [ ] Request metrics implemented.
- [ ] Fulfillment/response metrics implemented.
- [ ] Expiration/forecasting views implemented where appropriate.
- [ ] Reports/export implemented.
- [ ] Analytics access controls implemented.

## Phase 8 — UX + Accessibility + Responsive Design

- [ ] Design system tokens finalized.
- [ ] Desktop navigation implemented.
- [ ] Mobile navigation implemented.
- [ ] Loading/empty/error/success states implemented.
- [ ] Keyboard navigation verified.
- [ ] Visible focus states verified.
- [ ] Color contrast verified.
- [ ] Form error semantics verified.
- [ ] Tables/data grids usable on small screens.
- [ ] Emergency workflow usable on constrained viewports.

## Phase 9 — Hardening + Verification

- [ ] Full unit suite passes.
- [ ] Full integration suite passes.
- [ ] Full API authorization suite passes.
- [ ] Critical E2E workflows pass.
- [ ] Concurrency tests pass.
- [ ] Security review completed.
- [ ] Accessibility review completed.
- [ ] Production builds pass.
- [ ] Migration-from-empty-database tested.
- [ ] Seed data works.
- [ ] Docker setup works from clean checkout.

## Phase 10 — Release Readiness

- [ ] README finalized.
- [ ] Architecture docs match implementation.
- [ ] OpenAPI docs match implementation.
- [ ] Environment example finalized.
- [ ] Backup/restore procedure documented.
- [ ] Health/readiness endpoints documented.
- [ ] Known limitations recorded.
- [ ] Acceptance criteria all verified.
- [ ] Final security sign-off recorded.

## Verification journal

Append entries below as implementation progresses.

### Entry template

```text
Date:
Phase:
Change:
Verification commands:
Result:
Known limitations:
Decision/ADR reference (if any):
```

### Phase 1 entry

```text
Date: 2026-09-21
Phase: Phase 1
Change: Implemented the Security + Authentication Foundation (backend-only; web auth UI arrives Phase 8 per UI_UX_SPEC).
  Prisma schema + migration `20260921083607_phase1_auth` adds User (UserStatus enum), Session, EmailVerificationToken,
  PasswordResetToken, AuditEvent (hash-chained, SetNull actor). Auth module:
  - domain/ (pure rules): session policy (absolute+idle TTL, live check), lockout policy, status transition map,
    auth.errors, argon2id hasher.
  - infrastructure/: AuthRepository (transactional register/verify/reset), SessionRepository (token hashing,
    rotation, revocation, lazy touch), SessionService (validate cookie+csrf), EmailProvider adapter +
    DevConsoleEmailProvider.
  - application/: AuthService (register/verify-email/login/logout/logout-all/forgot-password/reset-password/me,
    anti-enumeration messages, audit calls).
  - presentation/: DTOs (class-validator), AuthController (api/v1/auth/*, session cookie set/clear), AuthGuard
    (global, @Public opt-out), CsrfGuard, @CurrentSession param decorator.
  Common: AppConfigService (typed env getters) + AppConfigModule (global), AppThrottlerGuard (ip:email tracker),
  AppHttpException (structured business errors; filter now lets the business code win over the status map),
  APP_PIPE ValidationPipe moved to module-level (so e2e behaves like prod). main.ts: helmet with Swagger-safe CSP,
  cookie-parser. Env schema adds session/password/token/lockout/cookie config. Marked health+meta @Public.
Verification commands: npm run typecheck -w apps/api; npm run lint -w apps/api; npm run build -w apps/api;
  npm run test:unit -w apps/api; npm run test:e2e -w apps/api; npx prisma validate; runtime smoke
  (node dist/main.js + curl /api/v1/meta, /health/live, /docs, /api/v1/auth/login 401 INVALID_CREDENTIALS,
  /api/v1/auth/me 401 UNAUTHENTICATED; header inspection CSP/COOP/XCTO).
Result: typecheck clean; eslint clean; nest build ok; prisma validate ok; unit 36/36; e2e 16/16 (auth: register→verify
  PENDING→ACTIVE, argon2id hash stored, duplicate-registration generic message, login cookie flags, generic
  anti-enumeration equality, me 200/401, 5-fail lockout, CSRF 403 without header, logout revocation, reset+
  token-consume+sessions-revoked, register 429, audit rows present). Live smoke: envelopes + headers + Swagger good.
Known limitations: (1) Password policy length lives in env schema + DTO defaults (12/128) — single source to unify
  when UI lands. (2) Audit chain link can collide under concurrent inserts (best-effort chaining; ADR-029). (3) Dev
  email provider is in-memory with no production guard yet — production adapter is an ADR-019 ops decision. (4) e2e
  writes to the shared dev DB and leaves audit-+user rows under e2e-blood-ops.invalid (cleaned in afterAll of the
  auth spec, retained across runs if the DB is untouched). (5) unverified/disabled-account admin management and
  facility scoping are Phase 2 (RBAC). (6) npm audit residual unchanged (3 high, dev-only deepmerge-ts via prisma
  CLI) — tracked, revisit Phase 9.
Decision/ADR reference: ADR-025 (argon2id params), ADR-026 (DB sessions + CSRF synchronizer + rotation/revocation),
  ADR-027 (per-account+IP throttling + lockout), ADR-028 (PENDING→ACTIVE/DISABLED gated model + anti-enumeration),
  ADR-029 (hash-chained audit trail).
```

### Review 0 entry

```text
Date: 2026-09-21
Phase: Review 0
Change: Architecture and readiness review. No application code created. Recorded ADR-015..ADR-022 in DECISIONS.md.
Verification commands: node --version; npm --version; docker --version; docker compose version; git status
Result: Toolchain available. Workspace = spec kit only; no app code; not a git repository. Review complete, no blocking issue found.
Known limitations: Reference seed values for compatibility rules and component types require a documented clinical review before production (ADR-018).
Decision/ADR reference: ADR-015 through ADR-022.
```

### Phase 0 entry

```text
Date: 2026-09-21
Phase: Phase 0
Change: Created npm-workspaces monorepo (root + apps/api + apps/web). API: NestJS 11 modular monolith, pg via Prisma 6, strict TS, zod env validation, request-id middleware, global error envelope, X-Request-ID header, /health/live + /health/ready (database probe), /api/v1/meta, Swagger at /docs, vitest unit + supertest e2e. Web: React 19 + Vite + Tailwind v4, TanStack Query, SystemStatus health view, vitest + Testing Library. Root scripts: build/typecheck/lint/test/format/db:*. Docker Compose Postgres 16. Dockerfiles for api + web. prisma.config.ts migrated.
Verification commands: npm run typecheck; npm run lint; npm run build; docker compose up -d; npm run db:generate; npm run db:validate; npx prisma migrate deploy; npm run db:seed; npm test; node dist/main.js + curl /health/live, /health/ready, /api/v1/meta, /docs, unknown-route 404; docker builds.
Result: typecheck/lint/build pass both workspaces. Postgres healthy (docker). Prisma generate/validate/migrate deploy/seed all pass. Tests: api 9/9 (5 unit + 4 e2e against live DB), web 2/2, all passing. Runtime verified: /health/live 200 {status:ok} + X-Request-ID; /health/ready 200 {status:ok, checks.database:up}; /api/v1/meta 200 envelope with meta.requestId; /docs 200; unknown route 404 {error:{code:NOT_FOUND,...}} with requestId. Docker images blood-ops-api:phase0 and blood-ops-web:phase0 build; containerized API boots and serves /health/ready {database:up} against compose Postgres.
Known limitations: (1) npm audit remains 3 high findings, all one advisory (GHSA-ggr8-5vv4-36mx deepmerge-ts <8.0.0) reachable only through prisma CLI's @prisma/config on the dev toolchain; CVSS 0.0, dev-only config-merge stack exhaustion, no production exposure; fix requires prisma 8 line; revisit in Phase 9 hardening. eslint 9.39.5 deprecation warning noted. (2) & vitest 4 + esbuild emit no design:paramtypes, so Nest DI in tests requires unplugin-swc (installed) — swc.vite() is config, not a runtime dependency. (3) Docker image size 956MB (node:22-alpine full runtime incl. prisma engines) — optimization optional for later. (4) Empty Phase 0 schema: init migration is an empty baseline created manually (prisma migrate dev creates none for no-model schemas). (5) First compose start required Docker Desktop to be launched; documented.
Decision/ADR reference: ADR-023 (workspace/toolchain), ADR-024 (API envelope + DI-in-tests via SWC).
```
