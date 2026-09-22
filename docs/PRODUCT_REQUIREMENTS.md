# Product Requirements

## 1. Authentication and account lifecycle

The system must support:

- registration for allowed account types;
- email verification;
- login/logout;
- session revocation;
- password reset;
- profile management;
- role/permission assignment by authorized administrators;
- account activation/deactivation;
- security event logging.

Account enumeration should be minimized through generic responses where appropriate.

## 2. Organizations and facilities

Support organizations containing facilities.

A facility may be:

- blood bank;
- laboratory/processing center;
- hospital;
- mobile donation center;
- another future operational facility type.

Each facility has:

- identity/profile;
- contact information;
- operating status;
- address/location data;
- organization membership;
- staff membership;
- permissions/scope;
- audit history.

## 3. Donor management

Donors can:

- manage a profile;
- see their donation history;
- browse eligible campaigns/appointments;
- book/cancel appointments where permitted;
- receive notifications.

Authorized staff can:

- search donors;
- filter by permitted operational fields;
- see donation history;
- manage campaign attendance;
- record operational donation outcomes.

The system should not create a giant medical record. Keep donor data proportional to the operational need.

## 4. Blood drives/campaigns

Authorized staff can:

- create a campaign;
- specify facility/location;
- set date/time windows;
- set target/capacity;
- publish/cancel/complete a campaign;
- manage donor registrations;
- record attendance/check-in;
- summarize collected donations.

## 5. Donation workflow

Support the lifecycle:

`SCHEDULED → CHECKED_IN → COLLECTED → SCREENING → QUARANTINED → RELEASED`

and valid terminal/exception branches such as `REJECTED` and `CANCELLED`.

Actual medical eligibility criteria are external/configurable policy, not invented in the core code.

## 6. Component processing

A single donation may produce one or more blood components according to configured operational workflow.

Each resulting component unit needs:

- unique unit identifier;
- source donation;
- component type;
- ABO/Rh grouping where available/required;
- screening/release status;
- collection/processing timestamps;
- expiration timestamp according to configured policy;
- facility/storage location;
- current state;
- traceability back to the donation.

## 7. Inventory

Authorized users can:

- search and filter units;
- view stock summaries;
- view individual units;
- move units between storage locations;
- reserve units;
- issue units;
- quarantine units;
- discard expired/unsafe units through controlled workflows;
- reconcile inventory;
- view movement history.

Inventory must not allow:

- negative available units;
- expired units to be allocated when policy forbids it;
- quarantined/recalled units to be allocated;
- double reservation;
- cross-facility mutation without authorization.

## 8. Blood requests

Hospital/facility users can create requests with:

- request type;
- urgency (`NORMAL`, `URGENT`, `EMERGENCY`, `CRITICAL`);
- required-by timestamp;
- requested component type;
- ABO/Rh requirement where applicable;
- quantity;
- hospital/patient reference code;
- notes appropriate to operational use;
- destination facility.

A request supports:

- draft;
- submission;
- review;
- approval/rejection;
- partial fulfillment;
- full fulfillment;
- cancellation/expiry.

## 9. Matching

The matching service should filter candidates by configured rules including, as applicable:

- component compatibility;
- blood-group compatibility matrix;
- unit state;
- screening/release status;
- expiration;
- facility/location scope;
- reservations already present;
- request timing/priority;
- operational restrictions.

The UI should explain why a unit is included/excluded at an operational level without claiming autonomous clinical authority.

## 10. Reservation

Reservation must be transactional.

A successful reservation should:

- lock/claim exact units;
- link them to the request;
- record actor and timestamps;
- set expiration when appropriate;
- prevent another request from claiming them;
- support release or conversion to issuance.

## 11. Issuance

Authorized staff can convert valid reservations into issuance records.

The issue workflow must record:

- units issued;
- request;
- source facility;
- destination facility/pickup party;
- actor;
- timestamp;
- status;
- handoff/receipt confirmation where applicable.

## 12. Transfers

Facilities may request transfers.

Lifecycle:

`REQUESTED → APPROVED → PACKED → DISPATCHED → IN_TRANSIT → RECEIVED`

with `CANCELLED` and `REJECTED` where appropriate.

Inventory must remain consistent across source/destination facilities throughout the workflow.

## 13. Notifications

Support in-app notifications for important events.

Possible future channels:

- email;
- SMS;
- other adapters.

Core product correctness must not depend on a paid provider.

## 14. Reporting

Provide operational reporting for:

- current inventory;
- expiring units;
- donation volume;
- campaign performance;
- request volume;
- fulfillment rate;
- response time;
- transfer history;
- discard/expiry history;
- facility activity;
- audit events for authorized oversight.

## 15. Search

Provide structured search/filter interfaces with server-side pagination and bounded query limits.

## 16. Data retention

Define configurable retention policies for audit/security events and non-essential operational records.

Do not implement irreversible deletion of legally/operationally important records without a documented retention policy.
