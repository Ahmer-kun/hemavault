# Domain Model

This is the conceptual model. Exact table names can be adapted during Prisma implementation, but the relationships and invariants must be preserved.

## Core entities

### User

Identity and authentication subject.

Key fields:

- id
- email
- passwordHash
- status
- emailVerifiedAt
- createdAt
- updatedAt

Do not put role-specific operational data directly into the identity record.

### Role

Named permission bundle.

### Permission

Atomic capability such as `inventory.reserve` or `request.approve`.

### UserRole

Assigns roles to a user, preferably scoped to an organization/facility when appropriate.

### Organization

Top-level operational owner.

### Facility

Operational location belonging to an organization.

### DonorProfile

Donor-specific profile, separated from authentication identity.

### HospitalProfile

Hospital-specific operational profile linked to a facility.

### Donation

A collected donation event associated with a donor and facility/campaign.

### DonationScreening

Screening/release decision record. Must support traceability and not store unnecessary clinical detail.

### BloodDrive

Campaign/event where donations are collected.

### CampaignRegistration

Links donors to a blood drive appointment or registration.

### BloodComponentUnit

The fundamental transfusable/processable inventory entity.

Suggested fields:

- id
- publicCode / labelCode
- donationId
- componentTypeId
- bloodGroup
- rhFactor
- volume/value fields only where operationally needed
- state
- collectionAt
- processedAt
- expiresAt
- currentFacilityId
- currentStorageLocationId
- releasedAt
- discardedAt
- createdAt
- updatedAt

### ComponentType

Reference configuration such as red-cell component, plasma, platelets, etc.

### StorageLocation

Shelf/fridge/freezer/location within a facility.

### InventoryMovement

Immutable event describing a change in custody, location, state, reservation/issue relation, or quantity.

### BloodRequest

Hospital/facility demand record.

### BloodRequestLine

Line item describing requested component/ABO/Rh/quantity/fulfillment state. Use lines even when most requests contain one type; this avoids baking a single-item assumption into the domain.

### Reservation

Claims specific inventory units for a request.

### ReservationItem

Links a reservation to a concrete component unit.

### Issuance

Records the release of reserved/eligible units to a destination workflow.

### IssuanceItem

Links an issuance to concrete units.

### Transfer

Inter-facility movement request.

### TransferItem

Links a transfer to concrete units.

### Notification

In-app/system notification.

### AuditEvent

Append-oriented record of consequential system activity.

### Session

Server-side authenticated browser/session record.

### ReferenceRuleSet / CompatibilityRule

Versioned operational reference rules used by matching services.

## Core relationships

```text
Organization 1 ─── N Facility
Organization 1 ─── N User
Facility N ─────── N User (through scoped membership)
User 1 ─────────── 0..1 DonorProfile
Facility 1 ─────── 0..1 HospitalProfile
Donor 1 ────────── N Donation
BloodDrive 1 ───── N CampaignRegistration
CampaignRegistration N ─── 1 Donor
Donation 1 ─────── N BloodComponentUnit
BloodComponentUnit N ─── 1 ComponentType
Facility 1 ─────── N StorageLocation
BloodComponentUnit 1 ─── N InventoryMovement
BloodRequest 1 ─── N BloodRequestLine
BloodRequest 1 ─── N Reservation
Reservation 1 ──── N ReservationItem
ReservationItem N ─── 1 BloodComponentUnit
BloodRequest 1 ─── N Issuance
Issuance 1 ─────── N IssuanceItem
Transfer 1 ─────── N TransferItem
TransferItem N ─── 1 BloodComponentUnit
User 1 ─────────── N AuditEvent
```

## Important invariants

1. An inventory unit has exactly one current facility at a point in time.
2. A unit cannot simultaneously be reserved by two active reservations.
3. A unit cannot be issued twice.
4. An ineligible state cannot become allocatable without a valid transition.
5. A discarded/expired/recalled unit cannot be allocated.
6. A reservation belongs to a request and claims explicit units.
7. Facility-scoped users cannot mutate resources outside their permitted scope.
8. Audit events do not become the source of truth for business state; they explain state changes.
9. Blood request fulfillment is derived from successful reservations/issuances, not manually typed dashboard counters.
10. All consequential state changes are timestamped.

## Public identifiers

Where appropriate, expose non-sequential public references such as:

- donor reference;
- request reference;
- unit label code;
- transfer reference.

Keep internal database IDs private when a public code is sufficient.

## Data minimization

Do not store:

- full patient medical history;
- diagnoses unrelated to blood operations;
- unnecessary copies of hospital records;
- secrets/tokens.

Use a hospital-owned patient/request reference where operational identification is required.
