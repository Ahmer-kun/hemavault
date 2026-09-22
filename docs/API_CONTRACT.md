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

## Reservation endpoints

```text
POST   /api/v1/requests/:requestId/reservations
GET    /api/v1/requests/:requestId/reservations
POST   /api/v1/reservations/:reservationId/release
POST   /api/v1/reservations/:reservationId/confirm
```

A reservation command must be idempotent where practical.

## Issuance endpoints

```text
POST   /api/v1/requests/:requestId/issuances
GET    /api/v1/issuances/:issuanceId
POST   /api/v1/issuances/:issuanceId/dispatch
POST   /api/v1/issuances/:issuanceId/receive
```

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
