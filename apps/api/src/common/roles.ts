/** Permission strings are `module:action`. `*` and `module:*` are wildcards. */
export const ROLE_PRESETS: Record<string, { name: string; permissions: string[] }> = {
  customer_admin: { name: 'Customer administrator', permissions: ['*'] },
  central_procurement: {
    name: 'Central procurement',
    permissions: ['catalogue:*', 'contracts:*', 'suppliers:*', 'org:read', 'buying:*', 'users:read', 'allocation:read', 'analytics:read'],
  },
  plant_procurement: {
    name: 'Plant procurement',
    permissions: ['catalogue:read', 'contracts:read', 'suppliers:read', 'org:read', 'buying:request', 'buying:read', 'buying:approve', 'integration:simulate', 'analytics:read'],
  },
  requester: { name: 'Requester', permissions: ['catalogue:read', 'org:read', 'buying:request'] },
  approver: { name: 'Approver', permissions: ['catalogue:read', 'org:read', 'buying:read', 'contracts:read', 'buying:approve', 'analytics:read'] },
  finance: { name: 'Finance', permissions: ['buying:read', 'org:read', 'fees:*', 'analytics:read'] },
  supplier: { name: 'Supplier user', permissions: ['supplier-portal:*'] },
  procmart_ops: {
    name: 'ProcMart operations',
    permissions: ['catalogue:*', 'contracts:*', 'suppliers:*', 'org:read', 'buying:request', 'buying:read', 'buying:source', 'integration:simulate', 'allocation:read', 'analytics:read'],
  },
};

/** Default hierarchy preset for Adani (BRD §4.2). Any tenant can define its own level types. */
export const ADANI_LEVELS = [
  { key: 'group', label: 'Group', rank: 1 },
  { key: 'business', label: 'Business', rank: 2 },
  { key: 'company_code', label: 'Company code', rank: 3 },
  { key: 'plant', label: 'Plant', rank: 4 },
  { key: 'delivery_point', label: 'Delivery point / storage location', rank: 5 },
];
