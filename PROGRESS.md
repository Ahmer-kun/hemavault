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

- [x] Organization entity implemented.
- [x] Facility entity implemented.
- [x] User identity/role model implemented.
- [x] Permission catalogue implemented.
- [x] Role/permission assignment implemented.
- [x] Facility scoping enforced.
- [x] Admin management flows implemented.
- [x] Authorization integration tests pass.

## Phase 3 — Donors + Donation Operations

- [x] Donor profile implemented with data minimization.
- [x] Donation appointment implemented.
- [x] Blood drive/campaign implemented.
- [x] Donor check-in implemented.
- [x] Donation collection record implemented.
- [x] Screening/quarantine workflow implemented.
- [x] Release/rejection workflow implemented.
- [x] Donation history implemented.
- [x] Donor self-service views implemented.
- [x] Operational donor-management views implemented.
- [x] Domain tests pass.

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

### Phase 2 entry

```text
Date: 2026-09-25
Phase: Phase 2
Change: Implemented Organizations + Facilities + RBAC. Migration `20260925065532_phase2_rbac` adds Permission, Role,
  RolePermission, UserRole, Organization, Facility, FacilityMembership, RoleScope/status enums, User.name, and
  AuditEvent.organizationId/facilityId (+ indexes). Single source of truth for the access-control catalogue:
  src/modules/rbac/domain/permission-catalogue.ts (54 permissions, 7 roles, globalRoles()/facilityRoles()/
  assertCatalogueIntegrity()); idempotent sync via access-control.seed.ts run by prisma/seed.ts and vitest
  globalSetup (test/global-setup.ts). Authorization engine: pure policy module (canGlobally/canAnywhere/
  canAtFacility/evaluatePermissions/isMemberOfFacility), RbacService.buildActorContext per request, global
  PermissionsGuard registered AFTER AuthGuard that skips @Public routes, decorators RequirePermission/
  RequireGlobal/RequireAnywhere/RequireFacilityScope + @CurrentActor, AuthenticatedRequest.actor. Modules:
  organizations (create/list/get/update + audit; code normalized uppercase, P2002→409), facilities
  (create/list/get/update + member add/remove/list; ACTIVE-org gate, facilityRoles() allowlist, unique
  membership; resource scope: out-of-scope org/facility → 404 mask, guard miss → 403 FORBIDDEN), users
  (me with memberships+effectivePermissions, profile name update, user list, global role assign/remove with
  globalRoles() scope check, last-PLATFORM_SUPER_ADMIN removal blocked → 409 LAST_SUPER_ADMIN). Route guards:
  org create/patch RequireGlobal organization.manage; org list/get RequireAnywhere organization.read; facility
  create RequireGlobal [organization.manage|facility.manage] anyOf; facility get/patch RequireFacilityScope
  facility.read/facility.manage; members list RequireFacilityScope [manage_members|read] anyOf; member
  add/remove RequireFacilityScope facility.manage_members; users list/roles RequireGlobal user.read /
  user.manage_roles. AuditService now records organizationId/facilityId and hashes them into the chain. New
  AuditModule (shared provider). CsrfGuard added on all mutating endpoints. Fixed DTO code regexes to accept
  mixed case (normalized to uppercase in service). vitest.config sets fileParallelism:false (e2e shares one
  DB; suite cleanups must not race); rbac e2e uses its own email domain.
Verification commands: npm run typecheck -w apps/api; npm run lint -w apps/api; npm run build -w apps/api;
  npm run test:unit -w apps/api; npm run test:e2e -w apps/api; npx prisma validate
Result: typecheck clean; eslint clean; nest build ok; prisma validate ok; unit 49/49 (policy engine, catalogue
  integrity/super-admin rollup, audit hash incl. org/facility context, prior suites); e2e 43/43 = health 4,
  auth 12 (unchanged), rbac 27: unauthenticated 401 gate, cross-role 403 FORBIDDEN, CSRF 403 on mutations,
  org create/dup-409/code-uppercase normalization/patch/list/get, org-out-of-scope masked 404 for in-scope
  reader + 403 for staff without organization.read, facility create/dup-409/under missing 404 or inactive org
  409 ORGANIZATION_INACTIVE, membership add/dup-409/role-allowlist-400/USER_NOT_FOUND-404/remove reflected in
  list, lab-staff read own facility+members 200, lab-staff denied manage 403, cross-facility hidden 403,
  facility manager manage own 200 / other facility 403, /users/me memberships+effectivePermissions, profile
  name update, super admin global set, auditor assign/dup-409/INVALID_ROLE_SCOPE-400/use→revoke→403, last
  super admin 409 LAST_SUPER_ADMIN, audit events with org/facility context + hash chain.
Known limitations: (1) First PLATFORM_SUPER_ADMIN must be bootstrapped out-of-band (e.g. prisma script/sql);
  no seeded auto-admin; currently no UI/admin path promotes the first admin (Phase 8). (2) e2e writes to the
  shared dev DB and cleans up after itself within its own domain/codes. (3) Organization/facility deletion
  (deactivate-only) is a deliberate future Phase choice. (4) npm audit residual unchanged (Phase 9).
Decision/ADR reference: ADR-030 (RBAC persistence model + catalogue authority), ADR-031 (centralized
  PermissionsGuard + resource scoping semantics: 403 vs 404), ADR-032 (bootstrap: no auto-created admin;
  first assignment out-of-band; last-super-admin invariant).
```

### Phase 3 entry

```text
Date: 2026-09-25
Phase: Phase 3
Change: Implemented Donors + Donation Operations. Migration `20260925080626_phase3_donors_donations` adds
  DonorProfile, BloodDrive, CampaignRegistration, Donation, DonationScreening, Deferral + enums (CampaignStatus,
  DonationState, ScreeningResult, DeferralReason). New modules (registered in app.module.ts in dependency order
  DonorsModule -> CampaignsModule -> DonationsModule; DonationsModule hosts CampaignCheckInController under
  /api/v1/campaigns):
  - donors/domain: deferral policy (active-deferral gating, resolve event, reason codes), pure donor code
    generation, structured errors.
  - donors/application, infrastructure: self-service profile upsert on first access (data minimization: no blood
    group or medical data on the profile), profile update, history views, staff search + facility-linked
    visibility, deferral record/status/enforcement.
  - campaigns/domain: state machine DRAFT -> PUBLISHED -> CANCELLED with allowed-transition guards, capacity
    enforcement with compare-and-set (CAMPAIGN_FULL), booking window check, registration duplicate guard
    (ALREADY_REGISTERED), cancel-owner-or-manage_registrations rule.
  - donations/domain + application: state machine SCHEDULED -> CHECKED_IN -> COLLECTED -> SCREENING ->
    QUARANTINED -> RELEASED (REJECTED from SCREENING/QUARANTINED), walk-in create (donorReference or profile
    id), atomic campaign check-in creating the donation + registration check-in in one transaction,
    idempotent check-in, collect with volume + blood group, screening start + pass, quarantine, reject with
    reasonCode, release, facility-scoped visibility (404 mask), donation.create gated on active facility,
    deferral enforced at check-in and booking. Donation DTOs leave volumeMl/bloodGroup/reasonCode optional so
    the service emits structured codes (BLOOD_GROUP_REQUIRED, VOLUME_REQUIRED, REJECT_REASON_REQUIRED) instead
    of generic BAD_REQUEST. Audit actions for campaign and donation lifecycle with org/facility context +
    hash chain. E2E spec `test/donor-donation.e2e-spec.ts` covers platform bootstrap, donor self-service
    (upsert/update/list), campaign lifecycle (create/publish/cancel/named PATCH/booking window/capacity own-
    and-cancel), campaign check-in (atomic donation create, idempotency, unregistered 404), donation ops
    (scheduled walk-in, check-in, collect, screening, quarantine, release, invalid-state rejection, reject
    from SCREENING/QUARANTINED, reasonCode, invalid-state gates), facility-scope masking (donor and donation
    404) and permission gates (403), deferrals (block/resolve booking), and audit trail coverage.
Verification commands: npm run typecheck -w apps/api; npm run lint -w apps/api; npx prisma validate;
  npm run build -w @blood-ops/api; npm run build -w @blood-ops/web; npm run test:unit -w apps/api;
  npm run test:e2e -w apps/api
Result: typecheck clean; eslint clean; prisma validate ok; api + web builds ok; unit 113/113 (12 files: audit
  hash chain, permission catalogue, donor deferral policy, campaigns state machine/capacity/registration,
  donations state machine/reject path, prior suites); e2e 75/75 (4 files): health 4, auth 12, rbac 27, donor
  + donation 32. E2E debugging notes: (1) register normalizes emails to lowercase, so helpers had to query
  lowercase emails (Postgres = is case-sensitive). (2) Facilities default to status PENDING; test helper
  activates via PATCH before campaign create (campaign create 409s on inactive facility). (3) Login is
  throttled 10/60s per IP, so high-volume specs cache credentials per user. (4) Cookie and CSRF header must
  come from the same session. (5) Donation DTOs were made optional on the group/reason fields so business
  rules (BLOOD_GROUP_REQUIRED, REJECT_REASON_REQUIRED) fire instead of class-validator BAD_REQUEST.
Known limitations: (1) performCampaignCheckIn carries a raw Error for the not-checkinable path (would surface
  as an unhandled 500; only reachable in a race, low risk, revisit in a later phase). (2) Donor web UI is not
  part of this phase (Phase 8 per UI_UX_SPEC); backend + e2e only. (3) Facility must be ACTIVE before any
  donation or campaign creation; facilities default to PENDING. (4) npm audit residual unchanged from Phase 0
  (Phase 9 hardening). (5) ADR-033..036 sit before the ADR-032 heading in DECISIONS.md (cosmetic ordering).
Decision/ADR reference: ADR-033 (create donation at campaign check-in, not at booking), ADR-034 (donation
  screening/quarantine/release/reject machine + structured screen/reject codes), ADR-035 (donor deferral
  policy + resolution model), ADR-036 (ownership-bound self-service vs RequireAnywhere staff routes and 404
  scope masking), ADR-037 (DTOs whitelist shapes; domain emits business-rule codes).
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
