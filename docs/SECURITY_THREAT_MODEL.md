# Security Threat Model

## Security objective

Protect account access, personal information, operational inventory data, and audit integrity while preserving availability for legitimate users.

## Assets

- User accounts and credentials.
- Session identifiers.
- Donor personal data.
- Hospital/facility information.
- Blood inventory and unit identifiers.
- Requests/reservations/issuance records.
- Audit records.
- Configuration/reference rules.
- Database credentials and application secrets.
- Operational reports.

## Trust boundaries

```text
Public browser
   │
   ▼
Internet / reverse proxy
   │
   ▼
Web/API application
   │
   ├──── PostgreSQL
   ├──── Email/provider adapter (optional)
   └──── Worker/Redis (optional)
```

Treat every external request as untrusted.

## Threat catalogue

### T01 — Credential stuffing / brute force

**Controls:** rate limiting, generic errors, strong password hashing, session security, optional 2FA for privileged roles, suspicious-login audit events.

### T02 — Session theft

**Controls:** HTTP-only secure cookies, SameSite policy, TLS in deployment, session rotation, revocation, short inactivity/absolute lifetimes, no tokens in localStorage.

### T03 — Broken object-level authorization / IDOR

**Controls:** resource-level policy checks, facility scope enforcement, tests that attempt cross-facility access.

### T04 — Privilege escalation

**Controls:** centralized permission checks, deny-by-default policies, protected admin operations, audit role changes, step-up authentication where appropriate.

### T05 — CSRF

**Controls:** SameSite cookies plus explicit CSRF defense appropriate to deployment topology; test state-changing requests from an untrusted origin.

### T06 — XSS

**Controls:** output encoding, safe React rendering, no unsafe HTML by default, content-security policy strategy, dependency scanning.

### T07 — Injection

**Controls:** Prisma parameterization, structured query APIs, validation, bounded filters, no string-built SQL unless reviewed.

### T08 — Mass assignment

**Controls:** explicit DTOs/commands; never spread arbitrary request bodies into persistence objects.

### T09 — Inventory race condition

**Controls:** transaction boundaries, row locking/claiming strategy, unique constraints, re-check under transaction, concurrency tests.

### T10 — Audit tampering

**Controls:** append-oriented audit writes, restricted permissions, optional tamper-evident hash chaining, protected admin access, backups.

### T11 — Sensitive data leakage in logs

**Controls:** structured log redaction, prohibited fields list, test logging helpers, no credentials/tokens/health details that are not needed.

### T12 — Malicious file upload (future)

**Controls:** deny by default, content-type and size validation, non-executable storage, malware scanning adapter if attachments become a requirement.

### T13 — Denial of service / abuse

**Controls:** rate limits, bounded payloads, pagination limits, request timeouts, expensive query protection.

### T14 — Dependency compromise

**Controls:** lockfiles, review additions, automated dependency audit, minimal dependency footprint.

### T15 — Secret leakage

**Controls:** environment-based secrets, `.env` ignored, no secrets in repository, secret scanners, no secret values in error responses.

## Authentication requirements

- password hashing with Argon2id or approved equivalent;
- password minimum length appropriate for policy;
- login throttling;
- generic login failure message;
- secure sessions;
- explicit logout/revocation;
- reset tokens single-use and stored hashed if persisted;
- verification tokens single-use and expiring;
- privileged actions may require recent authentication.

## Authorization requirements

Authorization is evaluated in this order:

```text
Authenticated?
  ↓
Active account?
  ↓
Has required permission?
  ↓
Resource belongs to allowed organization/facility scope?
  ↓
Current resource state permits action?
  ↓
Execute use case
```

## Audit requirements

Audit high-impact events including:

- login failures/successes where security value exists;
- password/security changes;
- role/permission changes;
- account activation/deactivation;
- inventory unit state changes;
- reservations;
- issuance;
- transfers;
- request approvals/rejections;
- record deletion where deletion is allowed;
- reference-rule changes.

Audit records should include:

- actor;
- action;
- target type/id;
- timestamp;
- facility/organization context;
- request ID;
- safe structured metadata;
- before/after snapshots only where appropriate and privacy-safe.

## Privacy requirements

- Minimize donor data.
- Avoid storing unnecessary patient-identifying information.
- Apply role/facility scoping to personal data.
- Do not expose donor contact details to users without a documented operational permission.
- Provide retention/deletion policy documentation.
- Avoid personal data in URL paths where possible.

## Security testing requirements

The project must include tests for:

- unauthenticated access;
- cross-role access;
- cross-facility access;
- direct object identifier guessing;
- duplicate reservations;
- replayed commands where relevant;
- expired sessions;
- revoked sessions;
- invalid state transitions;
- malformed input;
- rate limits;
- CSRF behavior;
- sensitive-data exposure in logs/API responses.

## Security posture rule

A convenient UI is never a reason to weaken an authorization or integrity control.
