import { describe, expect, it } from 'vitest'
import {
  assignableRoles,
  canManageMember,
  isAdminRole,
  isEditorRole,
  isRole,
  ROLES,
  type Role,
} from './roles'

const ALL_ROLES: Role[] = [...ROLES]
const NON_ADMIN_ROLES: Role[] = ['planner', 'approver', 'branch_user', 'viewer']

describe('assignableRoles', () => {
  it('lets an owner grant every role, including owner', () => {
    expect(assignableRoles('owner')).toEqual(ALL_ROLES)
  })

  it('lets an admin grant every role except owner', () => {
    expect(assignableRoles('admin')).toEqual([
      'admin',
      'planner',
      'approver',
      'branch_user',
      'viewer',
    ])
    expect(assignableRoles('admin')).not.toContain('owner')
  })

  it.each(NON_ADMIN_ROLES)('gives a %s nothing to grant', (actor) => {
    expect(assignableRoles(actor)).toEqual([])
  })

  it('gives an anonymous or unknown actor nothing to grant', () => {
    expect(assignableRoles(null)).toEqual([])
    expect(assignableRoles(undefined)).toEqual([])
  })

  it('returns a fresh array so callers cannot mutate ROLES', () => {
    const roles = assignableRoles('owner')
    roles.pop()
    expect(ROLES).toHaveLength(6)
    expect(assignableRoles('owner')).toHaveLength(6)
  })
})

describe('canManageMember', () => {
  it.each(ALL_ROLES)('lets an owner manage a %s', (target) => {
    expect(canManageMember('owner', target)).toBe(true)
  })

  it('lets an admin manage everyone except owners', () => {
    expect(canManageMember('admin', 'owner')).toBe(false)
    for (const target of ALL_ROLES.filter((role) => role !== 'owner')) {
      expect(canManageMember('admin', target)).toBe(true)
    }
  })

  it.each(NON_ADMIN_ROLES)('never lets a %s manage anyone', (actor) => {
    for (const target of ALL_ROLES) expect(canManageMember(actor, target)).toBe(false)
  })

  it('denies an anonymous or unknown actor', () => {
    for (const target of ALL_ROLES) {
      expect(canManageMember(null, target)).toBe(false)
      expect(canManageMember(undefined, target)).toBe(false)
    }
  })

  it('agrees with assignableRoles: a manageable target role is also a grantable one', () => {
    for (const actor of ALL_ROLES) {
      for (const target of ALL_ROLES) {
        expect(canManageMember(actor, target)).toBe(assignableRoles(actor).includes(target))
      }
    }
  })
})

describe('role predicates', () => {
  it('recognises the six roles and nothing else', () => {
    for (const role of ALL_ROLES) expect(isRole(role)).toBe(true)
    expect(isRole('superuser')).toBe(false)
    expect(isRole('Owner')).toBe(false)
    expect(isRole(null)).toBe(false)
    expect(isRole(1)).toBe(false)
  })

  it('splits admin and editor roles', () => {
    expect(ALL_ROLES.filter((role) => isAdminRole(role))).toEqual(['owner', 'admin'])
    expect(ALL_ROLES.filter((role) => isEditorRole(role))).toEqual(['owner', 'admin', 'planner'])
    expect(isAdminRole(null)).toBe(false)
    expect(isEditorRole(undefined)).toBe(false)
  })
})
