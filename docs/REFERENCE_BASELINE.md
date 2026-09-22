# Reference Baseline — Supplied Blood Bank Management System

## Purpose of this document

This is a factual implementation inventory of the supplied ZIP archive. It exists to tell the new implementation what the reference attempted, where it is weak, and what must be deliberately redesigned.

## Observed structure

The archive contained a React/Vite frontend and an Express/Mongoose backend, plus Docker Compose, Swagger/OpenAPI setup, frontend/backend Dockerfiles, and seed/admin support.

The reference contained approximately 96 files in the supplied archive.

## Reference capabilities observed

- Donor registration/profile/history.
- Hospital/facility registration and approval concepts.
- Blood-lab dashboard and stock pages.
- Blood requests.
- Blood camps.
- Admin dashboard and facility/donor views.
- JWT-based authentication middleware.
- MongoDB/Mongoose persistence.
- Swagger/OpenAPI documentation setup.
- Docker Compose support.
- Frontend routing/protected routes.

## Important structural observations

### Multiple identity models

The reference uses separate `User`, `Admin`, `Donor`, and `Facility` persistence models plus overlapping authentication middleware.

**Redo decision:** Use one coherent identity model plus profiles/memberships and role/permission assignments.

### Authentication inconsistency

The backend is JWT-based, while the frontend package includes Clerk dependencies but the application code primarily uses browser storage for bearer tokens.

**Redo decision:** Use one deliberate authentication architecture with secure server-side sessions for the web application.

### Aggregate blood model

The reference blood model primarily tracks `bloodGroup`, `quantity`, `expiryDate`, and facility ownership.

**Redo decision:** Use discrete component units, exact unit state, inventory movements, reservations, and issuance.

### Request model is too small

The reference request model is essentially facility-to-lab + blood type + units + status.

**Redo decision:** Introduce request lines, priority, required-by timing, patient reference, compatibility/matching, reservation, partial fulfillment, issuance, and audit traceability.

### Placeholder dashboard behavior

The reference contains controller logic with placeholder values/comments for dashboard counts (for example blood-slot and active-request counts).

**Redo decision:** All visible metrics must be derived from persisted domain data or explicitly identified as non-production demo values.

### State/value inconsistency

The reference contains multiple versions of similar concepts and inconsistent naming/casing across status fields and routes.

**Redo decision:** Use explicit enumerations and centralized state-transition rules.

### Camp schema issue

The reference contains a camp pre-save hook referencing fields that are not consistently defined in the schema, indicating a fragile lifecycle/expiry implementation.

**Redo decision:** Keep campaign scheduling separate from blood component expiry. Use explicit domain entities and state machines.

### Locale-specific validation

The reference includes validation patterns such as six-digit Indian postal codes and Indian-style phone validation.

**Redo decision:** Make locale/contact formatting configurable and avoid hardcoding geography into general-purpose domain logic.

### Test coverage

The reference backend package has no real automated test script; its test script is a placeholder.

**Redo decision:** Testing is a first-class implementation requirement.

### Token storage

The reference frontend reads bearer tokens from `localStorage`.

**Redo decision:** Do not carry this pattern forward. Use secure cookie sessions.

### CORS/environment coupling

The reference server contains hardcoded localhost origins and environment-dependent assumptions.

**Redo decision:** Centralize validated configuration and deployment-aware origin policy.

## Reference-to-target translation

| Reference concept | Target redesign |
|---|---|
| Donor model | User + DonorProfile |
| Facility model | Organization + Facility + membership |
| Blood quantity record | BloodComponentUnit + InventoryMovement |
| Blood request | BloodRequest + BloodRequestLine |
| Request status | Explicit request state machine |
| Blood camp | BloodDrive + CampaignRegistration |
| Facility history | Domain events + AuditEvent |
| JWT in localStorage | Secure server-side session |
| Role string checks | Permission/policy system |
| Dashboard placeholders | Real read models/queries |
| MongoDB document relationships | PostgreSQL relational constraints |

## What not to preserve merely because the reference has it

- duplicate models;
- duplicate auth middleware;
- localStorage bearer tokens;
- hardcoded dashboard values;
- arbitrary history arrays as an audit system;
- simple blood-group quantity counters as the inventory source of truth;
- copied UI layouts;
- copied screenshots or branding;
- route names chosen only for legacy compatibility.
