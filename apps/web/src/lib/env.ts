import { envSchema, type Env } from './env.schema'

// Each variable is referenced literally so Next.js can inline NEXT_PUBLIC_* values in client bundles.
export const env: Env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
})
