# Phase 6 Plan — Transfers, Notifications, Real-Time

Status: implementation and verification complete (2026-11-11). Supabase migration deployment remains
pending explicit authorization; Phase 0–5 behavior preserved. Authority: `PRODUCT_REQUIREMENTS.md` §12–13, `STATE_MACHINES.md` (Transfer),
`DOMAIN_MODEL.md` (Transfer, TransferItem, Notification), `ARCHITECTURE.md` §9, `SECURITY_THREAT_MODEL.md`,
`RBAC_MATRIX.md` (Transfers, Notifications), `API_CONTRACT.md` (Transfer/Notification endpoints),
`DATABASE_DESIGN.md`, and existing ADRs (especially ADR-017, ADR-021, ADR-043–046).

## Guardrails carried into Phase 6

- Modular monolith; no Redis, queues, external providers, or paid services.
- Real-time delivery is optional; every workflow stays correct through normal API polling.
- No clinical compatibility values are created, seeded, or inferred. Production matching remains disabled
  (`409 MATCHING_POLICY_UNAVAILABLE`).
- Phase 0–5 behavior is preserved: RBAC, CSRF on mutations, facility isolation, immutable movements,
  transactional inventory invariants, structured error envelopes, request IDs, audit chain.
- No historical migration edits. New schema changes are forward-only.
- DB-mutating tests run only against the isolated local PostgreSQL (`localhost:5433`), never Supabase.

## Step 1 — Repository assessment and plan

Acceptance:
- Current schema, modules, auth/RBAC, audit, inventory, requests, reservations, issuance inspected.
- Gaps identified: no `Transfer`/`TransferItem`/`Notification` models; `InventoryMovement.transferId`
  placeholder lacks a relation; transfer unit transitions exist but return-to-available is absent.
- This plan recorded.

## Step 2 — Transfer domain and lifecycle

Schema:
- `TransferStatus` enum: `REQUESTED`, `APPROVED`, `PACKED`, `DISPATCHED`, `IN_TRANSIT`, `RECEIVED`,
  `REJECTED`, `CANCELLED`.
- `Transfer` (source/destination facility, requester, request/approval/dispatch/receive/cancel/reject
  actors and timestamps, status, facility-scoped idempotency key, notes/reasons, metadata).
- `TransferItem` (transfer, unit, `isActive` claim flag, dispatch/receive timestamps).
- Partial unique index `TransferItem(unitId) WHERE isActive = true` prevents concurrent double claims.
- `InventoryMovement.transferId → Transfer` relation (nullable, `ON DELETE SET NULL`).

Domain:
- Pure transfer state machine: `REQUESTED → APPROVED → PACKED → DISPATCHED → IN_TRANSIT → RECEIVED`,
  with `REQUESTED → REJECTED/CANCELLED` and `APPROVED/PACKED → CANCELLED`.
- Terminal states: `RECEIVED`, `REJECTED`, `CANCELLED`. No transition out of terminal states.
- Unit transitions: create claims `AVAILABLE → TRANSFER_PENDING`; dispatch `TRANSFER_PENDING →
  IN_TRANSIT`; receive `IN_TRANSIT → RECEIVED` (facility moves to destination); cancel/reject before
  dispatch returns `TRANSFER_PENDING → AVAILABLE` (explicitly added to the unit state machine).

Application:
- `TransferService` create/list/get/approve/reject/pack/dispatch/receive/cancel.
- Eligibility: unit must belong to source facility, be `AVAILABLE` and not effectively expired, have no
  active reservation claim, and have no active transfer claim. Quarantined, recalled, discarded, expired,
  issued, closed, used, reserved, transfer-pending, in-transit, and received units are rejected.
- Destination must be a different active facility in the same organization (ADR-047).
- All writes occur in `ReadCommitted` transactions with deterministic `FOR UPDATE` locking and
  state-conditional updates. Units are claimed at creation so two transfers cannot claim the same unit.
- Immutable inventory movements and audit events are recorded for every state change.
- Dispatch advances `DISPATCHED → IN_TRANSIT` atomically because the contract exposes no separate
  in-transit command.
- Cancellation is permitted only through `PACKED`; after dispatch the documented exception/return
  workflow is deferred (ADR-048).

Authorization:
- `transfer.create` at source; `transfer.approve|pack|dispatch|cancel` at source; `transfer.receive` at
  destination; `transfer.read` at either facility; global permissions apply.
- Out-of-scope transfer IDs are masked as `404`; malformed UUIDs are `400`.

Acceptance:
- Full lifecycle works; double allocation is impossible; cancel/reject returns source units to
  `AVAILABLE`; dispatch then cancel is rejected; movement/audit trails complete; rollback is atomic.

## Step 3 — Notification system

Schema:
- `Notification` (recipient, optional facility context, type, priority, title/body, resource link,
  dedupe key, metadata, read state, timestamps).
- `NotificationDelivery` (channel, status, attempts, last attempt, delivered time, error) for
  idempotent, retry-safe delivery accounting.
- `NotificationPreference` (per user/type/channel, enabled; defaults enabled).
- Enums: `NotificationType`, `NotificationPriority`, `NotificationChannel`,
  `NotificationDeliveryStatus`.

Application:
- User-targeted list with bounded pagination (`limit ≤ 100`), unread filter, read/unread counts.
- Single mark-read and mark-all-read are idempotent and user-scoped.
- Dedupe key `(userId, dedupeKey)` makes event fan-out retry-safe.
- Recipient resolution: explicit users plus active facility members whose role grants the relevant
  permission; actor excluded from fan-out where appropriate.
- Delivery channels are abstracted. `IN_APP` is persisted and marked `DELIVERED`; `EMAIL`/`SMS` are
  recorded as `SKIPPED / PROVIDER_NOT_CONFIGURED` until a real provider is configured and verified.
  No external delivery is claimed.
- `CRITICAL` priority notifications bypass user preferences (safety). Lower priorities honour
  preference suppression.
- Every notification creation is auditable via operational audit events on the source workflows; the
  notification rows themselves are the durable delivery record.

Event integration:
- Emergency request created/escalated; request submitted/approved/rejected/reserved/fulfilled.
- Issuance created/confirmed; transfer requested/approved/dispatched/received/rejected/cancelled.
- Notification failures after a committed business transaction are logged with context (never silent)
  and can be re-driven because dedupe keys make fan-out idempotent.

Acceptance:
- Notifications persist, paginate, and authorize correctly; users cannot read or mutate another user's
  notifications; duplicate events do not create duplicate rows; external channels never report delivery.

## Step 4 — Real-time functionality

- Server-Sent Events at `GET /api/v1/notifications/stream` using existing Nest/Express/RxJS stack. No new
  infrastructure or dependency.
- Authentication uses the existing HTTP-only session cookie and `AuthGuard`; authorization requires
  `notification.read`; the stream is filtered server-side by the authenticated user ID.
- Connection lifecycle: immediate `ready` event, `notification.created` events, periodic keep-alive
  comments/events, cleanup of bus subscriptions on disconnect.
- Reconnection: event IDs encode the notification timestamp; `Last-Event-ID` triggers a bounded replay of
  that user's notifications created after the supplied point.
- Duplicate side effects are impossible because the stream is read-only and delivery is idempotent.
- Polling fallback: `GET /api/v1/notifications` remains fully functional and is the documented fallback.
- In-process bus is intentional for the modular monolith. Multi-instance fan-out is out of scope and
  covered by polling; documented as a limitation.

Acceptance:
- Unauthenticated stream requests are rejected; users only receive their own events; stream cleanup
  occurs; polling works without an open stream.

## Step 5 — Integration

- `NotificationsModule` consumed by requests, issuance, and transfers; no circular imports.
- Existing RBAC permission codes reused (`transfer.*`, `notification.read`).
- Requests/issuance keep their current behaviour and now emit notifications after commit.
- Existing inventory movement and audit services remain the only paths for state changes/auditing.
- API contract, ADRs, PROGRESS, and OpenAPI decorators updated.

## Step 6 — Testing

- Unit: transfer state machine; notification priority/preference/dedupe rules; real-time filtering.
- Integration/E2E on isolated PostgreSQL: transfer lifecycle, movements, audit, cancellation/rejection,
  ineligible units, facility isolation/RBAC/CSRF, concurrent same-unit transfer claims, rollback.
- Notifications: persistence, pagination, user isolation, read/read-all, duplicate prevention, delivery
  accounting, preference suppression, external-channel non-claim, stream authentication/ready event.
- Regression: full Phase 0–5 suite remains green.

## Step 7 — Security and hardening

- Validate all DTOs (UUIDs, arrays bounded, strings trimmed/length-capped).
- Enforce server-side authorization on every route; mask out-of-scope resources.
- CSRF on all transfer mutations and notification read mutations.
- No cross-facility data leakage in transfers or notification streams.
- Idempotency: transfer create (source-facility scoped) and notification dedupe.
- Transactions and locks for claim/dispatch/receive; no negative availability; no state regression.
- Audit all transfer state changes; no secrets/PII in logs or notification bodies.
- Document transfer/notification errors, routes, and semantics in `docs/API_CONTRACT.md`.

## Step 8 — Verification

Run against the isolated local PostgreSQL only:
- `npx prisma validate`
- migration verification (apply forward-only to isolated DB; `prisma migrate status`)
- `npm run test:unit`
- `npm run test:e2e`
- `npm test`
- `npx tsc --noEmit -p tsconfig.json`
- `npm run build`
- `npm run build -w @blood-ops/web`

Report exact counts and never claim an unexecuted check.

## Step 9 — Git discipline

- Focused commits per milestone (schema/domain, notifications/real-time, transfers, tests/docs).
- Never rewrite historical migrations, reset databases, run destructive SQL, modify unrelated changes,
  print/commit secrets, or deploy to Supabase without explicit authorization.

## Verification results (executed 2026-11-11, isolated PostgreSQL localhost:5433)

- `npx prisma validate` — clean.
- Migration `20261111054529_phase6_transfers_notifications` applied to the isolated local database only;
  9 local migrations present. Supabase remains at the 8 Phase 5 migrations (no Phase 6 deployment).
- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npm run test:unit` — 28 files / 209 tests passed, 0 failed.
- `npm run test:e2e` — 12 files / 168 tests passed, 0 failed (transfers 10/10, notifications 15/15,
  Phase 0–5 regression green).
- `npm test` (unit + e2e) — 377 tests passed, 0 failed.
- `npm run build` (API) — success.
- `npm run build -w @blood-ops/web` — success.
- Targeted eslint/Prettier on new Phase 6 files — clean. Full-repo lint/format still fails on the
  pre-existing baseline (older `no-explicit-any` and Prettier drift); Phase 6 did not add new failures.

## Deferred / out of scope

- External email/SMS providers (no provider configured/verified).
- In-transit exception/return workflow (Contract and Phase scope only expose cancel through `PACKED`);
  conservation is preserved because dispatch/receive are the only forward paths (ADR-048).
- Multi-instance real-time fan-out (modular monolith; polling fallback).
- Operator UI for transfers/notifications (Phase 8 per ADR-046).
- Approval of clinical compatibility reference data (external blocker; matching stays disabled).
