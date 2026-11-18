'use strict';
/**
 * Custom per-staff-member permissions. An administrator (role === 'admin')
 * always has full access and never needs this module consulted. A non-admin
 * account can be granted a custom combination of these coarse, per-function
 * keys -- mirroring the app's own navigation groupings -- so, for example,
 * one person can manage trainees and batches while another only handles
 * finance.
 *
 * Accounts created before this system existed have no `permissions` object
 * on their staff record at all. Those legacy "trainer" accounts keep their
 * original, narrower built-in capability (view batches/trainees, write
 * attendance + assessments) until an administrator explicitly opens the
 * staff-edit form and assigns them real permissions -- at which point a
 * real (possibly empty) `permissions` object is saved and this module
 * switches that account over to the explicit, granted-keys model.
 */
const { query } = require('./db');

const PERMISSION_KEYS = ['trainees', 'cohorts', 'dormitory', 'finance', 'curriculum', 'staff', 'branches', 'reports'];

// Which custom-permission key gates writes to each generic-document-store
// collection. Collections not listed here (there currently are none besides
// these) can never be written by a non-admin, regardless of permissions.
const COLLECTION_PERMISSION = {
  trainees: 'trainees',
  cohorts: 'cohorts',
  attendance: 'cohorts',
  assessments: 'cohorts',
  dormRooms: 'dormitory',
  modules: 'curriculum',
  staff: 'staff',
  branches: 'branches',
  revenueLog: 'finance',
  expenseLog: 'finance',
  kitchenItems: 'finance',
  overhead: 'finance',
  settings: 'finance',
};

// The exact set a legacy (no `permissions` object yet) trainer account could
// always write, before this permissions system existed.
const LEGACY_STAFF_WRITABLE = new Set(['attendance', 'assessments']);

async function loadStaffPermissions(staffId) {
  const { rows } = await query(
    `SELECT data->'permissions' AS permissions FROM documents WHERE collection = 'staff' AND doc_id = $1`,
    [staffId]
  );
  return rows.length ? rows[0].permissions : null;
}

// Looked up fresh from the database on every call rather than trusted from
// the (long-lived, 30-day) JWT -- an administrator revoking someone's access
// should take effect immediately, not whenever their token happens to expire.
async function canWriteCollection(auth, collection) {
  if (auth.role === 'admin') return true;
  const key = COLLECTION_PERMISSION[collection];
  if (!key) return false;
  const perms = await loadStaffPermissions(auth.staffId);
  if (perms && typeof perms === 'object') return !!perms[key];
  return LEGACY_STAFF_WRITABLE.has(collection);
}

async function hasPermission(auth, key) {
  if (auth.role === 'admin') return true;
  const perms = await loadStaffPermissions(auth.staffId);
  return !!(perms && typeof perms === 'object' && perms[key]);
}

// Extra guardrails specific to writes on the `staff` collection itself, so
// that a non-admin who has only been granted the 'staff' permission (to add
// and manage ordinary staff accounts) can never use that to escalate: they
// can't create or touch a true administrator account, and they can't grant
// anyone -- including themselves -- the 'staff' permission itself. Throws an
// Error with a `.status` the route handlers turn into the matching HTTP
// response; true admins are never restricted.
function assertStaffWriteAllowed(auth, existing, incoming) {
  if (auth.role === 'admin') return;
  if (existing && existing.role === 'admin') {
    throw Object.assign(new Error('Only an administrator can modify an administrator account'), { status: 403 });
  }
  if (incoming && incoming.role === 'admin') {
    throw Object.assign(new Error('Only an administrator can create another administrator'), { status: 403 });
  }
  if (incoming && incoming.permissions && typeof incoming.permissions === 'object' && incoming.permissions.staff) {
    throw Object.assign(new Error('Only an administrator can grant staff-management access'), { status: 403 });
  }
}

module.exports = { PERMISSION_KEYS, canWriteCollection, hasPermission, assertStaffWriteAllowed, loadStaffPermissions };
