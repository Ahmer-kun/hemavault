# Acceptance Criteria

## Architecture

- [ ] Backend and frontend are TypeScript-first.
- [ ] PostgreSQL is the system of record.
- [ ] Business domains have clear module boundaries.
- [ ] No unnecessary microservice infrastructure exists.
- [ ] Legacy reference architecture is not copied.

## Authentication/security

- [ ] Passwords are securely hashed.
- [ ] Browser sessions are not stored in localStorage/sessionStorage.
- [ ] Session revocation works.
- [ ] Login endpoints are rate-limited.
- [ ] Authorization is enforced server-side.
- [ ] Cross-facility access is blocked.
- [ ] Sensitive fields are not returned by default.
- [ ] No secrets exist in source control.
- [ ] Critical security events are auditable.

## Donors/campaigns

- [ ] Donor can manage allowed profile data.
- [ ] Donor can see own history.
- [ ] Donor can book/cancel eligible campaign appointments.
- [ ] Staff can manage campaign registration/check-in.

## Donations

- [ ] Donation state transitions are enforced.
- [ ] Screening/release is explicit.
- [ ] Rejected/quarantined donations cannot become available without a valid transition.
- [ ] Donation history is traceable.

## Inventory

- [ ] Inventory is represented at unit level.
- [ ] Units have lifecycle states.
- [ ] Movement history is immutable.
- [ ] Expiration is enforced.
- [ ] Quarantined/recalled/discarded units cannot be allocated.
- [ ] A unit cannot have two active reservations.
- [ ] Concurrent reservations are safe.
- [ ] Facility scope is enforced.
- [ ] Inventory reconciliation is possible.

## Requests

- [ ] Requests support urgency/priority.
- [ ] Requests have explicit lifecycle states.
- [ ] Partial fulfillment is represented correctly.
- [ ] Matching uses configured rules.
- [ ] Reservation is transactional.
- [ ] Issuance is auditable.
- [ ] Emergency requests create appropriate operational alerts.

## Transfers

- [ ] Transfers have explicit lifecycle states.
- [ ] Source inventory is not incorrectly duplicated during transfer.
- [ ] Destination receipt creates/updates the appropriate inventory state.
- [ ] Transfer audit trail is complete.

## UX

- [ ] Public/authenticated routes are coherent.
- [ ] All important screens have loading/empty/error states.
- [ ] Tables support filtering/pagination where needed.
- [ ] Forms are accessible.
- [ ] Responsive layouts work on mobile.
- [ ] Destructive operations require deliberate confirmation.
- [ ] Status is not communicated by color alone.

## Documentation/operations

- [ ] OpenAPI matches actual routes.
- [ ] Clean checkout setup is documented.
- [ ] Docker development environment works.
- [ ] Seed data works.
- [ ] Health/readiness endpoints work.
- [ ] Progress and ADR records are current.
- [ ] Full verification suite passes.
