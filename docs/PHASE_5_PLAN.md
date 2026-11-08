# Phase 5 Plan — Requests, Matching, Reservation, Issuance

**Status:** Planning complete (2026-11-07). Step 1 (schema/contracts) and Step 2 (request lifecycle, backend/API) implemented and verified 2026-11-08. **Step 3 (compatibility engine + matching API, backend/API) implemented and verified 2026-11-08** on isolated local PostgreSQL only (localhost:5433, hemavault_test; no Supabase). Steps 4+ not started. Production compatibility matching remains disabled pending approved, human-reviewed clinical reference data (ADR-018/040/042).

**Planning date:** 2026-11-07  
**Base commit (verified):** `effb734` — `feat(inventory): complete Phase 4 inventory engine with verified concurrency` (API 224/224 tests, tsc clean, build passing, 8/8 PG concurrency tests on isolated local DB).  
**Step 1/2/3 verification (2026-11-08, isolated local PostgreSQL only):** `hemavault-test-db` (`postgres:16-alpine`), `localhost:5433`, `hemavault_test`; `DATABASE_URL`/`DIRECT_URL`/`TEST_DATABASE_URL` pointed to isolated DB and host positively verified before DB mutations. Migration `20261108120000_phase5_domain_contracts_step1` applied to isolated DB only (`prisma migrate deploy`); catalog verified (ReservationStatus includes `CONFIRMED` appended; Phase 5 tables/FKs/additive Reservation columns present; Phase 4 partial unique index preserved). **No new migrations for Step 3; never deployed to Supabase.** Final regression after Step 3: `npm test` **30 files/290 passed, 0 failed** (unit 23/181, e2e 7/109 incl. requests 17, request-matching 9, inventory-concurrency 8); `tsc --noEmit` clean; `nest build` success.  
**Authoritative inputs reviewed:** `PROGRESS.md`, `MASTER_PROMPT.md`, `DECISIONS.md` (ADR-001–037), `docs/PROJECT_CHARTER.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCT_REQUIREMENTS.md`, `docs/DOMAIN_MODEL.md`, `docs/STATE_MACHINES.md`, `docs/API_CONTRACT.md`, `docs/RBAC_MATRIX.md`, `docs/SECURITY_THREAT_MODEL.md`, `docs/UI_UX_SPEC.md`, `docs/TESTING_STRATEGY.md`, `docs/ACCEPTANCE_CRITERIA.md`, `docs/MEDICAL_POLICY_BOUNDARY.md`, `docs/DATABASE_DESIGN.md` (if consulted), `apps/api/prisma/schema.prisma`, `apps/api/src/app.module.ts`, existing `inventory`/`rbac`/`donations` modules, `apps/web/src/*`.

**Pre-existing unrelated working-tree changes (must be preserved; not part of Phase 5 planning):** `D apps/api/.env.example`, `M apps/api/package.json`, `M apps/api/prisma.config.ts`, `M apps/api/prisma/schema.prisma`, `D apps/web/.env.example`, `M package-lock.json`. Do not revert, overwrite, or stage them for unrelated work.

---

## 1. Phase 5 objectives

Deliver the request-to-fulfillment operational core on top of the verified Phase 4 inventory engine:

1. **Hospital/facility blood requests** with explicit lifecycle, priority/urgency, required-by timing, component/ABO-Rh/quantity needs, operational references, and auditability.
2. **Configurable, versioned compatibility/rule-assisted matching** (operational decision support only; human confirmation retained) that selects eligible inventory candidates without inventing clinical policy.
3. **Transactional, idempotent, concurrency-safe reservation** of concrete inventory units for requests (including partial fulfillment), reusing/extending Phase 4 locking mechanics and active-claim invariants.
4. **Issuance workflow** that converts/releases reserved eligible units through authorized, auditable commands, updates fulfillment state, and preserves append-only inventory history.
5. **Emergency workflow** (priority/alerting/expedited review) that never bypasses compatibility, quarantine/expiry/discard/recall exclusions, authorization, or human confirmation (ADR-021).
6. **Server-side authorization, facility isolation (404 masking where appropriate), CSRF, validation, structured errors/request IDs, and regression coverage** for all critical paths.

## 2. Scope and exclusions

### In scope (Phase 5)
- Backend domain/application/infrastructure/presentation for requests, request matching, reservations (request-aware), and issuance, consistent with modular monolith boundaries.
- Prisma schema additions and **new forward-only migrations created locally only** for request/issuance/compatibility/reference entities and reservation/request linkage (no deployment to Supabase; no edits to historical migrations).
- Pure domain state machines/validators for request and reservation/issuance-related transitions; reuse `InventoryMovementService` + `unit-state-machine` for unit state changes.
- API endpoints under `/api/v1/requests*`, `/api/v1/reservations*`, `/api/v1/issuances*` (or the closest documented contract) with response envelopes, request IDs, DTO validation, CSRF on mutations, and permission checks.
- Compatibility reference configuration model and **engine**; seed/reference loading mechanism that is traceable and versioned. **Actual medical compatibility values** must come from approved, human-reviewed reference material (ADR-018) — do not invent values.
- FEFO-style candidate ordering **where policy permits** (eligible, non-expired per effective state, non-quarantined/recalled/discarded, facility-scope correct).
- Idempotency for reservation/issuance commands where retries are realistic.
- Unit, integration (isolated local PostgreSQL), and API/e2e tests; concurrency tests for request reservation/issuance invariants.
- Minimal operator-facing frontend integration **only if required by acceptance evidence and kept within Phase 5/8 boundaries**; otherwise plan frontend as follow-on tasks with explicit contracts. (See §6 and Risks.)

### Out of scope (defer)
- Inter-facility transfers, dispatch/in-transit/receipt workflows (Phase 6), except preserving inventory states/interfaces already present.
- Notifications/WebSocket delivery implementation beyond defining event/audit hooks needed later (Phase 6).
- Analytics/reporting/exports (Phase 7).
- Full donor/hospital portal UX polish, advanced accessibility/performance hardening, and production deployment hardening (Phases 8–9), except not regressing security/accessibility basics.
- External SMS/email/push providers, Redis/queues, microservices, paid APIs.
- Autonomous clinical decisions, invented eligibility/compatibility/shelf-life policy values.

## 3. Requirements traceability

| ID | Requirement | Source | Classification | Notes / target |
|---|---|---|---|---|
| R5-01 | Hospital/facility request create/read/update/submit/cancel | `PRODUCT_REQUIREMENTS` §8, `API_CONTRACT` requests, `PROGRESS` Phase 5 | **Explicit** | Facility/hospital-scoped; DTO validation; audit. |
| R5-02 | Priority/urgency (`NORMAL`/`URGENT`/`EMERGENCY`/`CRITICAL` or documented equivalent) | `PRODUCT_REQUIREMENTS` §8, `DOMAIN_MODEL` request, `UI_UX_SPEC` | **Explicit** | Persist + validate + expose; affects prioritization/alerts, not safety bypass. |
| R5-03 | Request lifecycle with explicit states/transitions | `STATE_MACHINES` Blood request, `DOMAIN_MODEL` invariants, `ACCEPTANCE_CRITERIA` | **Explicit** | Pure domain validator; reject invalid transitions; terminal reopen policy explicit. |
| R5-04 | Configurable compatibility matrix/reference rules, versioned/traceable | `PRODUCT_REQUIREMENTS` §9, `ADR-018`, `MEDICAL_POLICY_BOUNDARY`, `DOMAIN_MODEL` | **Explicit** | Engine + config model + version recorded on allocation/match context; values human-reviewed. |
| R5-05 | Inventory matching service (eligible candidates, operational explanation) | `PRODUCT_REQUIREMENTS` §9, `API_CONTRACT` `GET /requests/:id/matches`, `UI_UX_SPEC` | **Explicit** | Excludes quarantined/recalled/expired/discarded, wrong facility/scope, active reservations; FEFO where permitted. |
| R5-06 | FEFO-style allocation where policy permits | `PROGRESS` Phase 5, `TESTING_STRATEGY`, `PRODUCT_REQUIREMENTS` §9 | **Explicit** | Policy/config gate; do not violate compatibility/scope/safety. |
| R5-07 | Transactional reservation command(s), no double reservation | `ADR-020`, `ACCEPTANCE_CRITERIA`, `TESTING_STRATEGY` concurrency, `STATE_MACHINES` reservation | **Explicit** | Reuse/extend Phase 4 `SELECT FOR UPDATE` + recheck + partial unique active claim + idempotency. |
| R5-08 | Partial fulfillment supported and represented | `PRODUCT_REQUIREMENTS` §8, `STATE_MACHINES` (`PARTIALLY_FULFILLED`), `ACCEPTANCE_CRITERIA` | **Explicit** | Request/line fulfillment quantities/states consistent. |
| R5-09 | Issuance implemented and auditable | `PRODUCT_REQUIREMENTS` §6/8 context, `API_CONTRACT` issuances, `DOMAIN_MODEL` Issuance/Item, `RBAC_MATRIX` | **Explicit** | Authorized human confirmation boundary preserved; audit + movement records. |
| R5-10 | Fulfillment tracking | `PROGRESS` Phase 5, `STATE_MACHINES`, `DOMAIN_MODEL` | **Explicit** | Derived/persisted consistently; no inconsistent totals. |
| R5-11 | Emergency workflow with appropriate operational alerts | `ADR-021`, `PRODUCT_REQUIREMENTS` §8, `ACCEPTANCE_CRITERIA`, `UI_UX_SPEC` | **Explicit** | Priority/expedited review/alerting semantics; **no safety-rule bypass**. |
| R5-12 | Critical request tests pass | `PROGRESS` Phase 5, `TESTING_STRATEGY` | **Explicit** | Lifecycle, matching exclusions, concurrency, idempotency, auth/scope, issuance, emergency behavior. |
| R5-13 | Request line items vs single-item shortcut | `DOMAIN_MODEL` (`BloodRequestLine`), `STATE_MACHINES` | **Implied by architecture** | Prefer lines even for single-type requests to avoid domain lock-in. |
| R5-14 | Allocation records rule-set/config version used | `ADR-018`, `MEDICAL_POLICY_BOUNDARY` | **Implied/explicit** | Persist version on reservation/issuance/match audit metadata as applicable. |
| R5-15 | Reservation API shape: request-scoped create vs body-based | `API_CONTRACT` shows `POST /requests/:requestId/reservations`; checkpoint notes body-based reservation concepts in practice | **Ambiguous** | **Decision needed (implementation start):** prefer contract-aligned request-scoped reservation commands; preserve facility idempotency semantics (ADR-020). Record final choice in ADR/update. |
| R5-16 | `ReservationStatus` includes `CONFIRMED`? | `STATE_MACHINES` lists `CONFIRMED`; current schema enum lacks it | **Ambiguous / alignment gap** | Reconcile state machine, schema enum, and API semantics (`/confirm`) in Step 1/ADR; do not invent behavior. |
| R5-17 | Exact notification/real-time delivery for emergency alerts | `ACCEPTANCE_CRITERIA` “appropriate operational alerts”, Phase 6 owns notifications | **Ambiguous** | Phase 5: persist priority/required metadata + audit/event hooks; UI badge/list if minimal frontend added. Full notification center/WebSocket deferred. |
| R5-18 | Compatibility reference values (ABO/Rh/component compatibility table contents) | `ADR-018`, `MEDICAL_POLICY_BOUNDARY` | **External/human-reviewed** | **Blocker for production-correct matching values** until approved reference data is provided/reviewed. Implement engine with injectable/versioned config + placeholder/test fixtures clearly marked non-clinical. |

## 4. Current implementation gap analysis

### Existing (reuse)
| Area | What exists | Reuse guidance |
|---|---|---|
| Inventory unit identity/lifecycle | `BloodComponentUnit`, `UnitState`, pure `unit-state-machine.ts` | Reuse for issuance/reservation-driven transitions; do not duplicate transition rules. |
| Append-only movement ledger | `InventoryMovement`, `InventoryMovementService` (atomic tx, stale-write/type guards) | Every unit state/custody change in reservation/issuance must record movements in same tx. |
| Reservation primitives | `Reservation`/`ReservationItem` models, partial unique active claim index (`ReservationItem_unitId_active_unique`), `ReservationService.reserveUnit` (`FOR UPDATE`, recheck, idempotency, facility scope) | **Primary reuse point**; extend to request context, multi-unit/partial fulfillment, confirm/convert/release lifecycle, and richer errors — preserve invariants. |
| Expiry/allocatability | `ExpiryService` (lazy effective state, bounded sweep) | Matching/reservation must use effective eligibility (not stale `AVAILABLE` if expired). |
| AuthN/AuthZ/CSRF/audit | `AuthGuard`, global `PermissionsGuard`, `CsrfGuard`, `AuditService`, permission catalogue includes `request.*`, `inventory.reserve/release_reservation/issue` | Add request/issuance controllers using same patterns (envelopes, 404 masking where required). |
| API/module patterns | Nest modules, DTO validation pipe, request-ID/error envelope | Follow existing controller/service structure. |
| Concurrency test harness | `test/inventory-concurrency.e2e-spec.ts` pattern (isolated `TEST_DATABASE_URL`, non-Supabase guard) | Extend for request reservation/issuance races. |

### Missing (implement in Phase 5)
| Gap | Impact | Notes |
|---|---|---|
| Request domain/data model | No `BloodRequest`/`BloodRequestLine` (or equivalent) in Prisma/API | Add schema + migration (local only) with lifecycle, urgency, facility ownership, component/blood-group/qty, fulfillment counters, required-by, references. |
| Issuance domain/data model | No `Issuance`/`IssuanceItem` | Add schema + migration; link to reservation/request/facility/units; immutable issuance facts + auditable command. |
| Compatibility reference model/service | No compatibility matrix entities/config engine | Add versioned reference/config mechanism; operational matching service; record rule-set version. Values require human review (R5-18). |
| Request module/API | No `requests` Nest module/controllers/services | Implement per contract + RBAC; facility isolation. |
| Reservation API (request-aware) | `InventoryController` has no reserve/release/issue endpoints; `ReservationService` is single-unit/internal | Expose transactional commands; align with API contract; support partial fulfillment and idempotency. |
| Issuance API | Missing | Implement confirm/issue/receive-as-documented flows with state/movement/audit updates. |
| Matching API/service | Missing | `GET /requests/:id/matches` with eligibility reasons/exclusions at operational level. |
| Frontend request/reservation/issuance UI | Only `features/system` exists | Likely minimal/no UI in backend-first plan; if added, keep scoped and contract-driven (see Risks). |
| Request/reservation/issuance e2e & domain tests | Missing | Add comprehensive tests; preserve 224+ baseline. |

### Schema/migration implications (planned; **not executed now**)
- New models/enums (indicative, finalize in ADR/implementation): `BloodRequest`, `BloodRequestLine`, `RequestState`/status, `RequestUrgency`, `Issuance`, `IssuanceItem`, compatibility rule/reference tables (e.g., `CompatibilityRuleSet`/`CompatibilityRule` or versioned config records) — exact naming per Prisma/API conventions.
- Alter `Reservation`: add real FK/relation to `BloodRequest` when model exists (nullable during migration only if required for safe rollout; prefer non-nullable for request-created reservations once workflow defined), add fields needed for lifecycle/confirmation semantics; reconcile `ReservationStatus` with state machine (`CONFIRMED`?) via explicit migration/ADR.
- Add indexes/constraints for facility-scoped queries, request status/urgency/required-by, active reservations, issuance lookups; preserve partial unique active claim.
- `InventoryMovement.issuanceId`/`reservationId`/`transferId` are nullable placeholders — populate consistently.
- **Migration workflow:** create new timestamped migration(s) locally, run `prisma migrate dev`/`deploy` only against isolated local DB, run full tests; **stop before any Supabase deploy**. Never edit existing migration files.

## 5. Architecture decisions and dependencies

### Decisions to follow (existing ADRs)
- **ADR-002/004/008/009/010/011/012/014/015/016/017/018/020/021/023/024/029/030/031/037** all apply. Especially: modular monolith boundaries; TypeScript/Prisma/Postgres; permission-based RBAC with 403/404 semantics; CSRF; append-only movements; ADR-015 donation/inventory linkage preserved; ADR-018 versioned/human-reviewed compatibility and human confirmation; ADR-020 locking/idempotency/partial unique active claim; ADR-021 emergency never bypasses safety.
- **State machine authority:** use pure domain validators in `domain/` (pattern used by donations/inventory). Where docs and current implementation diverge (e.g., reservation `CONFIRMED` state), resolve explicitly in implementation with an ADR/update — do not silently guess.

### Proposed Phase 5 design constraints
- **Module boundaries:** add focused modules (e.g., `requests`, `reservations`/request-fulfillment, `issuance`, `compatibility` or `matching`) registered in `AppModule`; avoid cross-module raw table access — inject services/use cases.
- **Commands:** reservation and issuance are explicit domain commands (not PATCH-on-unit shortcuts), transactional, idempotent where appropriate.
- **Matching:** pure/side-effect-light candidate selection + eligibility checks; read-mostly path may use consistent snapshots but must not create claims without reservation command. FEFO sort by `expiresAt` ascending among eligible units, policy-gated.
- **Audit:** use `AuditService` for high-impact actions (request submit/approve/reject/cancel, reservation create/release/confirm, issuance, emergency escalation). Movement ledger remains source for unit history.
- **Concurrency:** multi-unit reservation must lock units in deterministic order (e.g., by `unitId`) to reduce deadlocks; revalidate eligibility after lock; handle unique violations/idempotency races safely.

### Dependencies
- Phase 4 inventory engine and migration/index `ReservationItem_unitId_active_unique` (complete/verified).
- RBAC permissions and facility membership model (complete).
- Isolated local PostgreSQL workflow for integration/concurrency tests (established).

## 6. Ordered implementation steps

> Each step is intended to be independently verifiable, preserve Phases 0–4, and end with tests passing. **Do not deploy migrations to Supabase.** Stop and record ADR/clarification on material ambiguity.

### Step 1 — Domain/contracts alignment + schema design (no production behavior change)
- **Objective:** Finalize Phase 5 domain contracts: request/reservation/issuance enums, state transitions, API/DTO shapes, and schema plan; resolve `CONFIRMED`/reservation-status alignment and request-scoped reservation contract (R5-15/R5-16).
- **Expected files/modules (implementation time):** `docs/` updates if contract clarifications approved; `DECISIONS.md` (ADR for alignment/contract choices); planning references only now. Later: `apps/api/prisma/schema.prisma` (local change), new migration under `apps/api/prisma/migrations/<timestamp>_phase5_requests_reservations_issuance/`.
- **Dependencies:** ADR-018/020/021, current `Reservation`/`InventoryMovement` schema, `permission-catalogue`.
- **Implementation details:** Define request/line/issuance entities, urgency enum, fulfillment counters, reservation-request relation, issuance-reservation relation, compatibility reference/version model. Keep `InventoryMovement` append-only. Decide nullability/FK rollout for `Reservation.requestId` safely.
- **Database implications:** New migration(s); additive where possible. Run only on isolated local DB; verify `prisma migrate deploy`/dev workflow and generated client.
- **Acceptance criteria:** Documented/ADR-backed model; migration applies locally; `prisma validate`/client generate/build clean; no existing migration modified.
- **Unit tests:** Enum/transition mapping helpers if introduced.
- **E2E/integration:** Migration apply on isolated DB; existing 224 tests still pass.
- **Regression:** Full `npm test` (or staged equivalent) + `tsc --noEmit` + build.
- **Completion definition:** Schema/client ready, contracts/ADR recorded, baseline green.

### Step 2 — Request domain + persistence service (lifecycle core)
- **Objective:** Implement request and request-line domain model, pure request state machine, and application services for create/update/submit/review/approve/reject/cancel/expiry hooks (expiry job can be lazy check like Phase 4).
- **Expected files/modules:** `apps/api/src/modules/requests/domain/*` (state machine, errors/types), `application/*`, `dto/*`, `infrastructure/*` or Prisma use via `PrismaService`, `requests.module.ts`; minimal wiring in `AppModule` when ready.
- **Dependencies:** Step 1 schema; RBAC permissions `request.self.create/read/review/approve/reject/cancel/fulfill`.
- **Implementation details:** Enforce valid transitions (`STATE_MACHINES`), required fields by urgency/type, facility ownership, optimistic state guards (`updateMany`/version checks where useful), idempotent submit/cancel semantics if retried. Emergency requests persist urgency and trigger auditable “escalated/alert-required” metadata (delivery deferred).
- **Database implications:** Reads/writes `BloodRequest`/lines; audit events.
- **Acceptance criteria:** Lifecycle transitions match spec; invalid transitions rejected with structured errors; facility isolation/404 masking applied.
- **Unit tests:** Request state machine exhaustive valid/invalid transitions, urgency validation, fulfillment-state calculations.
- **E2E/integration:** API tests for create/submit/approve/reject/cancel, authz (own-facility vs other), 404 masking.
- **Regression:** Existing suites unchanged/pass.
- **Completion definition:** Request module usable independently of matching/issuance.

### Step 3 — Compatibility reference framework + matching service (operational, versioned)
- **Objective:** Implement versioned compatibility/reference configuration loading and an inventory matching service returning eligible unit candidates with operational exclusion reasons.
- **Expected files/modules:** `apps/api/src/modules/compatibility/*` or `matching` integrated with `requests`/`inventory` via ports; config/reference seed or fixture loader; `docs` note on reference-data provenance.
- **Dependencies:** Step 1 schema (if DB-backed) or ADR-approved config source; inventory read path; `ExpiryService`; `MEDICAL_POLICY_BOUNDARY`/ADR-018.
- **Implementation details:** Input: request line (component, ABO/Rh, qty, facility scope, urgency context). Output: ranked candidates (FEFO default where permitted), quantities/shortfall, rule-set version, per-candidate or summary exclusion reasons (expired, quarantined, reserved, incompatible, wrong facility, recalled/discarded). **No invented clinical values**: use clearly marked test fixtures; production values loaded from approved reviewed source. Record `ruleSetVersion` in match/reservation metadata.
- **Database implications:** Possible reference tables; read-heavy queries on units; consider indexes (`facilityId,state,componentTypeId,bloodGroup,expiresAt`) — verify against existing schema before adding.
- **Acceptance criteria:** Excludes ineligible states/active reservations/expired (effective) units; respects facility scope; deterministic FEFO ordering; version traceable.
- **Unit tests:** Compatibility evaluator (given fixture rules), FEFO ordering, exclusion logic, policy gate behavior.
- **E2E/integration:** Match endpoint returns candidates/shortfall; incompatible/quarantined/expired not returned as eligible.
- **Regression:** Inventory/donation behavior unchanged.
- **Completion definition:** Matching can drive reservation safely in controlled tests.

### Step 4 — Transactional request reservation command (extend Phase 4 mechanics)
- **Objective:** Implement request-aware reservation creation (single/multi-unit as needed), partial fulfillment support, idempotency, and release/cancel/expiry handling without duplicate active claims.
- **Expected files/modules:** Extend `apps/api/src/modules/inventory/application/reservation.service.ts` or add request-reservation use case/service; `inventory`/`requests`/new `reservations` controller endpoints; DTOs; domain transition validation for reservation lifecycle.
- **Dependencies:** Steps 1–3; ADR-020; existing partial unique index; `inventory.reserve`/`release_reservation` permissions; `request.read/fulfill/review` as applicable.
- **Implementation details:** Transaction: load request/line and validate state; select candidate unit IDs (from match or explicit validated set); lock rows `FOR UPDATE` in deterministic order; apply `ExpiryService`/effective-state checks; ensure no active `ReservationItem`/state conflicts; create `Reservation` (+ request FK) and `ReservationItem`s; set units `AVAILABLE->RESERVED` via `InventoryMovementService` in same tx; update request fulfillment counters/state (`PARTIALLY_FULFILLED`/move toward fulfillment as designed); write audit + rule-set version metadata. Idempotency key scoped per facility/command (align contract). Release returns units to `AVAILABLE` only through valid transitions and movement records.
- **Database implications:** Heavy write tx; deadlock/retry strategy (bounded) if needed; maintain partial unique index semantics.
- **Acceptance criteria:** No two active reservations for same unit; concurrent attempts yield exactly one success per claim; retries idempotent; partial fulfillment accurate; facility isolation enforced.
- **Unit tests:** Service logic with mocked Prisma/tx paths where feasible; reservation state transitions.
- **E2E/integration (isolated PG):** Same-unit race, multi-request race, different idempotency keys, idempotent retry, partial fulfillment, expired-ineligible rejection, cross-facility denial/masking, rollback atomicity.
- **Regression:** Phase 4 inventory concurrency tests still pass.
- **Completion definition:** Reservation command safe under concurrency and contract-aligned.

### Step 5 — Issuance workflow + fulfillment completion
- **Objective:** Implement issuance creation/confirmation from eligible reservations, unit transitions to issued/closed-used tracking as specified, fulfillment updates, and full audit/movement traceability.
- **Expected files/modules:** `apps/api/src/modules/issuance/*` or issuance use cases under requests/inventory; controllers for `/api/v1/issuances*` and/or reservation confirm endpoints per finalized contract; DTOs.
- **Dependencies:** Steps 1,2,4; `inventory.issue` permission; request/reservation states.
- **Implementation details:** Transactional issuance: verify reservation/request/facility scope and state; lock reservation/items/units; confirm human-authorized command (no autonomous clinical approval); create `Issuance`/items; transition units (`RESERVED->ISSUED` etc.) via movement service; mark reservation converted/closed per state machine; update request fulfillment; persist rule-set/policy metadata. Handle partial issuance if supported. Ensure append-only movement types (`ISSUED` etc.) are valid in `unit-state-machine` — extend machine only with explicit ADR/tests if current transitions are insufficient.
- **Database implications:** Issuance tables; movement/audit writes.
- **Acceptance criteria:** Issuance auditable; no issuance of non-reserved/ineligible units; fulfillment totals consistent; idempotent where retried.
- **Unit tests:** Issuance state/validation, fulfillment aggregation, transition guards.
- **E2E/integration:** Reserve→issue happy path, partial fulfillment, unauthorized/cross-facility, invalid state, concurrency/idempotency on confirm/issue.
- **Regression:** Reservation/inventory/request suites pass.
- **Completion definition:** End-to-end operational fulfillment path complete for in-scope flows.

### Step 6 — Emergency workflow semantics + operational alerts hooks
- **Objective:** Implement emergency/critical request handling (prioritization metadata, expedited review path, auditable escalation) without bypassing safety/compatibility/authorization.
- **Expected files/modules:** Requests service/controller validation; matching prioritization input; audit/event metadata; optional minimal UI indicator only if Phase 5 UI slice is included.
- **Dependencies:** Steps 2–5; ADR-021.
- **Implementation details:** Urgency affects queue/order/visibility and audit; matching still enforces eligibility rules. Add explicit “emergency escalated” audit action. Notification delivery integration point documented for Phase 6.
- **Database implications:** Possibly indexed urgency/status fields (Step 1).
- **Acceptance criteria:** Emergency requests accepted/prioritized per spec; cannot allocate quarantined/expired/incompatible/unauthorized units; alert/audit evidence present.
- **Unit tests:** Priority sorting/flag logic; guardrails.
- **E2E/integration:** Emergency request lifecycle + matching/reservation safety invariants.
- **Regression:** Non-emergency flows unchanged.
- **Completion definition:** ADR-021 satisfied with tests.

### Step 7 — API hardening, OpenAPI alignment, and security/regression sweep
- **Objective:** Ensure all Phase 5 endpoints meet contract/security standards and are documented/tested.
- **Expected files/modules:** Controllers/DTOs across Phase 5 modules; Swagger/OpenAPI decorators/config; error code catalogue consistency; permission/audit coverage review.
- **Dependencies:** Steps 2–6.
- **Implementation details:** Verify CSRF on all mutations, validation (`whitelist/forbidUnknownValues` already global), 403 vs 404 masking, pagination/filtering/limits where applicable, no secrets/PHI in logs/errors, request IDs preserved.
- **Database implications:** None beyond indexes identified earlier.
- **Acceptance criteria:** Contract-aligned endpoints; security checks pass by tests/review; OpenAPI reflects actual routes.
- **Unit tests:** DTO/policy edge cases.
- **E2E/integration:** AuthZ matrix samples (unauth, wrong permission, wrong facility, happy path).
- **Regression:** Full `npm test`, `npm run test:unit`, `npm run test:e2e`, `tsc --noEmit`, build.
- **Completion definition:** Backend Phase 5 feature-complete for in-scope API.

### Step 8 — Minimal frontend integration (conditional/sliced) or explicit deferral record
- **Objective:** Provide minimal operator workflow UI only if required for Phase 5 acceptance evidence; otherwise record a bounded deferral aligned with Phase 8.
- **Expected files/modules (if implemented):** `apps/web/src/features/requests|reservations|issuance/*`, routing/nav updates, TanStack Query hooks using generated/contracted API client patterns, accessible forms/tables/states per `UI_UX_SPEC`.
- **Dependencies:** Steps 2–7 stable contracts; auth/CSRF/session handling in web app (verify current state before planning detail).
- **Implementation details:** Progressive disclosure; status badges not color-only; safe destructive confirms; show operational-match caveats. **Do not claim clinical approval.**
- **Database implications:** None.
- **Acceptance criteria (if implemented):** Critical workflow operable; loading/empty/error/success states; no client-side authz trust.
- **Unit tests:** Component/hook tests as feasible.
- **E2E/integration:** Optional Playwright/RTL flows if configured; otherwise API e2e is authoritative.
- **Regression:** `npm run build -w @blood-ops/web`, web tests.
- **Completion definition:** Either minimal UI delivered with tests/build green, or ADR/PROGRESS note documents deferral and backend-only acceptance evidence.

## 7. API endpoint requirements

Target contract (align to `docs/API_CONTRACT.md`; finalize any deviations by ADR):

| Method/Path | Purpose | Key controls |
|---|---|---|
| `POST /api/v1/requests` | Create request (draft or initial state per contract) | Auth + `request.self.create`/relevant permission, facility scope, validation, CSRF, audit |
| `GET /api/v1/requests` | List scoped requests (pagination/filter by status/urgency/facility as allowed) | `request.read`, scope masking |
| `GET /api/v1/requests/:requestId` | Read request detail | `request.read` + scope, 404 mask |
| `PATCH /api/v1/requests/:requestId` | Update mutable draft/review fields | `request.read`/appropriate permission + state checks |
| `POST /api/v1/requests/:requestId/submit` | Submit for review | transition guard, idempotency consideration, audit |
| `POST /api/v1/requests/:requestId/approve` | Approve | `request.approve`/`request.review` as defined, audit |
| `POST /api/v1/requests/:requestId/reject` | Reject with reason | `request.reject`, reason required, audit |
| `POST /api/v1/requests/:requestId/cancel` | Cancel | `request.cancel`, transition guard, release implications defined |
| `GET /api/v1/requests/:requestId/matches` | Operational compatible/eligible candidates | `request.read` + inventory read scope; rule-set version in response/meta; no side effects |
| `POST /api/v1/requests/:requestId/reservations` | Create reservation(s) transactionally | `inventory.reserve` (and request scope), idempotency key, concurrency-safe |
| `GET /api/v1/requests/:requestId/reservations` | List reservations for request | scoped read |
| `POST /api/v1/reservations/:reservationId/release` | Release reservation claim | `inventory.release_reservation`, valid transitions, movements |
| `POST /api/v1/reservations/:reservationId/confirm` | Confirm reservation (if retained after R5-16 alignment) | explicit semantics; auditable |
| `POST /api/v1/issuances` | Create issuance (if contract uses collection create) | `inventory.issue`, transactional, human-authorized flow |
| `GET /api/v1/issuances` / `GET /api/v1/issuances/:issuanceId` | Read issuances | scoped read |
| `POST /api/v1/issuances/:issuanceId/confirm` | Confirm issuance step (if applicable) | idempotent/auditable |

**Cross-cutting:** response envelopes `{ data, meta.requestId|nextCursor }`, structured errors `{ error: { code, message, details, requestId } }`, `X-Request-ID` propagation, pagination limits, no stack traces/secrets.

## 8. Database and migration requirements

- **New migrations only** (forward-only). Suggested grouping (can be split): (A) request/line/urgency enums + tables, (B) issuance tables, (C) compatibility reference/version tables, (D) reservation alterations (`requestId` FK/relation, status/confirmation fields, indexes), (E) optional supporting indexes.
- **Constraints/indexes to evaluate:** FK integrity (`RESTRICT`/`CASCADE` chosen deliberately), unique public/request codes if needed, `@@index([facilityId, status, urgency])` for request queues, `@@index([requestId])`/reservation lookups, keep/verify `ReservationItem_unitId_active_unique` partial index unchanged.
- **Data integrity:** fulfillment counts consistent with line/item records; no direct quantity-only reservation bypassing units. Use transactions + row locks for multi-write commands.
- **Local-only verification:** apply migrations to isolated local Postgres (e.g., Docker on non-conflicting port); set `DATABASE_URL/DIRECT_URL/TEST_DATABASE_URL` to isolated instance only; run `prisma migrate deploy` or agreed local workflow; run all tests. **Never run migrations/seeds against Supabase.**
- **Historical migrations:** never edit files under existing migration folders.

## 9. Security considerations

- **Authentication/CSRF:** all mutating endpoints require authenticated session + CSRF guard (same pattern as inventory mutations).
- **Authorization:** server-side permission checks for every action; never trust client role flags. Use `request.*` and `inventory.reserve/release_reservation/issue` (and others as required) from the catalogue.
- **Facility isolation / anti-enumeration:** scope all reads/writes; return 404/appropriate masking for out-of-scope resources where policy requires (ADR-031). Validate `facilityId`/path/body consistency.
- **Input validation:** DTO whitelist/forbid unknown values; enum validation; reason codes required for reject/cancel/discard-like actions where specified.
- **Concurrency/abuse:** transactional locking for claim/issue; idempotency keys for retries; rate limits already global/Throttler — consider stricter limits for matching/reservation if abuse-prone (implementation decision).
- **Audit/logging:** high-impact actions audited; no passwords/tokens/PHI/clinical notes beyond approved minimal operational fields in logs. Include `ruleSetVersion`/correlation metadata where relevant.
- **Medical safety boundary (ADR-018/021):** matching is decision support; issuance requires authorized human action; emergency path does not bypass safety checks. UI/API messaging must not imply autonomous clinical approval.

## 10. Testing and acceptance criteria

### Required test layers
- **Domain unit tests:** request state machine, reservation/issuance transition guards, fulfillment math, compatibility evaluator (fixture rules), FEFO/policy selection, emergency priority logic (non-bypass).
- **Application/service tests:** transaction orchestration guards, idempotency behavior, error mapping (mocked/targeted as appropriate).
- **Integration tests (isolated local PostgreSQL, real Prisma/tx):** reservation races (same unit, multi-unit deterministic locking), partial fulfillment, idempotent retries, expiry ineligibility, FK/constraint behavior, issuance conversion atomicity.
- **API e2e tests:** full request lifecycle, authZ/CSRF/validation, 404 masking, match endpoint side-effect safety, reserve/issue flows, emergency workflow.
- **Regression:** all existing suites (health, auth, rbac, donor-donation, inventory + inventory concurrency, unit specs) must remain passing.

### Acceptance criteria (Phase 5)
- [ ] Hospital/facility request implemented with validated create/read/update flows.
- [ ] Request priority/urgency implemented and persisted.
- [ ] Request lifecycle implemented with domain-validated transitions.
- [ ] Configurable compatibility framework implemented; rule-set version traceable; **reference values loaded only from approved reviewed source** (test fixtures clearly marked).
- [ ] Inventory matching returns eligible candidates, applies safety exclusions, and supports FEFO where policy permits.
- [ ] Reservation command transactional, idempotent, and concurrency-safe; no duplicate active claims.
- [ ] Partial fulfillment correctly represented.
- [ ] Issuance implemented, authorized, and auditable; movements/fulfillment consistent.
- [ ] Fulfillment tracking consistent across request/reservation/issuance.
- [ ] Emergency workflow provides prioritized/expedited operational handling and alert/audit hooks without bypassing safety rules.
- [ ] Critical request/matching/reservation/issuance/concurrency tests pass.
- [ ] `tsc --noEmit`, build, and full relevant test suites pass.

## 11. Risks and unresolved questions

| Risk / question | Impact | Mitigation / owner decision |
|---|---|---|
| **Approved compatibility reference values unavailable** (R5-18) | Matching cannot be production-clinically correct | Implement versioned engine + non-clinical fixtures/tests; block production enablement until human-reviewed data loaded; document in ADR. |
| **Reservation `CONFIRMED` / status semantics mismatch** (R5-16) | Incorrect lifecycle or contract drift | Resolve in Step 1 with ADR; align schema, state machine, and endpoints. |
| **Request-scoped vs generic reservation API** (R5-15) | Contract/UX inconsistency | Prefer `API_CONTRACT` request-scoped flow; record final decision. |
| **Multi-unit deadlocks** | Concurrency failures under load | Deterministic lock ordering, bounded retries, PG integration tests. |
| **Emergency “alerts” scope vs Phase 6 notifications** (R5-17) | Acceptance ambiguity | Deliver auditable escalation + priority metadata/hooks in Phase 5; full notification center/WebSocket in Phase 6. |
| **Frontend scope** | Phase 5 checklist doesn’t explicitly list UI but UX spec does | Default to backend/API completeness; add minimal UI slice only if time-boxed and contracts stable (Step 8). |
| **Unit state transitions for issuance/closed/used** | `unit-state-machine.ts` may not cover all doc paths | Extend only via pure domain change + tests + ADR note if needed. |
| **`schema.prisma` has pre-existing local modifications** | Merge/conflict risk | Preserve as-is; base new migration work on reconciled schema in implementation session with explicit review. |
| **Isolated DB required for real concurrency tests** | False confidence from unit-only tests | Keep `TEST_DATABASE_URL` guard pattern; run against local Docker Postgres only. |

## 12. Definition of Phase 5 completion

Phase 5 is complete only when all are true:
- Implemented behavior matches in-scope requirements with server-side authorization, validation, CSRF, and facility isolation.
- Request, reservation, and issuance lifecycles are enforced by domain state machines; invalid transitions rejected.
- Matching uses versioned/configurable rules and records rule-set version; **no clinical values invented** (approved reference data process documented).
- Reservation/issuance are transactional and concurrency-safe; **no duplicate active reservation** and no negative/invalid inventory allocation under tested races.
- Inventory movements remain append-only and consistent with state transitions; high-impact actions audited.
- Emergency workflow prioritizes/flags requests and preserves all safety/compatibility/authorization rules (ADR-021).
- Unit + integration (isolated local PG, including concurrency) + API e2e coverage exists for critical paths; regressions fixed with tests.
- `tsc --noEmit`, lint (if configured/passing baseline), build, and full test suites pass.
- `PROGRESS.md`/docs/ADRs updated with actual results, decisions, and any approved deferrals/limitations.
- No new migrations deployed to Supabase; historical migrations unchanged; no secrets exposed; unrelated user changes preserved.

---

*End of Phase 5 plan.*
## 13. Implementation status updates

### Step 1 — Domain/contracts alignment + schema design (verified 2026-11-08)
- **Status:** complete/verified (isolated local DB only).
- **Delivered:** ADR-038–041 in `DECISIONS.md`; additive Prisma schema (`ReservationStatus.CONFIRMED`, request/issuance/compatibility entities, reservation linkage/back-relations); forward-only migration `20261108120000_phase5_domain_contracts_step1` (historical migrations unchanged).
- **Verification:** isolated Postgres `localhost:5433/hemavault_test`; `prisma validate/format/generate` pass; `migrate deploy` applied migration to isolated DB only; catalog verified (CONFIRMED enum label appended, 6 Phase 5 tables, Reservation additive columns/FK, Phase 4 partial unique index preserved). Regression: 22 files/224 tests, tsc/build clean. No Supabase deployment.

### Step 2 — Request domain + persistence lifecycle (implemented 2026-11-08)
- **Status:** implemented/verified (backend/API; Steps 3+ not started).
- **Delivered:** `apps/api/src/modules/requests/**` (pure state machine, domain errors/constants, DTOs, repository, `RequestService`, `RequestsController`, module wiring). Contract endpoints: `POST/GET/PATCH /api/v1/requests`, `GET /api/v1/requests/:requestId`, `POST /requests/:id/submit|approve|reject|cancel`. `GET /requests/:id/matches` deferred to Step 3.
- **Safety/controls:** server-side RBAC, facility isolation/404 masking, DTO validation, CSRF on mutations, structured envelopes/request IDs, audit events, emergency escalation metadata (ADR-021; no safety bypass), conditional/valid transitions (terminal states not reopened), quantity/line invariants. Pragmatic: approve/reject perform valid compound transitions where `/review` route absent.
- **Tests:** domain state machine, service lifecycle/invalid transitions/RBAC masking/quantity checks, API e2e (persistence, RBAC, CSRF, facility isolation, lifecycle, tx rollback). Total: 25 files/257 tests passed on isolated DB.
- **Not done (deferred):** `/matches` + compatibility engine (Step 3), request-scoped reservations/issuance/fulfillment commands (Steps 4–5), full emergency alert delivery (Phase 6), frontend, approved clinical compatibility values (ADR-040 blocker).

### Step 3 — Compatibility engine & matching API (implemented 2026-11-08)
- **Status:** complete/verified (backend/API; Steps 4+ not started). No schema/migration changes; no Supabase.
- **Delivered:** `apps/api/src/modules/matching/**` (domain rule-set policy/evaluator/candidate matcher, `CompatibilityRuleSetRepository`, `MatchingService`, `RequestMatchesQueryDto`); `GET /api/v1/requests/:requestId/matches` in `RequestsController`; `RequestsModule` wiring + `InventoryModule` dependency for `ExpiryService`; `MATCHING_POLICY_UNAVAILABLE` structured error; `docs/API_CONTRACT.md` updated; ADR-042.
- **Safety/controls:** versioned rule-set resolution with effective dates/status/ambiguity/approval checks; explicit `409 MATCHING_POLICY_UNAVAILABLE` (missing/inactive/unapproved/ambiguous/outside window); production matching disabled pending authoritative approved dataset (ADR-018/040/042); **no invented clinical values**; non-clinical fixtures (`isNonClinicalFixture=true`) allowed only in isolated automated tests (`NODE_ENV=test`), never production-eligible/seeded; read-only matching (no reservations/state changes/movements); request-level/facility-level authorization + 404 masking; bounded query validation; advisory non-clinical notice.
- **Matching behavior:** facility-scoped candidates per line/component type; excludes quarantined/recalled/discarded/expired-effective/issued/closed/used/transfer/in-transit/received/collected/not-available states and active reservation claims; data-driven compatibility evaluation with operational exclusion reasons (incl. `INCOMPATIBLE`, `COMPATIBILITY_RULE_AMBIGUOUS`); FEFO ordering for eligible candidates; partial matching (`quantityNeeded`/`quantityEligible`/`shortfall`); rule-set version + `matchedAt` recorded.
- **Tests (isolated DB, NON-CLINICAL fixtures):** unit `src/modules/matching/domain` (3 files/20) + `application/matching.service.spec.ts` (1/4); e2e `test/request-matching.e2e-spec.ts` (1/9: authz/isolation/404, policy unavailable/inactive/missing, exclusions incl. expired/recalled/quarantined/reserved/effective-expired, FEFO, partial, repeated matching no inventory/reservation/movement side effects). Regression: `npm run test:unit` 23/181, `npm run test:e2e` 7/109, `npm test` **30 files/290 passed, 0 failed**; `tsc --noEmit` clean; `nest build` success.
- **Not done (deferred):** request-scoped transactional reservations (Step 4), issuance/fulfillment commands (Step 5), full emergency alert delivery (Phase 6), frontend, approved clinical compatibility dataset (production blocker).
