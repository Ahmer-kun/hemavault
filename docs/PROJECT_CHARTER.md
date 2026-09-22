# Project Charter

## Working identity

- Internal codename: `blood-ops`
- Public product name: TBD
- Product type: Blood donation, inventory, request, and facility operations platform
- Delivery model: Web application, responsive
- Architecture: Secure modular monolith

## Product goal

Create a practical operations platform that helps authorized organizations manage blood donation workflows, component inventory, hospital requests, reservations, transfers, and operational reporting in a consistent, auditable, secure system.

## Primary users

1. Donors
2. Hospital staff
3. Blood-bank/laboratory staff
4. Facility managers
5. Platform administrators
6. Auditors/oversight users where required

## Product outcomes

The system should make it easier to:

- know what inventory exists and where it is;
- understand the lifecycle and status of each unit;
- process hospital requests consistently;
- avoid double reservation and accidental over-allocation;
- track transfers and issuance;
- maintain trustworthy audit history;
- organize donor appointments and campaigns;
- surface operational alerts;
- produce useful management reports.

## Non-goals

- Autonomous medical diagnosis.
- Autonomous transfusion decisions.
- A full hospital EMR.
- A replacement for laboratory information systems.
- A payment platform in the core release.
- Microservices solely for architecture aesthetics.

## Success characteristics

A successful implementation is:

- understandable to another engineer;
- safe against common web application attacks;
- transactionally correct for inventory workflows;
- testable from a clean checkout;
- reproducible locally with open-source tooling;
- accessible and responsive;
- clearly distinct from the supplied reference application.

## Core product principles

### Trust over convenience

Never hide an inventory inconsistency to make a dashboard look clean.

### Least privilege

A user sees and changes only what their permissions and facility scope allow.

### Traceability

Consequential changes should answer: who, what, when, where, why, and from which prior state.

### Data minimization

Do not collect data just because a database can store it.

### Explicitness

Domain rules should be visible in code, documents, and tests.

### Reproducibility

A clean clone should be enough to create a working development environment without paid services.
