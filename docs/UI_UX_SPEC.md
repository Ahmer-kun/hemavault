# UI / UX Specification

## Product character

The UI should feel like a modern operational SaaS product rather than a university CRUD dashboard.

Desired qualities:

- calm;
- information-dense without being cluttered;
- highly readable;
- accessible;
- fast to scan;
- consistent;
- professional;
- responsive.

Do not reproduce the reference project's visual design.

## Design principles

### 1. Operations first

The first screen for staff should answer:

- What needs attention now?
- What inventory is available?
- What is expiring?
- Which emergency requests are open?
- What changed recently?

### 2. Progressive disclosure

Show the decision-critical fields first. Put deep audit/history information behind expandable panels/tabs.

### 3. Explicit status

Use labels and text in addition to color. Examples:

`AVAILABLE`, `QUARANTINED`, `RESERVED`, `EXPIRED`.

Never communicate state using color alone.

### 4. Safe destructive actions

Discard, reject, revoke, deactivate, and other irreversible/high-impact actions require deliberate confirmation with consequences explained.

## Information architecture

### Public

- Landing page
- Sign in
- Create account
- Verification/reset flows
- Public campaign listing where allowed

### Donor

- Overview
- My appointments
- My donations
- My profile
- Notifications

### Hospital

- Overview
- Create request
- Requests
- Inventory received/held
- Transfers
- Notifications
- Facility profile

### Lab/Blood-bank staff

- Overview
- Donors
- Donations
- Screening
- Inventory
- Requests
- Reservations
- Issuance
- Transfers
- Campaigns
- Notifications

### Facility manager/admin

- Overview
- Facilities
- Users/members
- Inventory
- Requests
- Transfers
- Reports
- Audit
- Settings

## Dashboard patterns

A staff dashboard can contain:

```text
[Available Units] [Urgent Requests] [Expiring Soon] [Pending Actions]

[Inventory by Group/Component]

[Emergency Requests]

[Recent Inventory Activity]

[Upcoming Campaigns / Appointments]
```

Do not fabricate statistics. Every card must come from real API data or be explicitly labeled as a non-persistent visualization.

## Data tables

Use tables for operational data such as:

- blood units;
- requests;
- donors;
- transfers;
- audit events.

Required features where appropriate:

- search;
- filters;
- sort;
- pagination;
- row actions;
- status indicator;
- detail drawer/page;
- empty state;
- loading state;
- error state.

## Forms

All forms should have:

- client-side schema validation for quick feedback;
- server validation as source of truth;
- clear required/optional indicators;
- accessible labels;
- field-level error messages;
- general error summary for submission failures;
- disabled/loading state while submitting;
- unsaved-change handling where needed.

## Emergency request UX

Emergency requests should be visually prominent but not alarmist.

A request detail page should make these facts easy to scan:

- priority;
- required-by time;
- component;
- requested quantity;
- fulfilled quantity;
- destination facility;
- current status;
- compatible/eligible inventory candidates;
- next allowed action.

## Inventory UX

Unit detail should expose:

- public unit code;
- blood group / Rh where recorded;
- component type;
- current state;
- expiration;
- facility/storage location;
- source donation reference;
- movement timeline;
- reservation/issuance status.

## Accessibility

Target a strong WCAG 2.2 AA-oriented implementation.

Minimum engineering requirements:

- semantic elements;
- keyboard support;
- focus visibility;
- correct form labels;
- logical heading hierarchy;
- sufficient contrast;
- reduced-motion support;
- accessible dialogs;
- screen-reader-friendly status messages;
- no color-only state communication.

## Responsive behavior

Design intentionally for:

- large desktop;
- laptop;
- tablet;
- mobile.

On small screens:

- tables can become cards/drawers where necessary;
- filters can collapse into a sheet;
- critical actions remain discoverable;
- emergency request details remain readable.

## Visual system

The implementation should establish design tokens for:

- spacing;
- radii;
- typography;
- surfaces;
- borders;
- focus rings;
- semantic status colors;
- elevation.

Avoid excessive gradients, decorative 3D effects, stock illustrations, and noisy dashboards.

## UX anti-patterns to avoid

- giant dashboard hero section before actual operations;
- fake counters;
- nested modal-on-modal workflows;
- table rows with ten tiny icons and no labels;
- alerts that disappear before users can understand them;
- disabling submit without explaining why;
- relying on client-side filtering for security;
- hiding failed actions behind generic toast messages only.
