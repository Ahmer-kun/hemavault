# System Architecture

## 1. Target architecture

Use a modular monolith with clear domain boundaries:

```text
                         ┌─────────────────────────┐
                         │       React Web App     │
                         │  UI / Forms / Tables    │
                         │  Query Cache / Routing  │
                         └────────────┬────────────┘
                                      │ HTTPS
                                      │ Secure Cookie Session
                         ┌────────────▼────────────┐
                         │    API / Application    │
                         │ Auth / Policies / DTOs  │
                         │ Use Cases / Transactions│
                         └────────────┬────────────┘
                                      │
             ┌────────────────────────┼────────────────────────┐
             │                        │                        │
     ┌───────▼────────┐      ┌────────▼────────┐      ┌────────▼────────┐
     │ PostgreSQL     │      │ Optional Worker │      │ Optional Object │
     │ System of      │      │ / Redis after   │      │ Storage adapter │
     │ record         │      │ proven need     │      │ after proven need│
     └────────────────┘      └─────────────────┘      └─────────────────┘
```

## 2. Backend module boundaries

Recommended modules:

- `auth`
- `users`
- `organizations`
- `facilities`
- `donors`
- `campaigns`
- `donations`
- `screening`
- `inventory`
- `compatibility`
- `requests`
- `reservations`
- `issuance`
- `transfers`
- `notifications`
- `audit`
- `reports`
- `health`

Do not allow arbitrary cross-module database access. Prefer application services/use cases and well-defined repositories.

## 3. Suggested backend structure

```text
apps/api/
  src/
    main.ts
    modules/
      auth/
        domain/
        application/
        infrastructure/
        presentation/
      inventory/
        domain/
        application/
        infrastructure/
        presentation/
      ...
    common/
      errors/
      guards/
      policies/
      logging/
      database/
      config/
      http/
```

The exact folder naming may differ, but the separation of domain, application, infrastructure, and presentation responsibilities must remain.

## 4. Suggested frontend structure

```text
apps/web/
  src/
    app/
    routes/
    components/
      ui/
      layout/
      data-display/
      forms/
    features/
      auth/
      dashboard/
      donors/
      donations/
      campaigns/
      inventory/
      requests/
      transfers/
      notifications/
      reports/
    lib/
      api/
      auth/
      validation/
      formatting/
    styles/
```

Feature modules own their API hooks, schemas, view components, and state where practical.

## 5. Request path

```text
Browser
  → Route/UI
  → Query/Mutation hook
  → API client
  → HTTP endpoint
  → Authentication
  → Authorization policy
  → DTO validation
  → Application use case
  → Domain service
  → Prisma transaction/repository
  → PostgreSQL
  → Audit event
  → Response
```

## 6. Business transaction rule

A consequential operation should be implemented as one logical application use case.

Example: reserve inventory

```text
start transaction
  authenticate actor
  authorize facility + action
  load request
  validate request state
  resolve compatible eligible units
  lock candidate units
  re-check availability/state/expiry
  create reservation records
  create inventory movement/event records if required
  update request fulfillment state
  write audit event
commit
```

Do not split this across unrelated API calls from the frontend.

## 7. Database principles

- PostgreSQL as source of truth.
- Foreign keys for relationships.
- Unique constraints for business identities.
- Check constraints where useful.
- Indexed foreign keys and common lookup filters.
- Timestamps stored consistently, preferably UTC.
- Application/user-facing formatting localized at the edge.
- Soft deletion only where there is a clear retention/audit reason. Do not use soft deletion as a substitute for state modeling.

## 8. API principles

- `/api/v1` prefix.
- JSON request/response except explicit file/export endpoints.
- Structured error envelopes.
- Request ID on every response.
- OpenAPI generated/maintained from actual contracts.
- Pagination, filtering, sorting, and explicit limits.
- No leaking internal database identifiers where a public reference is sufficient.
- Idempotency support for operations where retries may duplicate side effects.

## 9. Real-time design

Use WebSockets or server-sent events only for events such as:

- newly created emergency request;
- inventory alert;
- request status changed;
- transfer dispatched/received;
- notification arrival.

The system must remain functionally correct if the real-time connection is unavailable; clients can fall back to normal API polling/refetching.

## 10. Configuration

Separate:

- environment configuration;
- product settings;
- medical/reference rules;
- feature flags.

Do not hardcode environment URLs, credentials, or policy values into source code.

## 11. Observability

At minimum:

- structured application logs;
- request IDs;
- health and readiness endpoints;
- database connection health;
- error tracking hook/adapter;
- audit events for consequential domain actions.

## 12. Architecture evolution rule

Any proposal to introduce a new infrastructure service must answer:

1. What requirement forces it?
2. Why cannot the current architecture satisfy that requirement?
3. What operational burden does it add?
4. What is the failure mode?
5. How is the feature still tested locally at $0?

Record approved changes in `DECISIONS.md`.
