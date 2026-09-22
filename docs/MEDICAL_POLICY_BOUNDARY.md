# Medical / Clinical Policy Boundary

This project must remain an operational management system unless a future, explicitly reviewed scope expands it.

## Rules

1. Do not invent clinical guidance.
2. Do not infer donor eligibility from casual personal-health data.
3. Do not treat a compatibility table as a medical approval.
4. Do not auto-authorize issuance solely because a rule engine returns a match.
5. Keep policy/reference data versioned.
6. Require human authorized staff to confirm high-impact clinical/operational decisions.
7. Display a clear indication when a result is an operational match rather than a clinical decision.

## Configurable reference data

The platform should support versioned reference configuration for:

- component types;
- compatibility relationships;
- operational expiration policies;
- donation interval/eligibility policy inputs if the product later includes them.

The exact values should be populated from authoritative sources during a controlled implementation step and should not be invented in application code.

## Auditability

When a compatibility/configuration result contributes to an allocation workflow, persist which rule-set version was used.
