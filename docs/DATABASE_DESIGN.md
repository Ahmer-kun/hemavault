# Database Design Notes

## Primary database

PostgreSQL.

Prisma is the intended migration/data-access layer, but business logic must not become dependent on generated client details everywhere. Keep persistence behind domain/application boundaries where practical.

## Key tables/entities

```text
users
roles
permissions
user_roles
organizations
facilities
facility_memberships
sessions
email_verification_tokens
password_reset_tokens

donor_profiles
hospital_profiles
blood_drives
campaign_registrations

donations
donation_screenings
component_types
blood_component_units
storage_locations
inventory_movements

blood_requests
blood_request_lines
reservations
reservation_items
issuances
issuance_items
transfers
transfer_items

notifications
audit_events
compatibility_rule_sets
compatibility_rules
```

## Indexing expectations

Index at minimum on:

- user email;
- facility organization;
- facility status;
- donor searchable fields according to privacy/security review;
- blood unit state + facility;
- blood unit expiration;
- blood unit group/component;
- reservation active/unit;
- requests by facility/status/urgency/required-by;
- transfers by source/destination/status;
- notifications by recipient/unread;
- audit events by actor/entity/timestamp.

## Uniqueness expectations

Examples:

- unique user email;
- unique public unit code;
- one active session identifier per session;
- one active reservation claim per inventory unit;
- unique membership per user/facility.

Exact constraints should be finalized in the migration design and tested against actual PostgreSQL behavior.

## Transactions

Mandatory transaction candidates:

- registration with related profile;
- role/permission changes;
- donation release that creates component units;
- reservation;
- issuance;
- transfer dispatch/receipt;
- reconciliation adjustments.

## Audit storage

Audit records should be append-oriented. If a tamper-evident chain is adopted, document that it provides tamper evidence rather than absolute immutability against database-admin compromise.

## Time handling

Store timestamps in UTC. Convert for user display based on configured facility/user locale.

Do not store dates as ambiguous strings when a real timestamp/date type is appropriate.
