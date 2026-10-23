import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ set: vi.fn(), portal: vi.fn(), active: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.set }) }))
vi.mock('@/lib/organizations/context', () => ({ getActiveContext: mocks.active }))
vi.mock('@/lib/supplier-portal-context', () => ({ requireSupplierPortal: mocks.portal }))
import { setLocale } from './actions'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.active.mockResolvedValue(null)
})
describe('supplier language preference', () => {
  it('allows Arabic for a verified enabled grant without membership', async () => {
    mocks.portal.mockResolvedValue({ arabic_enabled: true })
    await setLocale('ar', 'current-grant')
    expect(mocks.portal).toHaveBeenCalledWith('current-grant')
    expect(mocks.active).not.toHaveBeenCalled()
    expect(mocks.set).toHaveBeenCalledWith(
      'locale',
      'ar',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    )
  })
  it('does not write Arabic for a disabled or inaccessible grant', async () => {
    mocks.portal.mockResolvedValue({ arabic_enabled: false })
    await setLocale('ar', 'disabled-grant')
    expect(mocks.set).not.toHaveBeenCalled()
    mocks.portal.mockRejectedValue(new Error('not found'))
    await expect(setLocale('ar', 'revoked-grant')).rejects.toThrow('not found')
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('keeps the existing membership gate for staff settings', async () => {
    await setLocale('ar')
    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.portal).not.toHaveBeenCalled()
    await setLocale('en')
    expect(mocks.set).toHaveBeenCalledWith('locale', 'en', expect.anything())
  })
})
