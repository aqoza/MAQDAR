/**
 * Membership roles and the management rules the UI mirrors. SQL is the authority: the RPCs in the
 * tenancy_auth_completion migration re-check every rule (and own the last-owner guard).
 */
export const ROLES = ['owner', 'admin', 'planner', 'approver', 'branch_user', 'viewer'] as const

export type Role = (typeof ROLES)[number]

export const ADMIN_ROLES: readonly Role[] = ['owner', 'admin']
export const EDITOR_ROLES: readonly Role[] = ['owner', 'admin', 'planner']

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** Owner or admin: manages members, invitations and organization settings. */
export function isAdminRole(role: Role | null | undefined): boolean {
  return role != null && ADMIN_ROLES.includes(role)
}

/** Owner, admin or planner: may insert, update and delete business data. */
export function isEditorRole(role: Role | null | undefined): boolean {
  return role != null && EDITOR_ROLES.includes(role)
}

/** Roles an actor may grant or invite. Admins never grant owner. */
export function assignableRoles(actor: Role | null | undefined): Role[] {
  if (actor === 'owner') return [...ROLES]
  if (actor === 'admin') return ROLES.filter((role) => role !== 'owner')
  return []
}

/** Whether an actor may change the role of, or remove, a member with the target role. */
export function canManageMember(actor: Role | null | undefined, target: Role): boolean {
  if (actor === 'owner') return true
  if (actor === 'admin') return target !== 'owner'
  return false
}
