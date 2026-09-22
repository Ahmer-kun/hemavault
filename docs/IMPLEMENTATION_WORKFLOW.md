# Implementation Workflow

## Rule 1 — Plan the slice

Before implementing a non-trivial feature, identify:

- affected domain;
- data changes;
- API changes;
- UI changes;
- authorization impact;
- audit impact;
- tests needed;
- migration impact.

## Rule 2 — Domain first

For business-critical workflows:

```text
Domain rules
   ↓
Application use case
   ↓
Persistence transaction
   ↓
API
   ↓
UI
```

Do not begin by building a screen and inventing backend behavior later.

## Rule 3 — Small commits/changes

Prefer changes that can be reviewed and reverted.

## Rule 4 — Verify after change

For every slice:

1. format/lint;
2. typecheck;
3. focused tests;
4. integration tests if data behavior changed;
5. UI build if frontend changed.

## Rule 5 — Update project memory

Update:

- `PROGRESS.md`;
- `DECISIONS.md` if decisions changed;
- API docs if endpoints changed;
- domain/state docs if behavior changed;
- acceptance criteria when newly satisfied.

## Rule 6 — Never hide uncertainty

When implementation depends on an external policy or specification that is not available, mark the rule configurable and document the assumption. Do not silently invent a production policy.

## Rule 7 — Keep seed data realistic but synthetic

Seed data should exercise:

- multiple facilities;
- multiple blood groups;
- expiring inventory;
- reserved units;
- emergency request;
- transfer in transit;
- donor campaign activity.

Do not use real people, real addresses, or real medical information.
