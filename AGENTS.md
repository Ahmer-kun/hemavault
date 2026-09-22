# Blood Operations Platform — OpenCode Project Instructions

These instructions are mandatory for all implementation work in this repository.

## 1. Mission

Build a production-oriented blood operations platform from the specifications in `docs/`.
This is a **greenfield rebuild** inspired by a supplied reference application. The reference is not the source of truth for architecture, code, UI, schemas, naming, or behavior.

## 2. Read-before-code gate

Before changing application code, read:

1. `MASTER_PROMPT.md`
2. `PROGRESS.md`
3. `docs/PROJECT_CHARTER.md`
4. `docs/ARCHITECTURE.md`
5. `docs/PRODUCT_REQUIREMENTS.md`
6. `docs/DOMAIN_MODEL.md`
7. `docs/STATE_MACHINES.md`
8. `docs/SECURITY_THREAT_MODEL.md`
9. `docs/RBAC_MATRIX.md`
10. `docs/API_CONTRACT.md`
11. `docs/UI_UX_SPEC.md`
12. `docs/TESTING_STRATEGY.md`
13. `docs/ACCEPTANCE_CRITERIA.md`
14. `DECISIONS.md`
15. `docs/REFERENCE_BASELINE.md` when evaluating legacy behavior.

Do not skip the architecture/security documents because the task appears small.

## 3. Reference code policy

If the old project is present in the workspace:

- Treat it as disposable reference material.
- Do not copy source code, JSX structure, controller structure, models, route naming, CSS, screenshots, branding, or documentation wording.
- Do not preserve accidental bugs or architectural weaknesses just because the old system already implements a feature.
- Re-derive behavior from the specification and explicitly record any deliberate compatibility choice in `DECISIONS.md`.
- Do not copy the old MIT license or attribution into newly written code simply because it was present in the reference; the target project is intended to contain independent implementation. If any code is ever intentionally reused, stop and record the provenance/licensing decision before reusing it.

## 4. Architecture guardrails

- Use a modular monolith unless a documented ADR proves a separate service is required.
- Backend: TypeScript, NestJS-style modular architecture, PostgreSQL, Prisma.
- Frontend: React + TypeScript + Vite, Tailwind CSS, accessible component primitives, TanStack Query for server state.
- API: versioned REST under `/api/v1` with OpenAPI.
- Use WebSockets only for real-time operational events that materially benefit from push delivery.
- Do not add Redis, queues, object storage, microservices, or paid third-party APIs until there is a concrete requirement and an ADR.

## 5. Security guardrails

- Never persist auth tokens in `localStorage` or `sessionStorage`.
- Prefer secure, HTTP-only, SameSite cookies for browser sessions.
- Passwords must use Argon2id or a comparably strong modern password hashing algorithm approved in an ADR.
- Enforce authorization on the server for every protected operation. UI hiding is not authorization.
- Use allowlisted actions/permissions, not scattered role string checks.
- Validate all external input.
- Use database transactions for inventory, reservations, issuance, transfers, and other multi-write business operations.
- Use generic authentication error messages to reduce account enumeration.
- Rate-limit authentication and other abuse-prone endpoints.
- Never write passwords, raw session tokens, reset tokens, or unnecessary donor/patient data into logs.
- High-impact actions must be auditable.
- Security-sensitive changes require tests.

## 6. Medical-safety boundary

This is an operational software system, not an autonomous clinical decision-maker.

- Compatibility rules must be explicit, configurable, and traceable to approved reference material.
- Do not invent donation eligibility, deferral, shelf-life, or transfusion policy from model memory.
- The system may assist staff by filtering and matching inventory according to configured rules, but authorized human personnel retain responsibility for final clinical/operational validation.
- When implementing a medical rule not fully specified here, record the uncertainty in `DECISIONS.md` rather than silently guessing.

## 7. Data integrity

Blood inventory is not a simple mutable quantity table.

- Model discrete blood/component units.
- Maintain immutable inventory movement events.
- State transitions must be validated.
- Prevent double reservation/issuance using transactional locking/constraints.
- Prefer FEFO-style allocation for eligible inventory where policy permits, but do not bypass compatibility, quarantine, expiration, or facility restrictions.
- Never allow negative available inventory.
- Provide reconciliation/admin tooling where calculated inventory and ledger state could diverge.

## 8. Code quality

- TypeScript strict mode.
- Small cohesive modules.
- No `any` unless justified and documented.
- No silent error swallowing.
- No TODO placeholders in production paths.
- No hardcoded credentials, environment-specific URLs, or fake counts.
- Use structured error codes and request IDs.
- Keep domain logic out of controllers/components.
- Prefer pure domain functions for compatibility and state-transition validation.

## 9. Testing gate

Every completed feature must include appropriate tests.
At minimum:

- Unit tests for domain rules.
- Integration tests for database-backed workflows.
- API tests for authorization and validation.
- End-to-end coverage for critical workflows.
- Regression tests for every fixed defect.

Do not declare a phase complete while tests are failing or core acceptance criteria are unverified.

## 10. Progress tracking

`PROGRESS.md` is authoritative.

After each meaningful task:

1. Mark the relevant item complete/in-progress/blocked.
2. Record what changed.
3. Record verification performed.
4. Record blockers or assumptions.
5. Add an entry to `DECISIONS.md` when an architectural/product decision was made.

Do not mark work complete merely because files were created.

## 11. Verification commands

Use the project's actual package manager and scripts once created. The intended final verification pipeline is conceptually:

- typecheck
- lint
- unit tests
- integration tests
- end-to-end tests
- production build
- schema/migration validation
- security/static analysis where configured

If a command does not exist yet, create it in the appropriate implementation phase rather than pretending it passed.

## 12. No clarification loop by default

When a requirement is ambiguous but non-blocking, choose the safest conservative interpretation, implement it, and record the decision.

Ask for user input only when the ambiguity creates a material legal, safety, irreversible data-loss, or architecture deadlock.

## 13. Definition of done

A feature is done only when:

- behavior exists;
- authorization is enforced server-side;
- validation exists;
- failure paths are handled;
- appropriate tests exist and pass;
- UI states are complete (loading/empty/error/success where relevant);
- audit requirements are implemented where relevant;
- documentation/progress is updated;
- no known critical security issue remains.

## 14. Required working style

Prefer small, reversible increments. Before large destructive changes, capture the current state in Git or equivalent version control.

When a design conflict is found, stop implementation of the conflicting feature, resolve the conflict in the architecture/decision records, then continue.

Never optimize for speed at the expense of data integrity or security.
