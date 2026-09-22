# Testing Strategy

## Testing pyramid

```text
                E2E
              /     \
        Integration  
          /     \
       Domain / Unit
```

Use the cheapest test that proves the rule.

## Unit tests

Prioritize pure/domain logic:

- state transition validation;
- compatibility matrix lookup;
- request fulfillment calculation;
- inventory candidate filtering;
- FEFO ordering;
- permission policy checks;
- input parsing/normalization;
- expiration classification.

## Integration tests

Use a real test database or isolated database container for:

- Prisma repositories;
- transactions;
- unique constraints;
- row locking/concurrency behavior;
- reservation/issuance workflows;
- transfer workflows;
- audit writes.

## API tests

Test:

- authentication;
- authorization;
- validation;
- facility scoping;
- status-transition rules;
- correct error codes;
- sensitive field exclusion.

## End-to-end tests

Critical flows:

### Donor flow

```text
Register → verify → login → view campaign → book → check-in → view donation history
```

### Staff donation flow

```text
Create donation → collect → screen → quarantine → release → component units appear in inventory
```

### Hospital request flow

```text
Create request → submit → review → match → reserve → issue → receive → fulfilled
```

### Transfer flow

```text
Create transfer → approve → pack → dispatch → in-transit → receive → destination inventory updated
```

### Security flow

```text
Login → session created → logout → session rejected
```

## Concurrency tests

These are mandatory for the inventory core.

Example:

Two requests attempt to reserve the same final eligible unit at the same time.

Expected:

- exactly one reservation succeeds;
- the other receives a safe business error;
- no negative inventory;
- no duplicate active reservation;
- audit trail is correct.

## Regression rule

Every production bug fixed must gain a regression test when practical.

## Frontend tests

Test:

- validation;
- loading/error/empty states;
- critical permission-driven rendering;
- request/response error handling;
- accessible interaction for important workflows.

Do not rely on frontend tests for authorization.

## Static quality

Use:

- TypeScript strict checks;
- ESLint;
- formatter;
- dependency audit;
- secret scanning where available.

## Test data

Provide deterministic seed fixtures for:

- admin users;
- facility manager;
- lab staff;
- hospital staff;
- donor;
- campaigns;
- donations;
- inventory units in multiple states;
- requests at different priorities;
- active reservations;
- transfers;
- notifications.

Never use real personal data in seed fixtures.

## Completion gate

A phase cannot be marked complete if critical tests are skipped without explicit documented justification.
