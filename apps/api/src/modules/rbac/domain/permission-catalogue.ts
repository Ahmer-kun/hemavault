export interface PermissionDefinition {
  code: string;
  category: string;
  description: string;
}

export const PERMISSION_CATALOGUE: readonly PermissionDefinition[] = [
  // Users
  { code: 'user.read', category: 'users', description: 'List and view platform user records.' },
  { code: 'user.update', category: 'users', description: 'Update user profile fields managed by staff.' },
  { code: 'user.deactivate', category: 'users', description: 'Disable or re-enable a user account.' },
  { code: 'user.manage_roles', category: 'users', description: 'Assign and remove global roles for users.' },
  // Organizations / facilities
  { code: 'organization.read', category: 'organizations', description: 'List and view organizations in scope.' },
  { code: 'organization.manage', category: 'organizations', description: 'Create and update organizations.' },
  { code: 'facility.read', category: 'organizations', description: 'List and view facilities in scope.' },
  { code: 'facility.manage', category: 'organizations', description: 'Create and update facilities in scope.' },
  { code: 'facility.manage_members', category: 'organizations', description: 'Add and remove facility staff memberships.' },
  // Donors
  { code: 'donor.self.read', category: 'donors', description: 'Read your own donor profile and history.' },
  { code: 'donor.self.update', category: 'donors', description: 'Update your own donor profile.' },
  { code: 'donor.read', category: 'donors', description: 'View donor records in scope.' },
  { code: 'donor.update', category: 'donors', description: 'Update donor records in scope.' },
  { code: 'donor.search', category: 'donors', description: 'Search donors within the permitted scope.' },
  // Campaigns
  { code: 'campaign.read', category: 'campaigns', description: 'List and view campaigns in scope.' },
  { code: 'campaign.create', category: 'campaigns', description: 'Create campaigns.' },
  { code: 'campaign.update', category: 'campaigns', description: 'Update campaigns in scope.' },
  { code: 'campaign.publish', category: 'campaigns', description: 'Publish a campaign for registration.' },
  { code: 'campaign.cancel', category: 'campaigns', description: 'Cancel a campaign.' },
  { code: 'campaign.manage_registrations', category: 'campaigns', description: 'Manage campaign registrations and check-ins.' },
  // Donations
  { code: 'donation.read', category: 'donations', description: 'View donation records in scope.' },
  { code: 'donation.create', category: 'donations', description: 'Create donation events.' },
  { code: 'donation.update', category: 'donations', description: 'Update donation records in scope.' },
  { code: 'donation.screen', category: 'donations', description: 'Record donation screening results.' },
  { code: 'donation.release', category: 'donations', description: 'Release a donation to component production.' },
  { code: 'donation.reject', category: 'donations', description: 'Reject a donation.' },
  // Inventory
  { code: 'inventory.read', category: 'inventory', description: 'View inventory units in scope.' },
  { code: 'inventory.search', category: 'inventory', description: 'Search inventory within the scope.' },
  { code: 'inventory.move', category: 'inventory', description: 'Move units between storage locations and facilities.' },
  { code: 'inventory.reserve', category: 'inventory', description: 'Reserve units for a request.' },
  { code: 'inventory.release_reservation', category: 'inventory', description: 'Release a reservation claim on a unit.' },
  { code: 'inventory.issue', category: 'inventory', description: 'Issue units to fulfill a request.' },
  { code: 'inventory.quarantine', category: 'inventory', description: 'Place a unit in quarantine.' },
  { code: 'inventory.discard', category: 'inventory', description: 'Discard a unit.' },
  { code: 'inventory.reconcile', category: 'inventory', description: 'Run inventory reconciliation adjustments.' },
  // Requests
  { code: 'request.self.create', category: 'requests', description: 'Create a request on your own behalf.' },
  { code: 'request.read', category: 'requests', description: 'View requests in scope.' },
  { code: 'request.review', category: 'requests', description: 'Review a pending request.' },
  { code: 'request.approve', category: 'requests', description: 'Approve a request for fulfillment.' },
  { code: 'request.reject', category: 'requests', description: 'Reject a request.' },
  { code: 'request.cancel', category: 'requests', description: 'Cancel a request.' },
  { code: 'request.fulfill', category: 'requests', description: 'Reserve and issue units for a request.' },
  // Transfers
  { code: 'transfer.create', category: 'transfers', description: 'Create an inter-facility transfer.' },
  { code: 'transfer.read', category: 'transfers', description: 'View transfers in scope.' },
  { code: 'transfer.approve', category: 'transfers', description: 'Approve a transfer.' },
  { code: 'transfer.pack', category: 'transfers', description: 'Pack units for dispatch.' },
  { code: 'transfer.dispatch', category: 'transfers', description: 'Dispatch a transfer.' },
  { code: 'transfer.receive', category: 'transfers', description: 'Receive and reconcile a transfer.' },
  { code: 'transfer.cancel', category: 'transfers', description: 'Cancel a transfer.' },
  // Notifications / reports / audit
  { code: 'notification.read', category: 'notifications', description: 'Read notifications addressed to you.' },
  { code: 'report.read', category: 'reports', description: 'View operational reports in scope.' },
  { code: 'report.export', category: 'reports', description: 'Export operational reports.' },
  { code: 'audit.read', category: 'audit', description: 'View the audit log.' },
  { code: 'audit.export', category: 'audit', description: 'Export audit log entries.' },
];

export type PermissionCode = (typeof PERMISSION_CATALOGUE)[number]['code'];

export const ROLE_CODES = [
  'PLATFORM_SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'FACILITY_MANAGER',
  'LAB_STAFF',
  'HOSPITAL_STAFF',
  'DONOR',
  'AUDITOR',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  description: string;
  scope: 'GLOBAL' | 'FACILITY';
  permissions: readonly PermissionCode[];
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    code: 'PLATFORM_SUPER_ADMIN',
    name: 'Platform Super Admin',
    description: 'Global role granting every permission in the catalogue.',
    scope: 'GLOBAL',
    permissions: PERMISSION_CATALOGUE.map((p) => p.code),
  },
  {
    code: 'PLATFORM_ADMIN',
    name: 'Platform Admin',
    description: 'Global role for platform user, organization, facility, reporting, and audit administration.',
    scope: 'GLOBAL',
    permissions: [
      'user.read',
      'user.update',
      'user.deactivate',
      'user.manage_roles',
      'organization.read',
      'organization.manage',
      'facility.read',
      'facility.manage',
      'facility.manage_members',
      'donor.read',
      'donor.update',
      'donor.search',
      'campaign.read',
      'donation.read',
      'inventory.read',
      'inventory.search',
      'request.read',
      'request.review',
      'request.approve',
      'request.reject',
      'request.cancel',
      'transfer.read',
      'transfer.approve',
      'transfer.cancel',
      'notification.read',
      'report.read',
      'report.export',
      'audit.read',
      'audit.export',
    ],
  },
  {
    code: 'FACILITY_MANAGER',
    name: 'Facility Manager',
    description: 'Facility-scoped operational management and staff administration.',
    scope: 'FACILITY',
    permissions: [
      'organization.read',
      'facility.read',
      'facility.manage',
      'facility.manage_members',
      'donor.read',
      'donor.update',
      'donor.search',
      'campaign.read',
      'campaign.create',
      'campaign.update',
      'campaign.publish',
      'campaign.cancel',
      'campaign.manage_registrations',
      'donation.read',
      'donation.create',
      'donation.update',
      'donation.screen',
      'donation.release',
      'donation.reject',
      'inventory.read',
      'inventory.search',
      'inventory.move',
      'inventory.reserve',
      'inventory.release_reservation',
      'inventory.issue',
      'inventory.quarantine',
      'inventory.discard',
      'inventory.reconcile',
      'request.read',
      'request.review',
      'request.approve',
      'request.reject',
      'request.cancel',
      'request.fulfill',
      'transfer.create',
      'transfer.read',
      'transfer.approve',
      'transfer.pack',
      'transfer.dispatch',
      'transfer.receive',
      'transfer.cancel',
      'notification.read',
      'report.read',
      'report.export',
    ],
  },
  {
    code: 'LAB_STAFF',
    name: 'Lab Staff',
    description: 'Facility-scoped donation processing, screening, inventory, and request fulfillment.',
    scope: 'FACILITY',
    permissions: [
      'facility.read',
      'donation.read',
      'donation.create',
      'donation.update',
      'donation.screen',
      'donation.release',
      'donation.reject',
      'inventory.read',
      'inventory.search',
      'inventory.move',
      'inventory.quarantine',
      'inventory.discard',
      'inventory.release_reservation',
      'request.read',
      'request.fulfill',
      'transfer.read',
      'transfer.pack',
      'transfer.dispatch',
      'transfer.receive',
      'notification.read',
    ],
  },
  {
    code: 'HOSPITAL_STAFF',
    name: 'Hospital Staff',
    description: 'Facility-scoped view of own hospital activity and request intake.',
    scope: 'FACILITY',
    permissions: [
      'facility.read',
      'request.self.create',
      'request.read',
      'request.cancel',
      'transfer.read',
      'transfer.receive',
      'notification.read',
    ],
  },
  {
    code: 'DONOR',
    name: 'Donor',
    description: 'Self-scoped access to your own donor profile, appointments, and notifications.',
    scope: 'FACILITY',
    permissions: ['donor.self.read', 'donor.self.update', 'campaign.read', 'notification.read'],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor',
    description: 'Read-only audit, report, and operational visibility.',
    scope: 'GLOBAL',
    permissions: [
      'organization.read',
      'facility.read',
      'campaign.read',
      'donation.read',
      'inventory.read',
      'inventory.search',
      'request.read',
      'transfer.read',
      'report.read',
      'report.export',
      'audit.read',
      'audit.export',
    ],
  },
];

export const ALL_PERMISSION_CODES: readonly PermissionCode[] = PERMISSION_CATALOGUE.map((p) => p.code);

export function permissionCodesForRole(role: RoleCode): readonly PermissionCode[] {
  const definition = ROLE_DEFINITIONS.find((r) => r.code === role);
  return definition ? definition.permissions : [];
}

export function globalRoles(): readonly RoleCode[] {
  return ROLE_DEFINITIONS.filter((r) => r.scope === 'GLOBAL').map((r) => r.code);
}

export function facilityRoles(): readonly RoleCode[] {
  return ROLE_DEFINITIONS.filter((r) => r.scope === 'FACILITY').map((r) => r.code);
}

/**
 * Returns a list of integrity problem strings for the catalogue. Empty means healthy.
 */
export function assertCatalogueIntegrity(): string[] {
  const problems: string[] = [];
  const codes = new Set(ALL_PERMISSION_CODES);
  if (codes.size !== PERMISSION_CATALOGUE.length) {
    problems.push('duplicate permission codes');
  }
  for (const role of ROLE_DEFINITIONS) {
    if (globalRoles().includes(role.code) && facilityRoles().includes(role.code)) {
      problems.push(`role ${role.code} has conflicting scope`);
    }
    for (const permission of role.permissions) {
      if (!codes.has(permission)) {
        problems.push(`role ${role.code} references unknown permission ${permission}`);
      }
    }
  }
  return problems;
}