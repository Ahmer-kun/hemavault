# State Machines and Valid Transitions

The exact enum values may be adjusted during implementation, but invalid transitions must be rejected by the domain layer.

## Donation

```text
SCHEDULED
  ├─→ CHECKED_IN
  └─→ CANCELLED

CHECKED_IN
  └─→ COLLECTED

COLLECTED
  └─→ SCREENING

SCREENING
  ├─→ QUARANTINED
  └─→ REJECTED

QUARANTINED
  ├─→ RELEASED
  └─→ REJECTED

RELEASED
  └─→ COMPLETED
```

`REJECTED`, `CANCELLED`, and completed terminal states should not be casually reopened.

## Inventory unit

```text
COLLECTED
   ↓
QUARANTINED
   ├─→ AVAILABLE
   └─→ DISCARDED

AVAILABLE
   ├─→ RESERVED
   ├─→ TRANSFER_PENDING
   ├─→ QUARANTINED
   ├─→ EXPIRED
   └─→ DISCARDED

RESERVED
   ├─→ AVAILABLE
   ├─→ ISSUED
   ├─→ TRANSFER_PENDING
   └─→ EXPIRED / DISCARDED where policy explicitly allows

TRANSFER_PENDING
   └─→ IN_TRANSIT

IN_TRANSIT
   ├─→ RECEIVED
   └─→ EXCEPTION / RETURN workflow if implemented

ISSUED
   ├─→ RECEIVED_BY_DESTINATION
   └─→ CLOSED / USED tracking if required
```

A unit can only be in one current state.

## Blood request

```text
DRAFT
  ↓
SUBMITTED
  ├─→ REJECTED
  ├─→ CANCELLED
  ├─→ EXPIRED
  └─→ APPROVED

APPROVED
  ├─→ PARTIALLY_FULFILLED
  ├─→ FULFILLED
  └─→ CANCELLED / EXPIRED

PARTIALLY_FULFILLED
  ├─→ PARTIALLY_FULFILLED
  ├─→ FULFILLED
  └─→ CANCELLED / EXPIRED
```

## Reservation

```text
ACTIVE
  ├─→ CONVERTED_TO_ISSUANCE
  ├─→ RELEASED
  ├─→ CANCELLED
  └─→ EXPIRED
```

## Transfer

```text
REQUESTED
  ├─→ REJECTED
  ├─→ CANCELLED
  └─→ APPROVED

APPROVED
  └─→ PACKED

PACKED
  └─→ DISPATCHED

DISPATCHED
  └─→ IN_TRANSIT

IN_TRANSIT
  ├─→ RECEIVED
  └─→ EXCEPTION/RETURN workflow
```

## Authorization principle

The UI can only expose transitions the actor might execute, but the backend must validate:

- current state;
- actor permission;
- facility scope;
- required prerequisites;
- required fields;
- concurrency/version assumptions.

## Idempotency principle

Repeated submission of the same command should not produce duplicate side effects where the request can be safely retried.
