---
name: blood-ops-rebuild
description: Build and review the blood operations platform using its domain, security, inventory, architecture, and testing rules. Load this skill for implementation work on the project.
license: MIT
compatibility: OpenCode project-local skill
metadata:
  project: blood-ops
  purpose: greenfield-rebuild
---

# Blood Operations Rebuild Skill

You are working inside a security-sensitive, transaction-heavy operational platform.

## Before implementation

Read these project references as needed:

- `../../../docs/ARCHITECTURE.md`
- `../../../docs/DOMAIN_MODEL.md`
- `../../../docs/STATE_MACHINES.md`
- `../../../docs/SECURITY_THREAT_MODEL.md`
- `../../../docs/RBAC_MATRIX.md`
- `../../../docs/API_CONTRACT.md`
- `../../../docs/TESTING_STRATEGY.md`
- `../../../PROGRESS.md`
- `../../../DECISIONS.md`

The paths above are relative to this skill directory.

## Operating principles

### Greenfield

Do not reproduce code or UI from the supplied reference application. Re-derive behavior from the target specification.

### Domain-first

For consequential features, implement/test domain rules before building the UI around them.

### Inventory integrity

Treat every blood/component unit as a concrete stateful object. Never use an aggregate quantity update as a substitute for reservation/issuance logic.

### Transactions

Use database transactions for operations that must be atomic. Re-check availability while holding the required lock/claim.

### Authorization

Use permission + resource-scope policies. Never trust the frontend to enforce access.

### Sessions

Do not place authentication tokens in localStorage/sessionStorage. Use secure browser session cookies.

### Testing

Every business rule needs tests. Inventory reservation and state transition code gets extra concurrency coverage.

### Medical boundary

Do not invent clinical policy. Keep reference data configurable and versioned; require authorized human confirmation for high-impact decisions.

## Required implementation loop

```text
Read relevant spec
  ↓
Inspect current code
  ↓
Identify impacted domains
  ↓
Implement domain rule
  ↓
Implement persistence transaction
  ↓
Implement API
  ↓
Implement UI
  ↓
Write/run tests
  ↓
Update docs + PROGRESS.md
  ↓
Review security + acceptance criteria
```

## Do not

- fabricate data;
- hardcode dashboard counts;
- spread raw request bodies into database records;
- bypass state machines;
- log secrets;
- store auth tokens in browser storage;
- expose patient/medical data unnecessarily;
- introduce infrastructure without an ADR;
- mark tasks complete without verification.
