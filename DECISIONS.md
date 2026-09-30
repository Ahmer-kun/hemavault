# Architecture Decision Record (ADR) Log

This file records decisions that affect architecture, product behavior, security, or data integrity.

## ADR-001 — Greenfield rebuild

**Status:** Accepted

The supplied application is a reference baseline only. The target system will be independently implemented.

**Reason:** The goal is a maintainable product with a coherent architecture rather than an incremental patch of a student-oriented codebase.

## ADR-002 — Modular monolith first

**Status:** Accepted

Start as a modular monolith. Separate services require a concrete scalability, security, or operational reason.

**Reason:** The product has strong cross-domain transactions and benefits from simpler local development and consistent data integrity.

## ADR-003 — PostgreSQL + Prisma

**Status:** Accepted

Use PostgreSQL as the primary database and Prisma as the data-access/migration layer.

**Reason:** Requests, reservations, inventory movements, facilities, users, donations, and transfers are strongly relational and transaction-heavy.

## ADR-004 — TypeScript end-to-end

**Status:** Accepted

Use TypeScript across backend and frontend.

**Reason:** Shared contracts, strict typing, safer refactoring, and domain-heavy logic.

## ADR-005 — Server-side browser sessions

**Status:** Accepted

Use secure HTTP-only SameSite browser sessions instead of storing bearer tokens in browser storage.

**Reason:** Reduce the impact of token exfiltration through XSS and centralize revocation/session control.

## ADR-006 — Unit-level inventory

**Status:** Accepted

Inventory is modeled as discrete component units, not only aggregate blood-group quantities.

**Reason:** Reservation, expiry, quarantine, transfers, auditability, and issuance require unit identity and lifecycle state.

## ADR-007 — Immutable movement ledger

**Status:** Accepted

Inventory changes are represented by immutable movement events and valid state transitions.

**Reason:** A quantity field alone cannot provide a trustworthy audit trail or explain how stock changed.

## ADR-008 — Permission-based authorization

**Status:** Accepted

Roles map to permissions. Server-side policies enforce permissions.

**Reason:** Future roles and facility-scoped permissions should not require rewriting route guards.

## ADR-009 — REST + OpenAPI; WebSockets selectively

**Status:** Accepted

Use versioned REST for core application commands/queries. Use WebSockets only for events that materially benefit from live push.

**Reason:** REST is easier to test/document; real-time is useful for operational alerts but should not become an unnecessary architecture dependency.

## ADR-010 — No paid provider dependency

**Status:** Accepted

Core development must work without paid external services.

**Reason:** The project budget is zero and the application should remain portable.

## ADR-011 — Medical rules are configurable and human-validated

**Status:** Accepted

Medical compatibility, eligibility, deferral, expiry, and related rules must be configurable, documented, and reviewed against authoritative sources before production use.

**Reason:** These rules are domain/safety-sensitive and should not be invented by the implementation agent.

## ADR-012 — Data minimization

**Status:** Accepted

Store only personal/clinical information necessary for the product's stated operational workflows. Prefer pseudonymous hospital patient references over unnecessary patient-identifying information.

**Reason:** Reduce privacy risk and avoid building an unnecessary clinical record system.

## ADR-013 — No premature Redis/queue/microservice dependency

**Status:** Accepted

Introduce Redis/background workers/microservices only after a concrete requirement is recorded.

**Reason:** Start with the simplest architecture that can maintain correctness.

## ADR-014 — Status/state machines are explicit domain rules

**Status:** Accepted

Every workflow with consequential transitions has explicit allowed transitions and test coverage.

**Reason:** Prevent invalid state combinations and accidental business-rule bypass.

## ADR-015 — Donation release creates units; per-unit release to AVAILABLE

**Status:** Accepted

**Context:** `MASTER_PROMPT.md` lists a unit lifecycle containing `SCREENING`/`RELEASED`, while `docs/STATE_MACHINES.md` (authoritative) defines the inventory unit machine as `COLLECTED → QUARANTINED → AVAILABLE ...` with no per-unit screening/release states. `docs/PRODUCT_REQUIREMENTS.md` still requires each component unit to carry its own screening/release status.

**Decision:** Donation-level screening/release (donation machine) is the aggregate gate. When a donation is released, its component units are created transactionally; units enter the inventory machine in `QUARANTINED`. An explicit per-unit `QUARANTINED → AVAILABLE` release action (permission `donation.release`-adjacent, e.g. `inventory` release) makes units allocatable. Donation rejection rejects all units created from it. Unit `COLLECTED` remains a valid initial state for directly ingested whole-blood units and for externally sourced intake; the documented unit machine is implemented exactly as written.

**Alternatives considered:** Per-unit parallel screening machine. Adds a duplicated permission set and diverges from `STATE_MACHINES.md`.

**Consequences:** One screening authority per donation; unit state machine stays minimal.

**Verification:** State-transition unit tests; donation-release integration test shows units in `QUARANTINED`; release action makes them `AVAILABLE`; rejected donation yields no allocatable units.

## ADR-016 — RECALLED is added to the unit state machine

**Status:** Accepted

**Context:** `RECALLED` is referenced as a non-allocatable terminal state in `MASTER_PROMPT.md`, `docs/DOMAIN_MODEL.md`, and `docs/ACCEPTANCE_CRITERIA.md`, but `docs/STATE_MACHINES.md` defines no transitions into it.

**Decision:** Add transitions `AVAILABLE → RECALLED`, `QUARANTINED → RECALLED`, and `RESERVED → RECALLED` where policy explicitly permits recall of reserved units. `RECALLED` is terminal except for reconciliation-adjustment corrections performed by authorized administrators through the documented reconciliation workflow. Recalled units are never allocatable and never issuable.

**Alternatives considered:** Modeling recall only as a note on units.

**Consequences:** `RECALLED` becomes an explicit, tested state.

**Verification:** Unit tests for each recall transition and for the non-allocatability of recalled units.

## ADR-017 — Expiry handled lazily plus in-process sweep; no external worker

**Status:** Accepted

**Context:** Expiration must be enforced, but `ADR-013` forbids Redis/queues/workers without a concrete requirement.

**Decision:** Units whose `expiresAt` has passed are classified `EXPIRED` in the domain/query layer when read (effective-state computation limited to allocatable states), and a bounded periodic in-process sweep inside the monolith persists `EXPIRED` movement events. Expired units are never allocatable or issuable regardless of the sweep state. Removal remains a controlled discard workflow.

**Alternatives considered:** Dedicated worker service (rejected, no requirement yet).

**Consequences:** Reads are authoritative even if the sweep is delayed.

**Verification:** Unit tests for classification; integration test that over-due units are excluded from matching before any sweep runs.

## ADR-018 — Reference compatibility/component data seeded as versioned, human-reviewed configuration

**Status:** Accepted

**Context:** `docs/MEDICAL_POLICY_BOUNDARY.md` requires versioned reference configuration and forbids inventing policy in application code; this is an operational decision-support platform, not a clinical decision-maker.

**Decision:** Seed the default ABO/Rh red-cell compatibility matrix and component-type catalogue as reference configuration rows from widely standardized reference material (e.g., AABB transfusion guidelines), versioned in `compatibility_rule_sets`/`compatibility_rules`. Every allocation records which rule-set version was used. The UI labels matches as operational suggestions, not clinical approvals, and issuance always requires authorized human confirmation. Production readiness requires a documented clinical review sign-off of the seeded reference values.

**Alternatives considered:** Hardcoding matrices in code (violates ADR-011); leaving matrices empty (feature unusable).

**Consequences:** Configurable, auditable, traceable matching; clinical-review step recorded for production.

**Verification:** Rule lookup unit tests; integration test that allocation persists the rule-set version; seeding idempotent.

## ADR-019 — Email provider is an adapter with a default dev transport

**Status:** Accepted

**Context:** Email verification and password reset are required; `ADR-010` forbids paid provider dependence for core correctness.

**Decision:** Define an `EmailProvider` interface. Default development transport writes messages to structured logs/console; a configurable SMTP/HTTP adapter can be supplied by deployment. Verification/reset tokens are single-use, expiring, and stored hashed.

**Alternatives considered:** Blocking on a real provider.

**Consequences:** Local flows work at $0; production email is an ops decision.

**Verification:** Unit tests for token hashing/expiry/single-use; integration test that verification completes via dev transport.

## ADR-020 — Reservation concurrency: row locks + partial unique index + idempotency key

**Status:** Accepted

**Context:** `docs/STATE_MACHINES.md` and `docs/TESTING_STRATEGY.md` require safe concurrent reservation with exactly-one-winner semantics.

**Decision:** Reservations execute in an interactive Prisma transaction: candidate unit rows are locked (`SELECT ... FOR UPDATE` via raw query inside the tx), state/expiry/facility are re-checked under the lock, a partial unique index enforces one active reservation per unit, and the reservation command accepts a client idempotency key so safe retries do not duplicate claims.

**Alternatives considered:** Optimistic concurrency only (unsafe for the final-unit case).

**Consequences:** Deterministic single-winner; clean business errors on contention.

**Verification:** Concurrency integration tests (two simultaneous reservation attempts on the final eligible unit), idempotent retry test.

## ADR-021 — Emergency workflow is priority + alerting + expedited review, never a rule bypass

**Status:** Accepted

**Context:** `docs/PRODUCT_REQUIREMENTS.md` defines `EMERGENCY`/`CRITICAL` urgency; the medical boundary forbids autonomous clinical authority.

**Decision:** Emergency/critical requests elevate priority, disable availability _hints_ when eligible inventory is insufficient, create immediate notifications/realtime alerts, and allow expedited review/approval by authorized staff. They never bypass compatibility, eligibility, expiry, quarantine, facility scope, or the requirement for authorized human confirmation.

**Alternatives considered:** Emergency override that skips compatibility checks (rejected as safety-hostile).

**Consequences:** Visibly flagged, actionable emergencies with intact safety posture.

**Verification:** API tests that emergency requests cannot self-approve or use ineligible units.

## ADR-022 — Multi-facility resources use union-of-scope authorization

**Status:** Accepted

**Context:** Transfers span a source and a destination facility, so facility-scoped authorization must account for both, and `docs/ARCHITECTURE.md` forbids scattering role checks.

**Decision:** For resources with two facility scopes (e.g., transfer source/destination), an actor may operate when they hold the required permission at either relevant facility and the transition's semantic role matches (source facility packs/dispatches, destination receives). Centralized policy evaluation engine answers `can actor X perform Y on resource Z in facility F at state S`.

**Alternatives considered:** Restricting transfers to the source facility only (blocks legitimate receipt workflows).

**Consequences:** One policy implementation covers single- and multi-facility resources.

**Verification:** Authorization tests for cross-facility transfer access from both sides and from an unrelated facility.

## ADR-023 — Workspace and toolchain baseline

**Status:** Accepted

**Context:** Phase 0 establishes the repository/workspace convention. The local toolchain is Node v20.19.0 (Windows), npm 10.8.2, Docker Desktop 29.2.1. NestJS 12 requires Node >=22.22.3 for its schematics toolchain and cannot run on this machine.

**Decision:** Use an npm-workspaces monorepo at the repository root with `apps/api` (NestJS 11 modular monolith, TypeScript strict, Prisma 6, zod env validation, vitest + supertest) and `apps/web` (React 19 + Vite + Tailwind v4, TanStack Query, vitest + Testing Library). Root scripts orchestrate build/typecheck/lint/test/format and `db:*` compose commands. Stay on NestJS 11 while local Node is v20; revisit Nest 12 when a Node >=22 toolchain is available. Keep the multer pin via npm overrides because `@nestjs/platform-express@11.2.5` pins `multer@2.2.0` exactly and the DoS advisory (GHSA-m3q1-6xrc-fq7f) is fixed only in 2.3.0+.

**Alternatives considered:** NestJS 12 upgrade (blocked by Node version); Yarn/Pnpm (unnecessary migration now); single non-workspace repo (duplicated tooling later).

**Consequences:** Reproducible CI from the workspace root; dependency-of-record versions pinned in the root package-lock; Prisma 6 line requires `prisma.config.ts` to avoid the removed `package.json#prisma` config.

**Verification:** `npm ci` from clean checkout; `npm run typecheck/lint/build/test`; docker compose Postgres; docker builds of `apps/api` and `apps/web`.

## ADR-024 — Structured API envelope, request IDs, and SWC for NestJS test metadata

**Status:** Accepted

**Context:** Phase 0 must lock the API response contract, request correlation, and a test toolchain that keeps NestJS DI working under vitest. The web dev proxy needs predictable health/meta endpoints for the Phase 0 status view.

**Decision:** (1) Success responses use `{ data, meta: { requestId } }`; errors use `{ error: { code, message, details, requestId } }` with an allowlisted code map. (2) A middleware generates an RFC-4122 `X-Request-ID` for every request and the global exception filter surfaces it in errors. (3) Health is served under `/health` (outside `/api/v1`) so infrastructure and the browser proxy can probe it without a versioned contract; system metadata lives at `/api/v1/meta`. (4) Because vitest/esbuild do not emit `design:paramtypes` decorator metadata, the API test plan uses `unplugin-swc` (SWC) in vitest config so Nest DI resolves in tests; this is test-tooling only and does not change runtime builds.

**Alternatives considered:** Bearer-token health checks (overkill); hardcoding request id in every controller (duplication); ts-jest (slower, and vitest 4 is the workspace standard).

**Consequences:** Deterministic error contract for the client; correlation across logs/tests; one DI pipeline for unit and e2e tests.

**Verification:** e2e `test/health.e2e-spec.ts` asserts live/ready/meta/404 envelopes and `X-Request-ID`; runtime curl checks recorded in PROGRESS.md.

## ADR-025 — Argon2id password hashing with OWASP-aligned parameters

**Status:** Accepted

**Context:** Phase 1 requires a modern password-hashing algorithm approved in an ADR. Raw bcrypt deployments were considered, but Argon2id is the current recommended password hash and resistance to GPU-parallel attacks is higher per unit of memory.

**Decision:** Passwords are hashed with Argon2id via `@node-rs/argon2` (native binding, verified working on the local Windows toolchain) using `memoryCost=19456` KiB, `timeCost=2`, `parallelism=1` — meeting the OWASP-recognized minimum (19 MiB, 2 iterations). Verification is constant-time and malformed stored hashes are treated as failed verifications (never a crash or an enumeration oracle). A future upgrade path to a configurable cost is noted in Phase 9 hardening.

**Alternatives considered:** bcrypt (lower memory-hardness per unit cost); scrypt (less portable); pure-JS argon2 (slow).

**Consequences:** Strong, portable hashing at an acceptable latency (~50–150 ms on dev hardware); e2e exercises it against a live DB.

**Verification:** \(unit) hasher round-trips; e2e asserts stored value starts with `$argon2id` and is not the plaintext.

## ADR-026 — DB-backed sessions with rotation, revocation, and CSRF synchronizer token

**Status:** Accepted

**Context:** ADR-005 chose server-side browser sessions. Phase 1 must define the concrete session model and the CSRF strategy because state-changing requests require an explicit defense beyond `SameSite=Lax` (T05).

**Decision:** (1) Clients receive one opaque HTTP-only `SameSite=Lax` cookie containing a 256-bit random token; only its SHA-256 digest is stored in `sessions`. (2) Sessions carry an absolute TTL (default 7 days) and an idle TTL (default 1 hour), enforced on read; `lastUsedAt` is lazily refreshed (throttled to ≥60 s). (3) Each session also holds a random CSRF synchronizer token whose digest is stored; mutating endpoints require the `x-csrf-token` header to match it. (4) Logging in while a valid session cookie for the same user is present rotates that session (old session revoked, `rotatedFromId` recorded). (5) Logout revokes the session; logout-all and password reset revoke all of the user's sessions. Session token values are never echoed in response bodies and never written to logs.

**Alternatives considered:** long-lived stateless JWT (revocation is weak, T02/T05 harder); double-submit cookie CSRF (weaker model).

**Consequences:** Central revocation, rotation on re-auth, and a strong per-session CSRF token.

**Verification:** e2e asserts cookie flags, 401 without session, 403 without  CSRF header, rotation invalidates the old cookie, and reset revokes sessions.

## ADR-027 — Per-account-and-IP auth rate limiting plus failing-login lockout

**Status:** Accepted

**Context:** T01 (brute force / credential stuffing) requires abuse resistance without breaking legitimate multi-account operation from shared NATs.

**Decision:** `@nestjs/throttler` is configured with a custom `getTracker` producing `ip:email` buckets (falls back to `ip` when no email is present). Global default is 100 requests/min; auth endpoints override to tight per-account limits (register 10/min, login 10/min, forgot-password 5/min). Independently, `User.failedLoginCount`/`lockedUntilAt` implement a 5-failure / 15-minute account lockout that is a separate layer from the transport-rate limit. Responses are generic `INVALID_CREDENTIALS` for all login failures to avoid account enumeration (T01).

**Alternatives considered:** IP-only throttling (fragile behind NAT); relying on lockout alone (bypassable across many IPs); returning account-specific errors (enumeration risk).

**Consequences:** Deterministic 429 envelopes (`RATE_LIMITED`) for abuse and a persisted, audited lockout.

**Verification:** e2e "429 after exceeding per-account limit"; e2e "locks the account after 5 failed attempts"; unit tests for `applyLoginFailure` policy.

## ADR-028 — Auth user model: PENDING_VERIFICATION → ACTIVE / DISABLED with email-verified gate

**Status:** Accepted

**Context:** The product requires verified identity for staff accounts (ADR-019 flows), a sanitized user representation, and a defensible reason not to treat registration as instantly trusted.

**Decision:** `User.status` is one of `PENDING_VERIFICATION` (default), `ACTIVE`, `DISABLED` with an allowlisted transition map enforced by the domain layer; only `ACTIVE` users may sign in. `emailVerifiedAt` is set on verification. The `me`/login payload is a safe shape that never includes `passwordHash` or session material. Registration and forgot-password return identical generic messages for existing and non-existing accounts (registration additionally swallows unique-constraint races).

**Alternatives considered:** Auto-Active on signup (unaudited privileged accounts); exposing "email already registered" (enumeration).

**Consequences:** An auditable gated account model; activation requires possession of the emailed verification token.

**Verification:** unit `canTransition`/`isAllowedLoginStatus`; e2e verifies PENDING→ACTIVE and duplicate-registration generic message; login rejects pending accounts.

## ADR-029 — Append-only audit trail with tamper-evident hash chaining

**Status:** Accepted

**Context:** High-impact auth actions (register, verify, login success/failure/blocked, logout, logout-all, forgot/reset) must be auditable (T10) and the audit store should resist undetected tampering with minimal complexity.

**Decision:** `AuditEvent` rows are append-only; each row stores SHA-256 `prevHash` (of the immediately preceding event) and a `hash` over a canonical serialization of its own fields plus `prevHash`, forming a hash chain. `User`/`AuditEvent` is `onDelete: SetNull` so user deletion keeps the horizon honest. Chaining is best-effort under concurrent writes (a race may produce equal `prevHash` links); this is acceptable for Phase 1 and noted for Phase 4+ when movement-ledger auditing uses the same primitive.

**Alternatives considered:** No chaining; external immutable store (no requirement yet).

**Consequences:** Cheap tamper evidence and easy replay verification; cryptographic-grade whole-store integrity is deferred to Phase 9 hardening.

**Verification:** unit tests for digest stability and tamper sensitivity; e2e asserts register/verify/login audit rows exist with 64-hex hashes.

## ADR-030 — RBAC persistence model and catalogue authority

**Status:** Accepted

**Context:** Phase 2 requires permission-based authorization (not scattered role-string checks), facility-scoped access, and an auditable role model. The permission set and role definitions must have a single maintainable source of truth.

**Decision:** `Permission` (code unique), `Role` (code unique, `RoleScope` GLOBAL|FACILITY, `isSystem`), `RolePermission` (unique roleId+permissionId), `UserRole` (global assignments, unique userId+roleId, `assignedById`), and `FacilityMembership` (unique userId+facilityId+roleId, `assignedById`) persist assignments. The authorization catalogue lives in `src/modules/rbac/domain/permission-catalogue.ts`: 54 permission codes, 7 roles, `globalRoles()`/`facilityRoles()`, and `assertCatalogueIntegrity()` (defined exactly once, super-admin covers the full catalogue, no duplicate permissions). The seed (`access-control.seed.ts`) upserts and reconciles permissions/roles/rolePermissions idempotently; it runs via `prisma/seed.ts` and vitest `globalSetup` so tests always see a consistent catalogue. Role assignment endpoints only accept roles from the matching scope allowlist (`globalRoles()` for platform assignment, `facilityRoles()` for memberships). Resource lookups are scoped: global permissions satisfy any-facility checks (`canAtFacility` returns true when the actor holds the permission globally); facility permissions only apply within their facility.

**Alternatives considered:** Role-string equality in guards (violates AGENTS.md allowlist rule); SQL-side permission tables only (no catalogue traceability); scope on `Organization` only (does not cover independent facilities under one org).

**Consequences:** Audit-ready assignments, consistent RBAC across modules, and a verifiable catalogue invariant. Couples future role/permission changes to catalogue edits, which is desirable.

**Verification:** unit `permission-catalogue.spec.ts` (integrity, uniqueness, super-admin rollup, scope partition) + `policy.spec.ts`; e2e covers member/role assignment allowlists and `effectivePermissions` reporting.

## ADR-031 — Centralized PermissionsGuard with resource-scoping semantics (403 vs 404)

**Status:** Accepted

**Context:** AGENTS.md requires server-side authorization for every protected operation and prohibition of UI-hiding-as-authorization, while the threat model demands masking resource existence from unauthorized parties (anti-enumeration).

**Decision:** A single global `PermissionsGuard` runs after `AuthGuard` on every non-`@Public` route. Controllers declare requirements declaratively: `RequireGlobal` (platform-level permission), `RequireAnywhere` (permission present globally or at any facility the actor belongs to), `RequireFacilityScope(permission(s), ':param', anyOf?)` (must satisfy at the specific resource). The guard builds the actor once per request and returns 403 `FORBIDDEN` when the declared permission requirement fails (including out-of-scope facility resources). The application layer additionally re-checks resource existence/scoping and returns 404 for out-of-scope organizations/facilities to avoid leaking ID existence. Public routes bypass the guard.

**Alternatives considered:** Per-route ad-hoc checks in services (duplicated logic, easy to forget); returning 404 for every denial (loses UX clarity for legitimate-but-unauthorized actions per API_CONTRACT).

**Consequences:** Server-enforced authorization with consistent error codes; permission requirements are visible in route metadata (OpenAPI surfaces them); services still enforce scope defensively.

**Verification:** e2e: cross-role 403, cross-facility 403, out-of-scope organization masked as 404 for an in-scope reader, 403 for a reader lacking `organization.read`; me() reports effective permissions.

## ADR-033 — Phase 3 domain model and state machines (donors, campaigns, donations)

**Status:** Accepted

**Context:** Phase 3 introduces donor profiles, blood drives/campaigns, campaign registrations (appointments), donation events, screening records, and donor deferrals. Specs define relationships and a donation state machine but leave exact table fields and several workflows unspecified (`docs/DOMAIN_MODEL.md`, `docs/STATE_MACHINES.md`, `docs/API_CONTRACT.md`).

**Decision:** Persist `DonorProfile` (User 1—0..1 DonorProfile; fields: `publicCode` donor reference, `name`, optional `dateOfBirth`, optional self-reported `bloodGroup`), `BloodDrive` (facility, name, description, location, startsAt/endsAt, targetUnits, capacity, status DRAFT/PUBLISHED/CANCELLED/COMPLETED), `CampaignRegistration` (donor + campaign, unique per donor/campaign, status CONFIRMED/CHECKED_IN/CANCELLED), `Donation` (donor, facility, optional campaignRegistration, `publicCode`, state, timestamps, collection volume/blood group), `DonationScreening` (one per donation, minimal traceability fields), and `DonorDeferral` (set by staff). Donation states implement `docs/STATE_MACHINES.md` verbatim (`SCHEDULED/CHECKED_IN/COLLECTED/SCREENING/QUARANTINED/RELEASED/REJECTED/CANCELLED/COMPLETED`); the machine is a pure tested module and every transition is a compare-and-set guarded update. A campaign check-in simultaneously moves the registration to CHECKED_IN and creates the donation (SCHEDULED→CHECKED_IN) in the same transaction; because the donation is only created at check-in, a CONFIRMED registration never has a linked donation, so registration cancellation affects the booking only. `SCHEDULED→CANCELLED` and `RELEASED→COMPLETED` are defined in the machine but not reachable through Phase 3 endpoints (a standalone donation-cancel endpoint and unit transcription land later); the machine file remains authoritative. Profile blood group is self-reported display data only; the verified group is recorded on the donation/screening and is what future allocation will use.

**Alternatives considered:** Profile merged into `User` (violates domain separation); naive SCHEDULED-only bookings without appointment state; donation-cancel route added to the contract (deferred).

**Consequences:** Contract-faithful endpoint surface; explicit auditable donation lifecycle; inventory hand-off (release → units) lands in Phase 4.

**Verification:** unit state-machine specs for all donation/campaign/registration transitions; e2e covers full donor and staff flows.

## ADR-034 — Donation screening/quarantine decision flow

**Status:** Accepted

**Context:** The donation machine has `COLLECTED→SCREENING`, `SCREENING→QUARANTINED | REJECTED`, `QUARANTINED→RELEASED | REJECTED`. The API surface offers `screen`, `release`, and `reject` commands only, leaving no dedicated `SCREENING→QUARANTINED` decision endpoint.

**Decision:** `POST /donations/:id/screen` is invoked from `COLLECTED` to enter screening (`COLLECTED→SCREENING`), writing the `DonationScreening` record (verified blood group required, minimal note, screenedBy) with result `IN_PROGRESS`. Re-invoking `screen` from `SCREENING` with a decision acts as the screening-result command (`SCREENING→QUARANTINED`). `reject` performs `SCREENING→REJECTED` and `QUARANTINED→REJECTED` (a `reasonCode` is required, referencing a configurable external catalog — free text in Phase 3). `release` performs `QUARANTINED→RELEASED` only. QUARANTINE is therefore always entered via an explicit screening pass; a quarantined/rejected donation can never become available without a valid transition (release is the only path toward Phase 4 unit transcription). Repeat of a completed command returns `409 INVALID_STATE` except check-in, which is idempotent.

**Alternatives considered:** Coalescing SCREENING into the screen command (loses the observable screening state the machine defines); inventing a new decision endpoint outside the contract.

**Consequences:** SCREENING remains an observable operational state; lab staff see exactly `collect → screen → (pass→quarantine | reject)`; the machine file is the single authority.

**Verification:** unit transition table; e2e staff flow covers collect→screen(IN_PROGRESS)→screen(PASS)→quarantine→release and both rejection branches.

## ADR-035 — Donor eligibility and deferral boundary

**Status:** Accepted

**Context:** Acceptance criteria require a donor to "book/cancel eligible campaign appointments". `docs/PRODUCT_REQUIREMENTS.md` is explicit: "Actual medical eligibility criteria are external/configurable policy, not invented in the core code." No eligibility or deferral tables or endpoints exist in the contract.

**Decision:** The core code performs no medical eligibility computation (no min-interval, age, hemoglobin, or shelf-life rules). The only automated booking/check-in gate is an explicit staff-declared `DonorDeferral` (reasonCode referencing a configurable external catalog, optional note, effectiveAt, optional expiresAt, createdBy, resolvable). A donor with an ACTIVE (unresolved and not expired) deferral cannot book a campaign registration or be checked in (409 `DEFERRAL_ACTIVE`). Deferral management is exposed as a deliberate small extension of the donor context (`POST /donors/:id/deferrals`, `POST /donors/:id/deferrals/:deferralId/resolve`, `GET /donors/:id/deferrals`) gated by `donor.update`/`donor.read`, recorded here because the contract does not list it. Human staff remain responsible for all eligibility judgment.

**Alternatives considered:** No deferral gate at all (makes "eligible" unimplementable); timestamp arithmetic pretending to be policy (invents medical rules — prohibited).

**Consequences:** Booking "eligibility" is operational (staff record), never algorithmic; the external policy catalog for reason codes is seeded empty in Phase 3.

**Verification:** unit booking-eligibility spec (deferral active/expired/resolved, capacity, published, window, duplicate); e2e deferral blocks booking then resolves.

## ADR-036 — Donor self-service access and donor/campaign/donation scoping

**Status:** Accepted

**Context:** Donor-facing routes (`/donors/me`, `/donors/me/donations`, campaign browsing/booking) have no natural permission code carrier, and donors hold no facility memberships. Staff donor search must be "permission-controlled and facility-aware"; campaign/donation resources are facility-scoped but their IDs are not facility IDs.

**Decision:** Self-service routes carry NO permission decorator; the global guard passes through and the service authorizes by session ownership (`actor.userId` matches the donor profile's user). The `DONOR` role remains available for UI/effectivePermissions display but Phase 3 authorization never depends on it. Staff routes use `RequireAnywhere` for the relevant code (donor.search for search, donor.read for detail/history, campaign.* / donation.* for their commands) and the service re-checks facility scope against `donation`/`campaign.facilityId`: failure of the declared permission → 403 FORBIDDEN; in-scope permission but out-of-scope resource → 404 NOT_FOUND (masked, per ADR-031). Donor search is facility-aware through a "donor is visible if it has a donation at an actor facility, or globally" rule. `GET /campaigns` is shared: a caller with `campaign.read` sees scoped/all campaigns; any other authenticated caller (e.g. a donor) sees only PUBLISHED campaigns (public listing per `docs/UI_UX_SPEC.md`). PATCH on a campaign accepts a `status` field validated against the campaign machine so "complete" is reachable without a dedicated endpoint.

**Alternatives considered:** Requiring the DONOR role/membership for self-service (adds admin burden with no security gain); one permission code forcing both audiences to the same route semantics (wrong for donors).

**Consequences:** Self-service is safe by ownership; staff scoping matches Phase 2 semantics; donors never observe non-published campaigns.

**Verification:** e2e cross-facility 404/403, donor-vs-staff campaign lists, self-service ownership rejection (donor A cannot read donor B via /donors/me), deferral-gated booking.

## ADR-032 — Platform bootstrap: no auto-created admin, out-of-band first super admin, last-admin invariant

**Status:** Accepted

**Context:** The platform needs at least one `PLATFORM_SUPER_ADMIN` to perform initial setup, but auto-creating a privileged account during seed would be an unflagged trust/security hazard.

**Decision:** No role assignment is created by seed or migration. The first super admin is promoted out-of-band (operator-run script/SQL, recorded here as an operational procedure). `PLATFORM_SUPER_ADMIN` cannot be removed when it is the last remaining one (409 `LAST_SUPER_ADMIN`, checked inside the removal transaction path). Only holders of `user.manage_roles` may assign/remove global roles.

**Alternatives considered:** Seeding a default super-admin account (credential/email risk at deploy time); allowing removal to lock the platform.

**Consequences:** Initial activation requires an operator action; the invariant prevents irreversible lockout. (Elevation for a *non-active* account is disallowed because only ACTIVE users sign in, so the first assignment targets an ACTIVE verified user.)

**Verification:** e2e assigns the first super admin via direct DB row (simulating the out-of-band bootstrap), then exercises role management over the API; last-super-admin removal returns 409 `LAST_SUPER_ADMIN`.

## ADR-037 — Business-rule validation lives in the domain; DTOs only whitelist shapes

**Status:** Accepted

**Context:** Mutating donation endpoints (collect, reject) originally required `bloodGroup`/`reasonCode` in their DTOs, so missing values failed class-validator with a generic `BAD_REQUEST` instead of the domain's structured codes (`BLOOD_GROUP_REQUIRED`, `VOLUME_REQUIRED`, `REJECT_REASON_REQUIRED`).

**Decision:** DTO validation is limited to shape coercion and sanity ranges (types, integer/ISO8601/string, min/max bounds). Presence rules that carry business meaning are enforced by the domain (service) layer, which emits structured error codes. This applies to `CollectDonationDto.volumeMl/bloodGroup` and `RejectDonationDto.reasonCode` being optional, mirroring `CreateDonationDto`.

**Alternatives considered:** Keeping the fields required at the DTO and mapping validator messages to codes (fragile message coupling); handling presence in a custom validator class (more machinery without domain benefit).

**Consequences:** Clients receive consistent, documented error codes for rule violations; DTOs stay thin whitelists; domain rules remain testable by unit tests without HTTP. A malformed non-null value still fails validation (type/syntax), only genuine absence reaches the business-rule path.

**Verification:** e2e asserts `BLOOD_GROUP_REQUIRED`, `SCREEN_DECISION_REQUIRED`, and `REJECT_REASON_REQUIRED` codes; unit specs cover the service-level rules directly.

## ADR template

### ADR-XXX — Title

**Status:** Proposed / Accepted / Superseded / Rejected

**Context:**

**Decision:**

**Alternatives considered:**

**Consequences:**

**Verification:**
