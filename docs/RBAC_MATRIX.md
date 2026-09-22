# RBAC / Permission Model

Use roles as bundles of permissions. Do not make roles the only authorization primitive.

## Proposed roles

- `PLATFORM_SUPER_ADMIN`
- `PLATFORM_ADMIN`
- `FACILITY_MANAGER`
- `LAB_STAFF`
- `HOSPITAL_STAFF`
- `DONOR`
- `AUDITOR`

Role names are implementation defaults and can be changed through an ADR.

## Permission catalogue

### Users

- `user.read`
- `user.update`
- `user.deactivate`
- `user.manage_roles`

### Organizations/facilities

- `organization.read`
- `organization.manage`
- `facility.read`
- `facility.manage`
- `facility.manage_members`

### Donors

- `donor.self.read`
- `donor.self.update`
- `donor.read`
- `donor.update`
- `donor.search`

### Campaigns

- `campaign.read`
- `campaign.create`
- `campaign.update`
- `campaign.publish`
- `campaign.cancel`
- `campaign.manage_registrations`

### Donations

- `donation.read`
- `donation.create`
- `donation.update`
- `donation.screen`
- `donation.release`
- `donation.reject`

### Inventory

- `inventory.read`
- `inventory.search`
- `inventory.move`
- `inventory.reserve`
- `inventory.release_reservation`
- `inventory.issue`
- `inventory.quarantine`
- `inventory.discard`
- `inventory.reconcile`

### Requests

- `request.self.create`
- `request.read`
- `request.review`
- `request.approve`
- `request.reject`
- `request.cancel`
- `request.fulfill`

### Transfers

- `transfer.create`
- `transfer.read`
- `transfer.approve`
- `transfer.pack`
- `transfer.dispatch`
- `transfer.receive`
- `transfer.cancel`

### Notifications/reports/audit

- `notification.read`
- `report.read`
- `report.export`
- `audit.read`
- `audit.export`

## Default role mapping

| Role | Typical scope | Core permissions |
|---|---|---|
| Platform Super Admin | Global | All administrative permissions |
| Platform Admin | Global | User/org/facility/report/audit management |
| Facility Manager | Assigned facility | Facility staff, inventory, operational workflows |
| Lab Staff | Assigned lab | Donation processing, screening, inventory, request fulfillment |
| Hospital Staff | Assigned hospital | Requests, visibility into own hospital activity, receive/acknowledge issues/transfers |
| Donor | Own profile | Own profile, appointments, own history, notifications |
| Auditor | Assigned/global based on policy | Read-only audit/report access |

## Facility scoping

Permissions are necessary but not sufficient.

Example:

A user with `inventory.read` may only read units in facilities they are authorized to inspect.

A user with `inventory.issue` may only issue from a facility they are authorized to operate.

## Sensitive operations

Require stronger checks for:

- role changes;
- account deactivation;
- inventory discard;
- high-impact reconciliation;
- reference-rule changes;
- bulk data exports.

Where appropriate, require recent authentication and/or a second approval workflow.

## Authorization implementation rule

Centralize policy evaluation so tests can answer:

```text
Can actor X perform action Y against resource Z in facility F while resource state is S?
```

without rendering a UI or hitting unrelated services.
