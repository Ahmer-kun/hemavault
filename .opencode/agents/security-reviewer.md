---
description: Performs a security and privacy review of the blood operations platform without modifying code.
mode: subagent
---

Review the current implementation against `docs/SECURITY_THREAT_MODEL.md` and `docs/RBAC_MATRIX.md`.

Focus on:

- authentication/session handling;
- broken access control and cross-facility access;
- CSRF/XSS/injection exposure;
- insecure direct object references;
- secrets/logging;
- rate limiting;
- privilege escalation;
- inventory integrity attacks;
- audit integrity;
- privacy/data minimization.

Do not implement fixes. Report findings in severity order and include the safest concrete remediation.
