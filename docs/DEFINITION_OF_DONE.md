# Definition of Done

A task/feature is done only if all applicable items are true:

## Functional

- expected behavior works;
- invalid behavior is rejected;
- edge cases are handled;
- state transitions are explicit.

## Security

- authentication/authorization checked;
- sensitive data exposure reviewed;
- inputs validated;
- abuse/rate limit implications considered;
- logs redact secrets.

## Data

- migrations work from empty database;
- indexes/constraints exist where required;
- transaction boundaries are correct;
- audit behavior is implemented where required.

## API

- OpenAPI updated;
- stable error code exists;
- pagination/filters bounded;
- response shape documented.

## UI

- loading state;
- empty state;
- error state;
- success feedback;
- accessible form labels/errors;
- responsive behavior;
- permission-aware actions.

## Tests

- relevant unit tests;
- relevant integration/API tests;
- E2E if critical workflow;
- regression test for bug fixes.

## Documentation

- progress updated;
- ADR added if needed;
- domain/state docs updated if behavior changed.
