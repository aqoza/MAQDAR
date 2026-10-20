import { beforeEach, describe, expect, it, vi } from 'vitest'
import { idleState } from '@/lib/forms'

const mocks = vi.hoisted(() => ({
  reset: vi.fn(),
  verify: vi.fn(),
  exchange: vi.fn(),
  claims: vi.fn(),
  update: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error('REDIRECT:' + path)
  },
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/lib/auth/origin', () => ({ siteOrigin: async () => 'https://acme.zeespare.com' }))
vi.mock('@/lib/auth/session', () => ({ requireClaims: mocks.claims }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      resetPasswordForEmail: mocks.reset,
      verifyOtp: mocks.verify,
      exchangeCodeForSession: mocks.exchange,
    },
  }),
}))
vi.mock('../set-password/actions', () => ({ setPassword: mocks.update }))
import { completeRecovery, requestPasswordReset, resetPassword } from './actions'

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.reset.mockResolvedValue({ error: null })
  mocks.verify.mockResolvedValue({ error: null })
  mocks.exchange.mockResolvedValue({ error: null })
  mocks.claims.mockResolvedValue({ sub: 'user' })
})
describe('request recovery', () => {
  it('validates before calling Auth', async () => {
    expect(await requestPasswordReset(idleState, form({ email: 'invalid' }))).toMatchObject({
      status: 'error',
    })
    expect(mocks.reset).not.toHaveBeenCalled()
  })
  it('returns a neutral status and uses only the validated workspace origin', async () => {
    const result = await requestPasswordReset(
      idleState,
      form({ email: ' person@example.com ', next: 'https://evil.test' }),
    )
    expect(result).toEqual({ status: 'success', message: 'recovery.sent' })
    expect(mocks.reset).toHaveBeenCalledWith('person@example.com', {
      redirectTo: 'https://acme.zeespare.com/auth/recover',
    })
  })
  it.each([
    { status: 429 },
    { code: 'over_email_send_rate_limit' },
    { code: 'user_not_found' },
    { code: 'email_not_confirmed' },
    { code: 'email_address_not_authorized' },
    { code: 'signup_disabled' },
  ])('does not disclose account-dependent failures: %j', async (error) => {
    mocks.reset.mockResolvedValue({ error })
    expect(await requestPasswordReset(idleState, form({ email: 'person@example.com' }))).toEqual({
      status: 'success',
      message: 'recovery.sent',
    })
  })
  it('reports service failures without exposing upstream details', async () => {
    mocks.reset.mockResolvedValue({ error: { status: 500, message: 'sensitive upstream details' } })
    expect(await requestPasswordReset(idleState, form({ email: 'person@example.com' }))).toEqual({
      status: 'error',
      message: 'errors.generic',
    })
  })
})
describe('complete recovery', () => {
  it('consumes only a recovery token and has a fixed destination', async () => {
    const token = 'a'.repeat(56)
    await expect(
      completeRecovery(idleState, form({ token_hash: token, type: 'invite', next: '//evil.test' })),
    ).rejects.toThrow('REDIRECT:/auth/reset-password')
    expect(mocks.verify).toHaveBeenCalledWith({ type: 'recovery', token_hash: token })
    expect(mocks.exchange).not.toHaveBeenCalled()
  })
  it('supports the default hosted-template PKCE code', async () => {
    const code = 'b'.repeat(36)
    await expect(completeRecovery(idleState, form({ code }))).rejects.toThrow(
      'REDIRECT:/auth/reset-password',
    )
    expect(mocks.exchange).toHaveBeenCalledWith(code)
  })
  it.each([
    {},
    { token_hash: '<script>' },
    { token_hash: 'a'.repeat(300) },
    { token_hash: 'a'.repeat(56), code: 'b'.repeat(36) },
  ])('rejects missing, malformed or ambiguous credentials: %j', async (values) => {
    await expect(
      completeRecovery(idleState, form(values as Record<string, string>)),
    ).rejects.toThrow('REDIRECT:/auth/forgot-password?error=link')
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.exchange).not.toHaveBeenCalled()
  })
  it('rejects expired or reused links', async () => {
    mocks.verify.mockResolvedValue({ error: { code: 'otp_expired' } })
    await expect(completeRecovery(idleState, form({ token_hash: 'a'.repeat(56) }))).rejects.toThrow(
      'REDIRECT:/auth/forgot-password?error=link',
    )
  })
})
describe('set recovered password', () => {
  it('requires authentication before updating', async () => {
    mocks.claims.mockRejectedValue(new Error('REDIRECT:/login'))
    await expect(
      resetPassword(idleState, form({ password: 'Long-password', confirmation: 'Long-password' })),
    ).rejects.toThrow('REDIRECT:/login')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('rejects a confirmation mismatch', async () => {
    expect(
      await resetPassword(
        idleState,
        form({ password: 'Long-password', confirmation: 'different' }),
      ),
    ).toEqual({ status: 'error', message: 'recovery.mismatch' })
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('delegates minimum length and Auth errors to the established action with a fixed destination', async () => {
    mocks.update.mockResolvedValue({ status: 'error', fieldErrors: { password: 'too short' } })
    const result = await resetPassword(
      idleState,
      form({ password: 'short', confirmation: 'short', next: '//evil.test' }),
    )
    expect(result).toMatchObject({ status: 'error' })
    const submitted = mocks.update.mock.calls[0][1] as FormData
    expect([...submitted.entries()]).toEqual([
      ['password', 'short'],
      ['next', '/dashboard'],
    ])
  })
})
