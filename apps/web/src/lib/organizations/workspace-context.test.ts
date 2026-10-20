import { describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  claims: { sub: 'member', org_id: 'other', email: 'member@example.com' },
  rows: [
    { id: 'ote', slug: 'ote', role: 'planner' },
    { id: 'other', slug: 'other', role: 'owner' },
  ],
}))
vi.mock('@/lib/auth/session', () => ({ getSessionClaims: async () => state.claims }))
vi.mock('@/lib/workspaces/request', () => ({
  requestSite: async () => ({
    workspace: { slug: 'ote', name: 'OTEGROUP', organizationId: 'ote' },
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (name: string) => ({
      data:
        name === 'my_organizations'
          ? state.rows
          : [
              { id: 'invite-ote', organization_id: 'ote' },
              { id: 'invite-other', organization_id: 'other' },
            ],
    }),
  }),
}))
import { getActiveContext } from './context'

describe('workspace active context', () => {
  it('removes unrelated memberships and invitations and rejects a mismatched claim', async () => {
    const context = await getActiveContext()
    expect(context?.organizations.map((row) => row.id)).toEqual(['ote'])
    expect(context?.invitations.map((row) => row.id)).toEqual(['invite-ote'])
    expect(context?.active).toBeNull()
    expect(context?.role).toBeNull()
  })
  it('uses the current database role when the claim selects the bound membership', async () => {
    state.claims.org_id = 'ote'
    const context = await getActiveContext()
    expect(context?.active?.id).toBe('ote')
    expect(context?.role).toBe('planner')
  })
  it('does not grant access merely because the token names the bound organization', async () => {
    state.rows = [{ id: 'other', slug: 'other', role: 'owner' }]
    const context = await getActiveContext()
    expect(context?.active).toBeNull()
    expect(context?.organizations).toEqual([])
  })
})
