import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: { organizations: [{ id: 'ote-id' }], invitations: [{ id: 'ote-invite' }] },
  rpc: vi.fn(async () => ({ error: null })),
  refresh: vi.fn(async () => ({ error: null })),
}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/lib/auth/session', () => ({ requireClaims: async () => ({ sub: 'member-id' }) }))
vi.mock('@/lib/workspaces/request', () => ({
  requestSite: async () => ({ workspace: { organizationId: 'ote-id' } }),
}))
vi.mock('@/lib/organizations/context', () => ({ getActiveContext: async () => mocks.context }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    auth: { refreshSession: mocks.refresh },
  }),
}))
import { acceptInvitation, createOrganization, switchOrganization } from './actions'

beforeEach(() => {
  mocks.rpc.mockClear()
  mocks.refresh.mockClear()
})
describe('workspace Server Action boundaries', () => {
  it('rejects a forged switch target before the RPC runs', async () => {
    await expect(switchOrganization('another-tenant')).rejects.toThrow(
      'redirect:/organizations?error=MQ403',
    )
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('allows the approved membership and refreshes once', async () => {
    await expect(switchOrganization('ote-id')).rejects.toThrow('redirect:/dashboard')
    expect(mocks.rpc).toHaveBeenCalledWith('set_active_organization', {
      p_organization_id: 'ote-id',
    })
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
  it('rejects a hidden invitation id belonging to another tenant', async () => {
    const form = new FormData()
    form.set('invitationId', 'other-tenant-invite')
    expect(await acceptInvitation({ status: 'idle' }, form)).toMatchObject({
      status: 'error',
      code: 'MQ403',
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('refuses organization creation on a bound workspace', async () => {
    await expect(createOrganization({ status: 'idle' }, new FormData())).rejects.toThrow(
      'redirect:/organizations',
    )
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
