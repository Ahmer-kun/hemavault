# API Contract

The final API is versioned under `/api/v1`.

## Response envelope

Successful collection/resource response:

```json
{
  "data": {},
  "meta": {
    "requestId": "..."
  }
}
```

Paginated response:

```json
{
  "data": [],
  "meta": {
    "requestId": "...",
    "nextCursor": "..."
  }
}
```

Error response:

```json
{
  "error": {
    "code": "REQUEST_NOT_FOUND",
    "message": "The requested resource could not be found.",
    "details": {},
    "requestId": "..."
  }
}
```

Messages must not expose secrets or internal stack traces.

## Authentication endpoints

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/verify-email
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/logout-all
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
GET    /api/v1/auth/me
```

Browser session is transported using secure cookies.

## User/organization/facility endpoints

```text
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/users
GET    /api/v1/organizations
POST   /api/v1/organizations
GET    /api/v1/facilities
POST   /api/v1/facilities
GET    /api/v1/facilities/:facilityId
PATCH  /api/v1/facilities/:facilityId
GET    /api/v1/facilities/:facilityId/members
POST   /api/v1/facilities/:facilityId/members
DELETE /api/v1/facilities/:facilityId/members/:memberId
```

## Donor endpoints

```text
GET    /api/v1/donors/me
PATCH  /api/v1/donors/me
GET    /api/v1/donors/:donorId
GET    /api/v1/donors
GET    /api/v1/donors/:donorId/donations
```

Search must be permission-controlled and facility-aware.

## Campaign/appointment endpoints

```text
GET    /api/v1/campaigns
POST   /api/v1/campaigns
GET    /api/v1/campaigns/:campaignId
PATCH  /api/v1/campaigns/:campaignId
POST   /api/v1/campaigns/:campaignId/publish
POST   /api/v1/campaigns/:campaignId/cancel
POST   /api/v1/campaigns/:campaignId/registrations
DELETE /api/v1/campaigns/:campaignId/registrations/:registrationId
POST   /api/v1/campaigns/:campaignId/check-ins
```

## Donation endpoints

```text
POST   /api/v1/donations
GET    /api/v1/donations/:donationId
POST   /api/v1/donations/:donationId/check-in
POST   /api/v1/donations/:donationId/collect
POST   /api/v1/donations/:donationId/screen
POST   /api/v1/donations/:donationId/release
POST   /api/v1/donations/:donationId/reject
```

Each command must validate the current state.

## Inventory endpoints

```text
GET    /api/v1/inventory/units
GET    /api/v1/inventory/units/:unitId
GET    /api/v1/inventory/summary
GET    /api/v1/inventory/expiring
POST   /api/v1/inventory/units/:unitId/move
POST   /api/v1/inventory/units/:unitId/quarantine
POST   /api/v1/inventory/units/:unitId/discard
POST   /api/v1/inventory/reconcile
GET    /api/v1/inventory/units/:unitId/movements
```

Reservation/issuance are separate domain commands, not arbitrary inventory updates.

## Request endpoints

```text
POST   /api/v1/requests
GET    /api/v1/requests
GET    /api/v1/requests/:requestId
PATCH  /api/v1/requests/:requestId
POST   /api/v1/requests/:requestId/submit
POST   /api/v1/requests/:requestId/approve
POST   /api/v1/requests/:requestId/reject
POST   /api/v1/requests/:requestId/cancel
GET    /api/v1/requests/:requestId/matches
```

### `GET /api/v1/requests/:requestId/matches`

Returns **operational** inventory match candidates for an in-scope request. This endpoint is **read-only** (no reservations, no unit state changes, no inventory movements).

**Authorization:** authenticated session + `request.read` (global or facility-scoped). Facility isolation applies; out-of-scope requests are masked as `404 REQUEST_NOT_FOUND`.

**Query parameters (validated/bounded):**
- `limitPerLine` (optional, integer, 1–200, default 50): maximum candidate rows returned per request line (eligible candidates are FEFO-ranked first; ineligible candidates may be included with exclusion reasons for operational explanation, subject to the same bound).

**Success response (`200`)** — standard envelope:
```json
{
  "data": {
    "requestId": "uuid",
    "facilityId": "uuid",
    "matchedAt": "ISO-8601 timestamp",
    "ruleSet": { "id": "uuid", "code": "string", "version": "string", "isNonClinicalFixture": false },
    "advisoryNotice": "Operational matching only. Not a clinical decision or autonomous approval.",
    "lines": [
      {
        "requestLineId": "uuid",
        "componentTypeId": "uuid",
        "componentTypeCategory": "string",
        "bloodGroupRequired": "A_POS|null",
        "quantityRequested": 2,
        "quantityReserved": 0,
        "quantityIssued": 0,
        "quantityNeeded": 2,
        "quantityEligible": 1,
        "shortfall": 1,
        "candidates": [
          {
            "unitId": "uuid",
            "publicCode": "UNIT-...",
            "componentTypeId": "uuid",
            "bloodGroup": "A_POS",
            "expiresAt": "ISO-8601",
            "state": "AVAILABLE",
            "effectiveState": "AVAILABLE",
            "eligible": true,
            "exclusionReasons": [],
            "fefoRank": 1
          }
        ]
      }
    ]
  },
  "meta": { "requestId": "correlation-id" }
}
```

**Matching behavior (operational):**
- Resolves exactly one approved, active compatibility rule set within its effective window. Records `ruleSet.version` in the response.
- Evaluates facility-scoped candidate units for the requested component type. Excludes quarantined, recalled, discarded, expired/expired-effective, issued, closed, used, transfer/in-transit/received/collected ineligible states, and units with active reservation claims.
- Applies approved compatibility rules (data-driven; technical evaluation only). Explains inclusion/exclusion with operational reasons (e.g., `INCOMPATIBLE`, `RESERVED_OR_ACTIVELY_CLAIMED`, `EFFECTIVELY_EXPIRED`, `STATE_QUARANTINED`).
- Orders eligible candidates by FEFO (`expiresAt` ascending, deterministic tie-breaker).
- Supports partial matching and reports `quantityNeeded`, `quantityEligible`, and `shortfall`.
- **No side effects:** never creates reservations, never changes unit states, never writes inventory movements.

**Safety/policy errors (explicit):**
- `409 MATCHING_POLICY_UNAVAILABLE` (details include `reason`: `MISSING`|`INACTIVE`|`UNAPPROVED`|`OUTSIDE_EFFECTIVE_WINDOW`): no approved active production compatibility policy is available, or policy is inactive/missing/unapproved for production. **Production matching remains disabled until an authoritative, human-reviewed clinical compatibility dataset is approved and loaded** (ADR-018/ADR-040). The system never invents clinical compatibility values.
- `409 MATCHING_POLICY_UNAVAILABLE` with `reason: AMBIGUOUS_RULE_SET`: policy selection is ambiguous.
- `404 REQUEST_NOT_FOUND`: request missing or out of scope.

**Medical safety boundary:** results are operational decision support only and require authorized human confirmation for clinical/operational decisions. Non-clinical fixture rule sets are test-only, clearly labeled, and never usable as production policy.

## Reservation endpoints

```text
POST   /api/v1/requests/:requestId/reservations
GET    /api/v1/requests/:requestId/reservations
GET    /api/v1/reservations/:reservationId
POST   /api/v1/reservations/:reservationId/release
POST   /api/v1/reservations/:reservationId/confirm
POST   /api/v1/reservations/:reservationId/cancel
```

Reservation commands are transactional and facility-scoped. Creation accepts a bounded `items[]` of `{ unitId, requestLineId }` plus an optional facility-scoped `idempotencyKey`; retries with the same key return the original reservation. Only `AVAILABLE`, unexpired, compatible units belonging to the request facility may be reserved. Mutations require `inventory.reserve` or `request.fulfill` (global or facility-scoped) and CSRF. Out-of-scope resources are masked as `404 REQUEST_NOT_FOUND` / `404 RESERVATION_NOT_FOUND`.

## Issuance endpoints

```text
POST   /api/v1/requests/:requestId/issuances
GET    /api/v1/requests/:requestId/issuances
GET    /api/v1/issuances/:issuanceId
POST   /api/v1/issuances/:issuanceId/confirm
POST   /api/v1/issuances/:issuanceId/cancel
```

Issuance is a two-phase, authorized, auditable workflow:

1. `POST /requests/:requestId/issuances` creates a staged `CREATED` issuance for one or more active reservation items. Staging does **not** mutate unit state, request line counters, or the inventory ledger, so operators can review before committing. The body accepts `items[]` of `{ reservationItemId }` (bounded to 50, unique) and an optional facility-scoped `idempotencyKey`. Items must belong to the same reservation for the request.
2. `POST /issuances/:issuanceId/confirm` performs the transactional conversion: revalidates state/facility/compatibility/expiry/quarantine/recall/discard eligibility under row locks, records `ISSUED` inventory movements, marks reservation items inactive, decrements reserved / increments issued counters, recomputes request fulfillment status (`RESERVED` → `PARTIALLY_FULFILLED` → `FULFILLED`), and audits the action. Confirmation is idempotent for an already `CONFIRMED` issuance.
3. `POST /issuances/:issuanceId/cancel` cancels a `CREATED` issuance only. Confirmed issuances cannot be reversed because `ISSUED` units cannot return to `AVAILABLE` (ADR-041); operators must handle such cases through documented operational correction, not silent state rollback.

Both commands require `inventory.issue` or `request.fulfill` (global or facility-scoped) and CSRF. Malformed path identifiers return `400 BAD_REQUEST`; missing or out-of-scope resources return masked `404` errors.

**Issuance errors (explicit):** `REQUEST_NOT_ISSUABLE`, `RESERVATION_NOT_ISSUABLE`, `RESERVATION_ITEM_NOT_FOUND`, `RESERVATION_ITEM_NOT_ACTIVE`, `FACILITY_SCOPE_VIOLATION`, `UNIT_NOT_ALLOCATABLE`, `UNIT_LINE_MISMATCH`, `LINE_BELONGS_TO_DIFFERENT_REQUEST`, `EXCEEDS_REMAINING`, `DOUBLE_ISSUANCE`, `IDEMPOTENCY_KEY_CONFLICT`, `ITEMS_SPAN_MULTIPLE_RESERVATIONS`, `FULFILLMENT_COUNTER_CONFLICT`, `ISSUANCE_NOT_CONFIRMABLE`, `ISSUANCE_NOT_CANCELLABLE`, `ISSUANCE_HAS_NO_ITEMS`, `ISSUANCE_NOT_LINKED`.

## Transfer endpoints

```text
POST   /api/v1/transfers
GET    /api/v1/transfers
GET    /api/v1/transfers/:transferId
POST   /api/v1/transfers/:transferId/approve
POST   /api/v1/transfers/:transferId/pack
POST   /api/v1/transfers/:transferId/dispatch
POST   /api/v1/transfers/:transferId/receive
POST   /api/v1/transfers/:transferId/cancel
```

## Notifications

```text
GET    /api/v1/notifications
POST   /api/v1/notifications/:notificationId/read
POST   /api/v1/notifications/read-all
```

## Audit and reports

```text
GET    /api/v1/audit-events
GET    /api/v1/reports/inventory
GET    /api/v1/reports/donations
GET    /api/v1/reports/requests
GET    /api/v1/reports/transfers
```

Export formats should be explicit and permission-controlled.

## Health

```text
GET /health/live
GET /health/ready
```

## API implementation rules

- DTOs are explicit.
- Input validation is mandatory.
- Pagination limits are enforced server-side.
- Sort fields are allowlisted.
- Filter fields are allowlisted.
- IDs are validated before hitting the database.
- Auth and authorization happen before sensitive resource loading where practical.
- Sensitive fields are excluded by default.
- Errors use stable machine-readable codes.
- OpenAPI must reflect actual behavior.
