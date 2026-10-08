import { describe, expect, it } from 'vitest'
import { envSchema } from './env.schema'

describe('envSchema', () => {
  it('accepts a local Supabase configuration', () => {
    expect(
      envSchema.safeParse({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      }).success,
    ).toBe(true)
  })

  it('rejects missing or malformed values', () => {
    expect(envSchema.safeParse({}).success).toBe(false)
    expect(
      envSchema.safeParse({
        NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'x',
      }).success,
    ).toBe(false)
  })
})
