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

- [x] Component types/reference data implemented. (read/list services + API; schema models exist; idempotent seed wired)
- [x] Blood/component unit model implemented. (Prisma model + services)
- [x] Storage location implemented. (Prisma model + facility-scoped list)
- [x] Inventory movement ledger implemented. (append-only `InventoryMovement` in atomic tx; state+movement validated; stale-write guard; movement-type/target-state compatibility)
- [x] Unit state machine implemented. (pure validator per STATE_MACHINES.md + ADR-016 RECALLED terminal)
- [x] Expiration handling implemented. (lazy effective-state classification + bounded in-process sweep, no external worker — ADR-017)
- [x] Reservation locking strategy implemented. (SELECT FOR UPDATE + recheck + active-claim check + partial unique active-claim index + facility-scoped idempotency + stale-write guard; ADR-020). **DB-level concurrency proof blocked** (no isolated Postgres available; tests written).
- [~] Reconciliation strategy implemented. (append-only RECONCILED movement, state machine enforced, server-side auth/scope, reason required, AuditEvent emitted; policy may need further ADR refinement)
- [x] Inventory audit history implemented for implemented commands. (immutable movement history exposed; AuditEvent emitted for move/quarantine/discard/reconcile; reservation/issuance commands are Phase 5 API scope)
- [x] Concurrency tests pass. Verified 2026-11-07 against isolated local PostgreSQL (`hemavault-test-db`, `localhost:5433/hemavault_test`, migrations applied via `prisma migrate deploy`; `DATABASE_URL`/`TEST_DATABASE_URL` set to isolated DB only, never Supabase). `apps/api/test/inventory-concurrency.e2e-spec.ts`: **8 passed, 0 failed** (simultaneous same-unit reservations, idempotency retries, different idempotency keys, expired-unit rejection, DB partial unique index, facility isolation, 8-way invariant, tx rollback atomicity).
- [x] No negative/duplicate available inventory invariant passes. Verified by DB tests above (exactly-one active claim / 1 success across concurrent attempts) plus partial unique index `ReservationItem_unitId_active_unique` (WHERE `isActive=true`) and service-side FOR UPDATE + recheck + stale-write guard.

## Phase 5 — Requests + Matching + Reservation + Issuance

**Planning:** completed 2026-11-07 — see `docs/PHASE_5_PLAN.md`. **Step 1 verified + Step 2 implemented (backend/API) on 2026-11-08** against isolated local PostgreSQL only (`hemavault-test-db`, `postgres:16`, `localhost:5433/hemavault_test`; host positively verified before DB mutations). Step 3+ not started.

- [x] Hospital request implemented. (Step 2: `requests` module, `/api/v1/requests` CRUD/lifecycle endpoints, facility scope, audit, DTO validation, CSRF)
- [x] Request priority/urgency implemented. (Step 2: `RequestUrgency` persisted/validated; emergency/critical escalation timestamp metadata; no safety-rule bypass)
- [x] Request lifecycle implemented. (Step 2: pure domain state machine; submit/approve/reject/cancel; contract-aligned compound review transition where `/review` route absent; invalid/terminal transitions rejected)
- [ ] Configurable compatibility matrix implemented.
- [ ] Inventory matching service implemented.
- [ ] FEFO-style allocation implemented where policy permits.
- [ ] Reservation command implemented transactionally.
- [ ] Partial fulfillment implemented.
- [ ] Issuance implemented.
- [ ] Fulfillment tracking implemented.
- [~] Emergency workflow implemented. (Step 2 urgency/escalation metadata + audit hooks only; full operational alerting/queue delivery deferred to later Phase 5/6 steps per ADR-021)
- [ ] Critical request tests pass. (Request domain/lifecycle/API/RBAC/isolation/quantity/tx-rollback tests pass; matching/reservation/issuance/concurrency critical-path tests pending Step 3+)

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

### Phase 4 entry (inventory foundation + core workflows; partial verification)

```text
Date: 2026-11-07
Phase: Phase 4 (partial)
Change: Implemented core Inventory Engine foundation and workflows per STATE_MACHINES.md, ADR-015/016/017/020:
  - Prisma/schema + migration `20261028065459_reservation_item_active_claims` (applied to Supabase; partial unique
    index `ReservationItem_unitId_active_unique` on active claims). Existing migrations not edited.
  - Domain: pure unit state machine (STATE_MACHINES + RECALLED terminal) with typed transition validation.
  - Application: InventoryMovementService records append-only movements and unit state changes in one Prisma
    transaction; validates transitions, movement-type/target-state compatibility, and stale-write conflicts
    (updateMany on observed state). ExpiryService provides lazy effective-state classification and bounded
    in-process sweep (ADR-017, no external worker/Redis). ReservationService implements SELECT FOR UPDATE,
    expiry/availability recheck, active-claim check, facility-scoped idempotency, and reservation item creation.
    DonationIntegrationService creates units in QUARANTINED for released donations and requires separate release
    to AVAILABLE (ADR-015). ComponentType/StorageLocation/Unit/summary/expiring/reconciliation services.
  - Presentation: /api/v1/inventory endpoints (units, summary, expiring, move, quarantine, discard, reconcile,
    movements, component-types, storage-locations) with RequireAnywhere permissions, CSRF on mutations, envelope
    responses, and facility-scope masking (404) for non-global actors.
  - Seed/global setup: idempotent default component types added (does not run against Supabase automatically).
  - Integration: DonationsModule imports InventoryModule; DonationService.release() triggers idempotent
    inventory unit creation per ADR-015 (post-release step; atomicity with donation state transition is a known
    limitation to harden in a follow-up transaction refactor).

Verification commands (run in this environment):
  cd apps/api; npx vitest run --config vitest.config.noglobal.tmp.ts-equivalent (globalSetup temporarily
    disabled due to DB connectivity failure) src/modules/inventory src/modules/donors/domain
    src/modules/campaigns/domain src/modules/donations/domain
  cd apps/api; npx tsc --noEmit -p tsconfig.json
  cd apps/api; npm run build

Result:
  Targeted unit tests: 9 files, 88 tests passed (inventory domain 12, movement 7, expiry 3, reservation 3,
    donation-integration 3, plus existing donors/campaigns/donations domain suites 60).
  TypeScript: clean (noEmit).
  API build: success (nest build).

Known limitations / blockers (not claimed complete):
  (1) Full API unit suite and e2e/integration suites could not run: vitest globalSetup failed connecting to
      Supabase (Prisma ENOTFOUND/FATAL tenant error in this environment). Shared dev DB is also unsafe for
      genuine concurrency tests; no isolated test database was available.
  (2) DB-level concurrency/invariant proof not executed in this session: partial unique active-claim index is
      applied (verified earlier via migration/catalog checks) and reservation service uses FOR UPDATE + recheck,
      but "concurrency tests pass" and "no negative/duplicate available inventory invariant passes" remain
      unverified at DB level.
  (3) Inventory audit events (AuditEvent records) are not emitted for all inventory commands; immutable
      movement history is implemented and exposed.
  (4) Donation release -> inventory unit creation is not wrapped in the same DB transaction as donation state
      transition (pre-existing donation release flow); idempotent creation mitigates but does not eliminate
      partial-completion risk.
  (5) Reservation API endpoints/workflows beyond locking strategy are Phase 5 scope; service exists.
  (6) Reconciliation is a corrective append-only movement path; fine-grained policy for authorized corrections
      may need ADR clarification.
  (7) No migrations created in this slice; none applied automatically.

Decision/ADR reference: ADR-015, ADR-016, ADR-017, ADR-020.
```

### Phase 4 finalization pass (2026-11-07, continued)

```text
Date: 2026-11-07 (finalization)
Phase: Phase 4 (verification hardening; DB concurrency still blocked)
Change (Phase 4 files only; no unrelated user changes touched):
  - Fixed DonationIntegrationService to propagate Prisma tx into InventoryMovementService.recordMovement (required for ADR-015 atomicity).
  - Made donation release atomic (ADR-015): DonationService.release() now runs donation QUARANTINED->RELEASED CAS + inventory unit creation inside one Prisma $transaction; audit recorded after commit (existing pattern). Idempotent unit creation preserved.
  - InventoryController: added AuditEvent emission (AuditService) for move/quarantine/discard/reconcile; discard and reconcile require explicit reason (safety/audit). InventoryModule imports AuditModule. Reconciliation still enforces state machine via movement service and appends immutable movement records.
  - Added genuine PostgreSQL integration/concurrency test spec: apps/api/test/inventory-concurrency.e2e-spec.ts. Covers same-unit concurrent reservations (exactly-one-winner), same idempotency key retries, different idempotency keys same unit, expired-unit rejection, DB-level partial unique active-claim rejection, facility isolation, multi-attempt invariant, and tx rollback atomicity. Safety: skipped unless TEST_DATABASE_URL is set and non-Supabase; never uses production/shared Supabase.

Verification commands (this pass):
  cd apps/api; npx vitest run --config vitest.config.unit-nodb.tmp.ts (temporary, deleted after run; globalSetup skipped due to unreachable DB in environment)
  cd apps/api; npx tsc --noEmit -p tsconfig.json
  cd apps/api; npm run build

Result:
  API unit tests (src/**/*.spec.ts, no-DB run): 17 files, 141 tests passed, 0 failed. Includes all inventory unit specs and existing donors/campaigns/donations/auth/RBAC-adjacent unit/domain suites present under src/.
  TypeScript noEmit: clean.
  API build (nest build): success.
  E2E/integration (test/*.e2e-spec.ts, including auth/rbac/donor-donation/health and new inventory-concurrency): NOT EXECUTED — blocked (see below).

Environment blockers (genuine):
  - Docker daemon unreachable: `docker ps` failed with "open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified". Cannot start isolated local PostgreSQL from docker-compose in this environment.
  - Vitest globalSetup (apps/api/test/global-setup.ts) requires DB connectivity and failed earlier with Prisma ENOTFOUND/FATAL tenant error against configured DB; shared/prod/Supabase data must not be used for concurrency tests.
  - Therefore: PostgreSQL integration/concurrency tests are written but not executed; "concurrency tests pass" and "no negative/duplicate available inventory invariant passes" cannot be marked [x] without isolated DB execution.

Preserved: existing deployed migrations not edited; no destructive DB commands; no migrations applied to Supabase; no schema changes created; no secrets exposed; unrelated user changes not staged/reverted.
```

### Phase 4 verification completed (isolated PostgreSQL, 2026-11-07)

```text
Date: 2026-11-07 (verification completed)
Environment (isolated test DB only): Docker container `hemavault-test-db` (postgres:16), localhost:5433, database `hemavault_test`. DATABASE_URL/DIRECT_URL/TEST_DATABASE_URL pointed to this DB for test commands only; production/Supabase env files were not modified and no migrations/tests were run against Supabase.
Safety checks: confirmed effective Prisma host localhost:5433 before migrations; used `prisma migrate deploy` (existing migrations only).

Migrations applied to isolated DB (deploy): 20260921000000_init, 20260921083607_phase1_auth, 20260925065532_phase2_rbac, 20260925080626_phase3_donors_donations, 20261028065459_reservation_item_active_claims.

Fixes during verification (test-revealed / ADR-015 integration):
  - DonationIntegrationService.createUnitsForReleasedDonation: create unit in COLLECTED then transition to QUARANTINED via movement service (fixes INVENTORY_UNIT_TRANSITION_SAME_STATE; state machine forbids same-state; preserves append-only movement/atomicity under tx).
  - test/inventory-concurrency.e2e-spec.ts: aligned fixtures to schema (DonorProfile requires userId+name; BloodGroup enum O_POS; removed unused imports; isolated cleanup).
  - test/donor-donation.e2e-spec.ts: teardown cleanup updated to delete inventory movements/reservation items/reservations/units created by ADR-015 before donations, and broadened registration/donation scopes; no test assertions weakened.

Commands/results (isolated DB):
  prisma migrate deploy — 5 migrations applied successfully to hemavault_test@localhost:5433.
  npx vitest run test/inventory-concurrency.e2e-spec.ts — 1 file, 8 tests passed.
  npm run test:unit — 17 files, 141 tests passed.
  npm run test:e2e — 5 files, 83 tests passed (health 4, auth 12, rbac 27, donor-donation 32, inventory-concurrency 8).
  npm test — 22 files, 224 tests passed, 0 failed.
  npx tsc --noEmit -p tsconfig.json — clean.
  npm run build — success.

Acceptance outcome: Phase 4 inventory-engine criteria verified, including DB-level concurrency/invariant tests and full API regression (units 141 + e2e 83). Reconciliation remains a minimal corrective append-only path with auth/scope/reason/AuditEvent; further policy refinement may be ADR-driven but does not block the documented Phase 4 acceptance set above.
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

### Phase 5 Step 1 — Domain/contracts alignment + schema design (2026-11-08)

```text
Date: 2026-11-08
Phase: Phase 5 Step 1 (domain/contracts alignment and schema design only; NO request/reservation/issuance implementation)
Approved defaults applied: explicit CONFIRMED reservation semantics (ADR-038); request-scoped reservation commands per API_CONTRACT (ADR-038); versioned compatibility engine with NO invented clinical values, non-clinical fixtures only until authoritative review (ADR-040/ADR-018); backend/API first (frontend deferred); isolated local PostgreSQL only, never Supabase.

Decisions/ADRs recorded (DECISIONS.md): ADR-038 (ReservationStatus CONFIRMED, transitions, confirm semantics, request-scoped commands, nullable Reservation.requestId FK for safe rollout), ADR-039 (BloodRequest/BloodRequestLine, urgency/status lifecycle alignment, Issuance/IssuanceItem, fulfillment counters/traceability, ruleSetVersion, emergency escalation metadata), ADR-040 (CompatibilityRuleSet/CompatibilityRule, provenance/approval metadata, isNonClinicalFixture; production matching blocked pending approved reference data), ADR-041 (unit-state-machine already covers RESERVED->ISSUED, ISSUED->USED/CLOSED; no Step 1 change).

Schema changes (apps/api/prisma/schema.prisma; preserves pre-existing Phase 4/local modifications):
  - ReservationStatus: added CONFIRMED.
  - Reservation: added confirmedAt, ruleSetVersion, metadata, request relation to BloodRequest, issuances relation.
  - User/Facility: added Phase 5 back-relations (bloodRequestsCreated/issuancesCreated, bloodRequests/issuances).
  - New enums: RequestUrgency, BloodRequestStatus, IssuanceStatus, CompatibilityRuleSetStatus.
  - New models: BloodRequest, BloodRequestLine, Issuance, IssuanceItem, CompatibilityRuleSet, CompatibilityRule.
  - Back-relations added: ComponentType.requestLines/compatibilityRules, BloodComponentUnit.issuanceItems, ReservationItem.issuanceItems.

Migration (forward-only, new; historical migrations unchanged):
  - Created apps/api/prisma/migrations/20261108120000_phase5_domain_contracts_step1/migration.sql
  - NOT DB-VERIFIED (blocker): Docker Desktop service stopped (com.docker.service Stopped); Docker daemon unavailable, so isolated local PostgreSQL (hemavault-test-db) could not be started/used in this session. Migration has NOT been applied to any database and MUST be verified against isolated local PostgreSQL (migrate deploy/status, schema matches, tests) before further Phase 5 implementation. NEVER deploy to Supabase. Review ALTER TYPE ADD VALUE IF NOT EXISTS 'CONFIRMED' behavior under Prisma migrate transaction semantics on verification.

Validation run (no DB / no Supabase):
  - prisma validate: PASS (schema valid).
  - prisma format: PASS.
  - prisma generate (Prisma Client v6.19.3): PASS.
  - apps/api tsc --noEmit -p tsconfig.json: PASS.
  - apps/api npm run build (nest build): PASS.
  - web npm run build -w @blood-ops/web: PASS.
  - apps/api npm run test:unit: BLOCKED in this environment — vitest globalSetup (test/global-setup.ts) seeds via Prisma and resolved DATABASE_URL to Supabase host (ENOTFOUND / tenant not found from .env); I did not override to Supabase and did not run against shared/prod DB. No src code changes were made in Step 1 (schema/ADRs/migration/docs only), and tsc/build pass; full unit/e2e regression MUST be re-run against isolated local DB once Docker/local DB is available.

Working tree (preserved unrelated pre-existing changes): D apps/api/.env.example, M apps/api/package.json, M apps/api/prisma.config.ts, M apps/api/prisma/schema.prisma, D apps/web/.env.example, M package-lock.json. Step 1 changes: M DECISIONS.md, M PROGRESS.md, M apps/api/prisma/schema.prisma (additive Phase 5 design on top of existing local modifications), A apps/api/prisma/migrations/20261108120000_phase5_domain_contracts_step1/migration.sql, ?? docs/PHASE_5_PLAN.md (from planning). No historical migrations modified. No secrets exposed.

Remaining blockers before Step 2 (resolved for Step 1 DB verification on 2026-11-08): see "Phase 5 Step 1 migration verification" entry below.
```

### Phase 5 Step 1 migration verification (2026-11-08)

```text
Date: 2026-11-08
Phase: Phase 5 Step 1 verification (DB)
Environment (isolated local PostgreSQL only; NEVER Supabase): Docker container `hemavault-test-db` (postgres:16-alpine), host `localhost:5433`, database `hemavault_test`, dedicated test credentials. Process env for commands: DATABASE_URL/DIRECT_URL/TEST_DATABASE_URL all pointed to `postgresql://hemavault:***@localhost:5433/hemavault_test?schema=public`. Effective host/port positively verified as `localhost:5433` via Prisma config resolution before any DB mutation. No .env files overwritten/printed; no Supabase migration/test run.

Migration: apps/api/prisma/migrations/20261108120000_phase5_domain_contracts_step1/migration.sql (forward-only; historical migrations unchanged). Reviewed SQL vs schema: additive enums/tables/indexes/FKs for CONFIRMED, BloodRequest/Line, Issuance/Item, CompatibilityRuleSet/Rule, Reservation request linkage; no DROP/TRUNCATE/DELETE/destructive DDL. Phase 4 partial unique index `ReservationItem_unitId_active_unique` preserved.

Commands/results:
  prisma validate — schema valid.
  prisma migrate status — 6 migrations found; 20261108120000_phase5_domain_contracts_step1 pending before deploy.
  prisma migrate deploy (isolated DB only) — applied 20261108120000_phase5_domain_contracts_step1 successfully; "All migrations have been successfully applied."
  prisma migrate status — "Database schema is up to date!" (6 migrations).

Catalog verification (read-only psql against isolated DB):
  ReservationStatus enum labels (in order): ACTIVE, CONVERTED_TO_ISSUANCE, RELEASED, CANCELLED, EXPIRED, CONFIRMED (additive; DB enum order shows CONFIRMED appended).
  Phase 5 tables present: BloodRequest, BloodRequestLine, CompatibilityRule, CompatibilityRuleSet, Issuance, IssuanceItem.
  Reservation additive columns present (nullable as designed): confirmedAt, metadata, requestId, ruleSetVersion.
  FK present: Reservation_requestId_fkey.
  Phase 4 index preserved: ReservationItem_unitId_active_unique (unique, unitId WHERE isActive=true).

Stage 3 regression (isolated DB): npm run test:unit — 17 files/141 passed; npm run test:e2e — 5 files/83 passed (incl. inventory-concurrency 8); npm test — 22 files/224 passed, 0 failed; npx tsc --noEmit -p tsconfig.json — clean; npm run build — success.

Conclusion: Step 1 migration verification complete on isolated local PostgreSQL. No Supabase deployment performed. Remaining blocker for production compatibility matching: approved clinical reference data (ADR-040).
```

### Phase 5 Step 2 — Request domain + persistence lifecycle (2026-11-08)

```text
Date: 2026-11-08
Phase: Phase 5 Step 2 (request domain + persistence lifecycle; backend/API first)
Scope implemented: apps/api/src/modules/requests/** (domain state machine/constants/errors, DTOs create/update/reject/cancel/list query, repository, RequestService lifecycle, RequestsController), app.module wiring. Endpoints per API_CONTRACT subset: POST/GET/PATCH /api/v1/requests, GET /api/v1/requests/:requestId, POST /requests/:id/submit|approve|reject|cancel. /matches deferred (Step 3).

Key behavior/safety: pure request state machine aligned to STATE_MACHINES; terminal states not reopened; draft-only mutable fields; line/quantity invariants validated (DTO + service); server-side RBAC (request.self.create/read/approve/reject/cancel/review as applicable), facility isolation with 404 masking for out-of-scope resources, CSRF on mutations, structured envelopes/meta.requestId, audit events for create/update/submit/approve/reject/cancel, emergency escalation timestamp metadata for EMERGENCY/CRITICAL (no clinical/safety bypass). Pragmatic contract gap: no /review route in API_CONTRACT; approve/reject perform valid auditable compound transitions (SUBMITTED->UNDER_REVIEW->APPROVED/REJECTED) via conditional status updates.

Tests added: src/modules/requests/domain/request-state-machine.spec.ts, src/modules/requests/application/request.service.spec.ts, test/requests.e2e-spec.ts (isolated local DB). Coverage includes domain transitions, lifecycle, persistence/API flow, facility isolation/404 masking, RBAC/CSRF, invalid transitions, quantity invariants, transaction rollback/DB invariants.

Verification (isolated localhost:5433 only, host verified):
  npx vitest run src/modules/requests — 2 files/16 passed.
  npm run test:unit — 19 files/157 passed.
  npm run test:e2e — 6 files/100 passed (health 4, auth 12, rbac 27, donor-donation 32, inventory-concurrency 8, requests 17).
  npm test — 25 files/257 passed, 0 failed.
  npx tsc --noEmit -p tsconfig.json — clean.
  npm run build (nest build) — success.

Acceptance (Step 2): request create/read/update/list, lifecycle submit/approve/reject/cancel, priority/urgency, facility isolation/RBAC/CSRF/validation/audit, invalid-transition and quantity guards, tx rollback invariant test — verified. Not implemented/deferred: matching (Step 3), request-scoped reservations/issuance/fulfillment commands (Steps 4–5), full emergency alert delivery (Phase 6), frontend, approved clinical compatibility values (ADR-040 blocker).
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
